import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { mapPool } from "./concurrency.mjs"

describe("mapPool", () => {
  it("preserves order with bounded concurrency", async () => {
    const seen = []
    const results = await mapPool([1, 2, 3, 4, 5], 2, async (value, index) => {
      seen.push(index)
      await new Promise(resolve => setTimeout(resolve, (5 - index) * 5))
      return value * 10
    })
    assert.deepEqual(results, [10, 20, 30, 40, 50])
    assert.equal(seen.length, 5)
  })

  it("rejects invalid concurrency", async () => {
    await assert.rejects(() => mapPool([1], 0, async v => v), /concurrency/)
  })
})
