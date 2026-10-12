import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ENDPOINT_IDS, resolveEndpoint } from "./endpoints.js"

describe("resolveEndpoint", () => {
  it("resolves known catalog ids with method, path hint, and tag", () => {
    const ep = resolveEndpoint("conversation_list")
    assert.equal(ep.id, "conversation_list")
    assert.equal(ep.tag, "conversation_list")
    assert.equal(ep.method, "GET")
    assert.match(ep.path, /conversations/)
    assert.ok(typeof ep.needsConversation === "boolean")
  })

  it("lists every supported id in ENDPOINT_IDS", () => {
    assert.ok(ENDPOINT_IDS.includes("auth_login"))
    assert.ok(ENDPOINT_IDS.includes("conversation_list"))
    assert.ok(ENDPOINT_IDS.includes("message_history"))
    assert.ok(ENDPOINT_IDS.includes("message_send"))
    for (let i = 0; i < ENDPOINT_IDS.length; i++) {
      assert.equal(resolveEndpoint(ENDPOINT_IDS[i]).id, ENDPOINT_IDS[i])
    }
  })

  it("rejects unknown ids with the known catalog in the error", () => {
    assert.throws(
      () => resolveEndpoint("not_a_real_endpoint"),
      /not_a_real_endpoint[\s\S]*conversation_list/,
    )
  })

  it("rejects empty endpoint", () => {
    assert.throws(() => resolveEndpoint(""), /PERF_ENDPOINT/)
    assert.throws(() => resolveEndpoint(undefined), /PERF_ENDPOINT/)
  })
})
