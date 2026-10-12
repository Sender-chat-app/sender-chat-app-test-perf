import { check } from "k6"
import { Counter, Rate, Trend } from "k6/metrics"
import ws from "k6/ws"
import { WS_URL } from "./lib/config.js"
import { configuredPairCount, pairs } from "./lib/data.js"
import { login, sendMessage } from "./lib/http.js"
import { buildStompFrame, parseStompBody, parseStompCommand } from "./lib/stomp.js"
import { buildLadderStages, capacityLadderTargets } from "./lib/capacity-plan.js"
import {
  parseStressSentAt,
  stressMessageBody,
  uuid,
} from "./lib/util.js"
const PAIR_COUNT = configuredPairCount(100)
const STAGE_RAMP_S = Number(__ENV.PERF_STAGE_RAMP_S || 15)
const STAGE_HOLD_S = Number(__ENV.PERF_STAGE_HOLD_S || 30)
const PEAK_HOLD_S = Number(__ENV.PERF_PEAK_HOLD_S || 45)
const SOFT_ABORT = (__ENV.PERF_SOFT_ABORT || "1") !== "0"
const DELAY_ABORT_EVAL = __ENV.PERF_DELAY_ABORT_EVAL || "45s"
const THINK_MIN_MS = Number(__ENV.PERF_THINK_MIN_MS || 400)
const THINK_MAX_MS = Number(__ENV.PERF_THINK_MAX_MS || 1200)

const messagesSent = new Counter("messages_sent")
const wsEventsReceived = new Counter("ws_events_received")
const sendDuration = new Trend("message_send_duration", true)
const wsEventLag = new Trend("ws_event_lag", true)
const receiverGotEvent = new Rate("receiver_got_message_created")
const sendErrors = new Rate("message_send_errors")

function thinkTimeMs() {
  const lo = Number.isFinite(THINK_MIN_MS) && THINK_MIN_MS >= 0 ? THINK_MIN_MS : 400
  const hi = Number.isFinite(THINK_MAX_MS) && THINK_MAX_MS >= lo ? THINK_MAX_MS : Math.max(lo, 1200)
  const ms = Math.floor(lo + Math.random() * (hi - lo))
  // k6 socket.setTimeout rejects 0; treat 0 as minimum 1ms.
  return ms < 1 ? 1 : ms
}

const TARGETS = capacityLadderTargets(PAIR_COUNT)
const STAGES = buildLadderStages(TARGETS, {
  rampS: STAGE_RAMP_S,
  holdS: STAGE_HOLD_S,
  peakHoldS: PEAK_HOLD_S,
})
const LADDER_S = STAGES.reduce(function (sum, stage) {
  return sum + Number(String(stage.duration).replace(/s$/, ""))
}, 0)
// One long-lived WS iteration per VU covers the whole ladder (+ buffer).
const PAIR_HOLD_MS = (LADDER_S + 60) * 1000

function softThreshold(expr) {
  if (!SOFT_ABORT) return expr
  return {
    threshold: expr,
    abortOnFail: true,
    delayAbortEval: DELAY_ABORT_EVAL,
  }
}

export const options = {
  scenarios: {
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: "10s",
      gracefulStop: "15s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    // Soft exploratory stops (ticket 04). Abort ends the ladder early when breached.
    "http_req_failed{name:message_send}": [softThreshold("rate<0.01")],
    "http_req_duration{name:message_send}": [softThreshold("p(95)<500")],
    ws_event_lag: [softThreshold("p(95)<1000")],
  },
}

export function setup() {
  console.log(
    "stress ladder: pairs=" +
      PAIR_COUNT +
      " targets=" +
      TARGETS.join("→") +
      " ramp_s=" +
      STAGE_RAMP_S +
      " hold_s=" +
      STAGE_HOLD_S +
      " peak_hold_s=" +
      PEAK_HOLD_S +
      " soft_abort=" +
      SOFT_ABORT +
      " think_ms=" +
      THINK_MIN_MS +
      "-" +
      THINK_MAX_MS,
  )
  if (pairs.length < PAIR_COUNT) {
    throw new Error("need " + PAIR_COUNT + " seeded pairs, have " + pairs.length)
  }
  const sessions = []
  for (let i = 0; i < PAIR_COUNT; i++) {
    const pair = pairs[i]
    const receiverAuth = login(pair.receiver.email, pair.password)
    const senderAuth = login(pair.sender.email, pair.password)
    sessions.push({
      conversationId: pair.conversationId,
      sender: pair.sender,
      receiver: pair.receiver,
      senderToken: senderAuth.accessToken,
      receiverToken: receiverAuth.accessToken,
    })
    if ((i + 1) % 20 === 0 || i + 1 === PAIR_COUNT) {
      console.log("setup logged in pairs " + (i + 1) + "/" + PAIR_COUNT)
    }
  }
  return { sessions: sessions }
}

/**
 * One VU per DM pair: STOMP receiver on the same VU that REST-sends.
 * Avoids cross-scenario __VU collisions (k6 VU ids are global across scenarios).
 */
export default function (data) {
  const session = data.sessions[__VU - 1]
  if (!session) {
    throw new Error("no session for VU " + __VU + " (pairCount=" + PAIR_COUNT + ")")
  }

  let connected = false
  let events = 0
  let sendTimerStarted = false

  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on("open", function () {
      socket.send(
        buildStompFrame("CONNECT", {
          Authorization: "Bearer " + session.receiverToken,
          "accept-version": "1.2",
          host: "sender",
        }),
      )
    })

    socket.on("message", function (raw) {
      const command = parseStompCommand(raw)
      if (command === "CONNECTED") {
        connected = true
        socket.send(
          buildStompFrame("SUBSCRIBE", {
            id: "user-events-" + session.receiver.id,
            destination: "/user/queue/events",
            ack: "auto",
          }),
        )
        function heartbeat() {
          socket.send(
            buildStompFrame(
              "SEND",
              {
                destination: "/app/presence/heartbeat",
                "content-type": "application/json",
              },
              "{}",
            ),
          )
        }
        heartbeat()
        socket.setInterval(heartbeat, 30000)

        if (!sendTimerStarted) {
          sendTimerStarted = true
          // Brief pause so SUBSCRIBE is in place before the first REST send.
          socket.setTimeout(function () {
            scheduleSend(socket, session)
          }, 500)
        }
        return
      }
      if (command !== "MESSAGE") return
      let event = null
      try {
        event = parseStompBody(raw)
      } catch (e) {
        return
      }
      if (!event || event.type !== "MESSAGE_CREATED") return
      events += 1
      wsEventsReceived.add(1)

      const body =
        event.payload && event.payload.message ? event.payload.message.body : null
      const sentAt = parseStressSentAt(body)
      if (sentAt !== null) {
        const lag = Date.now() - sentAt
        if (lag >= 0 && lag < 120000) {
          wsEventLag.add(lag)
        }
      }
    })

    socket.setTimeout(function () {
      socket.close()
    }, PAIR_HOLD_MS)
  })

  receiverGotEvent.add(events > 0)
  check(res, {
    "pair websocket status 101": function (r) {
      return r && r.status === 101
    },
  })
  check(null, {
    "pair STOMP connected": function () {
      return connected
    },
  })
}

function scheduleSend(socket, session) {
  const clientMessageId = uuid()
  const sentAt = Date.now()
  const res = sendMessage(
    session.senderToken,
    session.conversationId,
    stressMessageBody(clientMessageId, sentAt),
    clientMessageId,
  )
  sendDuration.add(Date.now() - sentAt)
  messagesSent.add(1)

  const ok = res.status >= 200 && res.status < 300
  sendErrors.add(!ok)
  check(res, {
    "sender send status 2xx": function (r) {
      return r.status >= 200 && r.status < 300
    },
    "sender response has id": function (r) {
      try {
        return !!r.json("id")
      } catch (e) {
        return false
      }
    },
  })

  socket.setTimeout(function () {
    scheduleSend(socket, session)
  }, thinkTimeMs())
}
