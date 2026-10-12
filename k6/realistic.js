import { check, sleep } from "k6"
import exec from "k6/execution"
import { Counter, Rate, Trend } from "k6/metrics"
import ws from "k6/ws"
import { WS_URL } from "./lib/config.js"
import { configuredPairCount, pairs } from "./lib/data.js"
import { listConversations, listMessages, login, sendMessage } from "./lib/http.js"
import { buildStompFrame, parseStompBody, parseStompCommand } from "./lib/stomp.js"
import { thinkTimeSeconds, uuid } from "./lib/util.js"
const PAIR_COUNT = configuredPairCount(50)
const DURATION_S = Number(__ENV.PERF_DURATION_S || 120)
const SENDER_START_S = 10
const RECEIVER_HOLD_MS = (DURATION_S + SENDER_START_S + 15) * 1000

const messagesSent = new Counter("messages_sent")
const wsEventsReceived = new Counter("ws_events_received")
const inboxReads = new Counter("inbox_reads")
const historyReads = new Counter("history_reads")
const sendDuration = new Trend("message_send_duration", true)
const receiverGotEvent = new Rate("receiver_got_message_created")

export const options = {
  scenarios: {
    receivers: {
      executor: "shared-iterations",
      vus: PAIR_COUNT,
      iterations: PAIR_COUNT,
      exec: "receiver",
      startTime: "0s",
      maxDuration: `${DURATION_S + SENDER_START_S + 45}s`,
      gracefulStop: "15s",
    },
    senders: {
      executor: "shared-iterations",
      vus: PAIR_COUNT,
      iterations: PAIR_COUNT,
      exec: "sender",
      startTime: `${SENDER_START_S}s`,
      maxDuration: `${DURATION_S + SENDER_START_S + 45}s`,
      gracefulStop: "15s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    // Harness health for normal chat. Latency stays in the summary for stress comparison
    // (ticket 04 owns hard soft-stop thresholds).
    "http_req_failed{name:message_send}": ["rate<0.05"],
    receiver_got_message_created: ["rate>0.90"],
  },
}

export function setup() {
  console.log(
    `realistic chat: pairs=${PAIR_COUNT} duration_s=${DURATION_S} think_time=2-5s sender_start=${SENDER_START_S}s (pre-login in setup)`,
  )
  const sessions = []
  for (let i = 0; i < PAIR_COUNT; i++) {
    const pair = pairs[i]
    const receiverAuth = login(pair.receiver.email, pair.password)
    const senderAuth = login(pair.sender.email, pair.password)
    sessions.push({
      conversationId: pair.conversationId,
      password: pair.password,
      sender: pair.sender,
      receiver: pair.receiver,
      senderToken: senderAuth.accessToken,
      receiverToken: receiverAuth.accessToken,
    })
    if ((i + 1) % 10 === 0 || i + 1 === PAIR_COUNT) {
      console.log(`setup logged in pairs ${i + 1}/${PAIR_COUNT}`)
    }
  }
  return { sessions: sessions }
}

export function receiver(data) {
  // shared-iterations: __ITER is per-VU (always 0 on the first/only iter). Use the
  // scenario-global index so each VU maps to a distinct seeded pair.
  const session = data.sessions[exec.scenario.iterationInTest]
  let connected = false
  let events = 0

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
        return
      }
      if (command !== "MESSAGE") return
      let event = null
      try {
        event = parseStompBody(raw)
      } catch (e) {
        return
      }
      if (event && event.type === "MESSAGE_CREATED") {
        events += 1
        wsEventsReceived.add(1)
      }
    })

    socket.setTimeout(function () {
      socket.close()
    }, RECEIVER_HOLD_MS)
  })

  receiverGotEvent.add(events > 0)
  check(res, { "receiver websocket status 101": function (r) { return r && r.status === 101 } })
  check(null, {
    "receiver STOMP connected": function () { return connected },
  })
}

export function sender(data) {
  const session = data.sessions[exec.scenario.iterationInTest]
  const endAt = Date.now() + DURATION_S * 1000
  let sends = 0

  while (Date.now() < endAt) {
    // Occasional inbox refresh (~every 5 sends) and history read (~every 3 sends).
    if (sends % 5 === 0) {
      const inbox = listConversations(session.senderToken, 30)
      inboxReads.add(1)
      check(inbox, { "inbox list 2xx": function (r) { return r.status >= 200 && r.status < 300 } })
    }
    if (sends % 3 === 0) {
      const history = listMessages(session.senderToken, session.conversationId, 50)
      historyReads.add(1)
      check(history, { "message history 2xx": function (r) { return r.status >= 200 && r.status < 300 } })
    }

    const clientMessageId = uuid()
    const started = Date.now()
    const res = sendMessage(
      session.senderToken,
      session.conversationId,
      "k6 realistic " + clientMessageId,
      clientMessageId,
    )
    sendDuration.add(Date.now() - started)
    messagesSent.add(1)
    sends += 1

    check(res, {
      "sender send status 2xx": function (r) { return r.status >= 200 && r.status < 300 },
      "sender response has id": function (r) {
        try {
          return !!r.json("id")
        } catch (e) {
          return false
        }
      },
    })

    sleep(thinkTimeSeconds())
  }
}
