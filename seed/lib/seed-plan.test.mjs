import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { messagesForPair, pairIndexes } from "./seed-plan.mjs"

describe("messagesForPair", () => {
  it("uses fixed count when provided", () => {
    assert.equal(messagesForPair(0, { fixed: 3 }), 3)
    assert.equal(messagesForPair(99, { fixed: 3 }), 3)
  })

  it("cycles deterministically through [min, max]", () => {
    assert.equal(messagesForPair(0, { min: 50, max: 100 }), 50)
    assert.equal(messagesForPair(1, { min: 50, max: 100 }), 51)
    assert.equal(messagesForPair(50, { min: 50, max: 100 }), 100)
    assert.equal(messagesForPair(51, { min: 50, max: 100 }), 50)
  })
})

describe("pairIndexes", () => {
  it("returns 0..n-1", () => {
    assert.deepEqual(pairIndexes(3), [0, 1, 2])
  })
})
