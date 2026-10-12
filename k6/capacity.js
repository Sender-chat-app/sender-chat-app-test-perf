import { check } from "k6"
import { Counter, Rate, Trend } from "k6/metrics"
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js"
import ws from "k6/ws"
import {
  buildLadderStages,
  capacityLadderTargets,
  restMixShares,
} from "./lib/capacity-plan.js"
import { WS_URL } from "./lib/config.js"
import { configuredPairCount, pairs } from "./lib/data.js"
import { listConversations, listMessages, login, sendMessage } from "./lib/http.js"
import { buildStompFrame, parseStompBody, parseStompCommand } from "./lib/stomp.js"
import {
  parseStressSentAt,
  stressMessageBody,
  uuid,
} from "./lib/util.js"

/**
 * Capacity probe (ticket 05): push past the ticket-04 soft-stop band with lower
 * think-time, longer peak hold, optional chat-like REST mix, and p95/p99 reporting.
 *
 * Soft stops match stress.js (error rate, send p95, WS lag p95).
 */
// Default above ticket-04's 100-pair band when the seed has enough pairs.
const PAIR_COUNT = configuredPairCount(200)
const STAGE_RAMP_S = Number(__ENV.PERF_STAGE_RAMP_S || 10)
const STAGE_HOLD_S = Number(__ENV.PERF_STAGE_HOLD_S || 20)
const PEAK_HOLD_S = Number(__ENV.PERF_PEAK_HOLD_S || 60)
const SOFT_ABORT = (__ENV.PERF_SOFT_ABORT || "1") !== "0"
// Setup logs in 2×pairs sequentially; keep abort evaluation after setup + first ramp.
const DELAY_ABORT_EVAL = __ENV.PERF_DELAY_ABORT_EVAL || "120s"
// Aggressive defaults vs stress (400–1200ms) to seek a soft ceiling on one host.
const THINK_MIN_MS = Number(__ENV.PERF_THINK_MIN_MS || 50)
const THINK_MAX_MS = Number(__ENV.PERF_THINK_MAX_MS || 150)
const MIX = (__ENV.PERF_MIX || "1") !== "0"
const MIX_OUT = __ENV.PERF_MIX_OUT || "../data/capacity-last-mix.json"

function parseFractions(raw) {
  if (!raw) return null
  const parts = String(raw)
    .split(",")
    .map(function (s) {
      return Number(s.trim())
    })
    .filter(function (n) {
      return Number.isFinite(n) && n > 0 && n <= 1
    })
  return parts.length ? parts : null
}

const FRACTIONS = parseFractions(__ENV.PERF_LADDER_FRACTIONS)
const TARGETS = capacityLadderTargets(PAIR_COUNT, FRACTIONS || undefined)
const STAGES = buildLadderStages(TARGETS, {
  rampS: STAGE_RAMP_S,
  holdS: STAGE_HOLD_S,
  peakHoldS: PEAK_HOLD_S,
})
const LADDER_S = STAGES.reduce(function (sum, stage) {
  return sum + Number(String(stage.duration).replace(/s$/, ""))
}, 0)
const PAIR_HOLD_MS = (LADDER_S + 60) * 1000

const messagesSent = new Counter("messages_sent")
const wsEventsReceived = new Counter("ws_events_received")
const inboxReads = new Counter("inbox_reads")
const historyReads = new Counter("history_reads")
const heartbeatsSent = new Counter("presence_heartbeats")
// Setup logins are counted separately so REST mix reflects in-scenario chat traffic.
const sendDuration = new Trend("message_send_duration", true)
const inboxDuration = new Trend("inbox_list_duration", true)
const historyDuration = new Trend("message_history_duration", true)
const wsEventLag = new Trend("ws_event_lag", true)
const receiverGotEvent = new Rate("receiver_got_message_created")
const sendErrors = new Rate("message_send_errors")

function softThreshold(expr) {
  if (!SOFT_ABORT) return expr
  return {
    threshold: expr,
    abortOnFail: true,
    delayAbortEval: DELAY_ABORT_EVAL,
  }
}

function thinkTimeMs() {
  const lo = Number.isFinite(THINK_MIN_MS) && THINK_MIN_MS >= 0 ? THINK_MIN_MS : 50
  const hi = Number.isFinite(THINK_MAX_MS) && THINK_MAX_MS >= lo ? THINK_MAX_MS : Math.max(lo, 150)
  const ms = Math.floor(lo + Math.random() * (hi - lo))
  return ms < 1 ? 1 : ms
}

function counterValue(data, name) {
  const m = data.metrics && data.metrics[name]
  if (!m || !m.values) return 0
  return typeof m.values.count === "number" ? m.values.count : 0
}

export const options = {
  scenarios: {
    capacity: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: "10s",
      gracefulStop: "15s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    "http_req_failed{name:message_send}": [softThreshold("rate<0.01")],
    "http_req_duration{name:message_send}": [softThreshold("p(95)<500")],
    ws_event_lag: [softThreshold("p(95)<1000")],
  },
}

export function setup() {
  console.log(
    "capacity probe: pairs=" +
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
      THINK_MAX_MS +
      " mix=" +
      MIX,
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

export default function (data) {
  const session = data.sessions[__VU - 1]
  if (!session) {
    throw new Error("no session for VU " + __VU + " (pairCount=" + PAIR_COUNT + ")")
  }

  let connected = false
  let events = 0
  let sendTimerStarted = false
  let sendCount = 0

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
          heartbeatsSent.add(1)
        }
        heartbeat()
        socket.setInterval(heartbeat, 30000)

        if (!sendTimerStarted) {
          sendTimerStarted = true
          socket.setTimeout(function () {
            scheduleSend(socket, session, function () {
              sendCount += 1
              return sendCount
            })
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

function scheduleSend(socket, session, nextSendCount) {
  const n = nextSendCount()

  if (MIX) {
    if (n % 5 === 1) {
      const started = Date.now()
      const inbox = listConversations(session.senderToken, 30)
      inboxDuration.add(Date.now() - started)
      inboxReads.add(1)
      check(inbox, {
        "inbox list 2xx": function (r) {
          return r.status >= 200 && r.status < 300
        },
      })
    }
    if (n % 3 === 1) {
      const started = Date.now()
      const history = listMessages(session.senderToken, session.conversationId, 50)
      historyDuration.add(Date.now() - started)
      historyReads.add(1)
      check(history, {
        "message history 2xx": function (r) {
          return r.status >= 200 && r.status < 300
        },
      })
    }
  }

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
    scheduleSend(socket, session, nextSendCount)
  }, thinkTimeMs())
}

export function handleSummary(data) {
  const restCounts = {
    message_send: counterValue(data, "messages_sent"),
    conversation_list: counterValue(data, "inbox_reads"),
    message_history: counterValue(data, "history_reads"),
  }
  const rows = restMixShares(restCounts)
  const httpTotal = rows.reduce(function (s, r) {
    return s + r.count
  }, 0)
  const payload = {
    rest: rows.map(function (r) {
      return {
        name: r.name,
        count: r.count,
        share: r.share,
        pct: Math.round(r.share * 1000) / 10,
      }
    }),
    http_total: httpTotal,
    ws: {
      presence_heartbeats: counterValue(data, "presence_heartbeats"),
      message_created_received: counterValue(data, "ws_events_received"),
    },
    note:
      "Mix is in-scenario chat REST only (setup logins excluded). Heartbeats and MESSAGE_CREATED are not HTTP requests.",
    setup_auth_logins_note:
      "Setup performs 2 logins per pair before the ladder; see k6 http_reqs including setup if needed.",
  }

  const mixLines = []
  mixLines.push("")
  mixLines.push("=== capacity request mix (REST) ===")
  if (!rows.length) {
    mixLines.push("(no REST counters)")
  } else {
    for (let i = 0; i < payload.rest.length; i++) {
      const r = payload.rest[i]
      mixLines.push(r.name + ": count=" + r.count + " share=" + r.pct + "%")
    }
    mixLines.push("http_total=" + httpTotal)
  }
  mixLines.push(
    "ws presence_heartbeats=" +
      payload.ws.presence_heartbeats +
      " MESSAGE_CREATED=" +
      payload.ws.message_created_received,
  )
  mixLines.push(payload.note)
  mixLines.push("")

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }) + mixLines.join("\n"),
    [MIX_OUT]: JSON.stringify(payload, null, 2) + "\n",
  }
}
