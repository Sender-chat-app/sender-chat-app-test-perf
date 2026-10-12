import { check, sleep } from "k6"
import { Counter } from "k6/metrics"
import ws from "k6/ws"
import { WS_URL } from "./lib/config.js"
import { smokePair } from "./lib/data.js"
import { login, sendMessage } from "./lib/http.js"
import { buildStompFrame, parseStompBody, parseStompCommand } from "./lib/stomp.js"
const messagesSent = new Counter("messages_sent")
const wsEventsReceived = new Counter("ws_events_received")

export const options = {
  scenarios: {
    receiver: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      exec: "receiver",
      startTime: "0s",
      maxDuration: "45s",
    },
    sender: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      exec: "sender",
      startTime: "3s",
      maxDuration: "45s",
    },
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
  },
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function receiver() {
  const pair = smokePair()
  const auth = login(pair.receiver.email, pair.password)
  let sawMessageCreated = false
  let connected = false

  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on("open", function () {
      socket.send(
        buildStompFrame("CONNECT", {
          Authorization: "Bearer " + auth.accessToken,
          "accept-version": "1.2",
          host: "sender",
        }),
      )
    })

    socket.on("message", function (data) {
      const command = parseStompCommand(data)
      if (command === "CONNECTED") {
        connected = true
        socket.send(
          buildStompFrame("SUBSCRIBE", {
            id: "user-events",
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
      const event = parseStompBody(data)
      if (event && event.type === "MESSAGE_CREATED") {
        sawMessageCreated = true
        wsEventsReceived.add(1)
        socket.close()
      }
    })

    socket.setTimeout(function () {
      socket.close()
    }, 35000)
  })

  check(res, { "receiver websocket status 101": function (r) { return r && r.status === 101 } })
  check(null, {
    "receiver STOMP connected": function () { return connected },
    "receiver got MESSAGE_CREATED": function () { return sawMessageCreated },
  })
}

export function sender() {
  const pair = smokePair()
  const auth = login(pair.sender.email, pair.password)
  const clientMessageId = uuid()
  const res = sendMessage(auth.accessToken, pair.conversationId, "k6 smoke " + clientMessageId, clientMessageId)
  messagesSent.add(1)
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
  sleep(1)
}
