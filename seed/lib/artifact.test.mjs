import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildPairArtifact, buildUsersArtifact } from "./artifact.mjs"

describe("buildPairArtifact", () => {
  it("records one DM pair with sender, receiver, and conversation id", () => {
    const pair = buildPairArtifact({
      conversationId: 9,
      sender: { id: 1, username: "load_a", email: "loadtest0@example.com" },
      receiver: { id: 2, username: "load_b", email: "loadtest1@example.com" },
      password: "LoadTest123!",
    })

    assert.deepEqual(pair, {
      conversationId: 9,
      password: "LoadTest123!",
      sender: { id: 1, username: "load_a", email: "loadtest0@example.com" },
      receiver: { id: 2, username: "load_b", email: "loadtest1@example.com" },
    })
  })
})

describe("buildUsersArtifact", () => {
  it("lists seeded users without access tokens", () => {
    const users = buildUsersArtifact([
      { id: 1, username: "load_a", email: "loadtest0@example.com", password: "LoadTest123!" },
      { id: 2, username: "load_b", email: "loadtest1@example.com", password: "LoadTest123!" },
    ])

    assert.equal(users.length, 2)
    assert.equal(users[0].email, "loadtest0@example.com")
    assert.equal(users[0].password, "LoadTest123!")
    assert.equal(users[0].accessToken, undefined)
  })
})
