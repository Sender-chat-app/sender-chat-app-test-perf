import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildStompFrame, parseStompCommand, parseStompBody } from "./stomp-frame.mjs"

describe("buildStompFrame", () => {
  it("matches the browser client CONNECT framing", () => {
    const frame = buildStompFrame("CONNECT", {
      Authorization: "Bearer tok",
      "accept-version": "1.2",
      host: "sender",
    })
    assert.equal(frame, "CONNECT\nAuthorization:Bearer tok\naccept-version:1.2\nhost:sender\n\n\0")
  })

  it("includes a JSON body for SEND", () => {
    const frame = buildStompFrame(
      "SEND",
      { destination: "/app/presence/heartbeat", "content-type": "application/json" },
      "{}",
    )
    assert.equal(
      frame,
      "SEND\ndestination:/app/presence/heartbeat\ncontent-type:application/json\n\n{}\0",
    )
  })
})

describe("parseStomp", () => {
  it("reads command and JSON body from a MESSAGE frame", () => {
    const raw = 'MESSAGE\ndestination:/user/queue/events\n\n{"type":"MESSAGE_CREATED","eventId":"e1"}\0'
    assert.equal(parseStompCommand(raw), "MESSAGE")
    assert.deepEqual(parseStompBody(raw), { type: "MESSAGE_CREATED", eventId: "e1" })
  })
})
