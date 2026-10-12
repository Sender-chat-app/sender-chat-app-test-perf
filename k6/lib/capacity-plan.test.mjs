import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildLadderStages,
  capacityLadderTargets,
  restMixShares,
} from "./capacity-plan.js"

describe("capacityLadderTargets", () => {
  it("builds unique ascending steps through max pairs for the capacity fractions", () => {
    assert.deepEqual(capacityLadderTargets(100), [25, 50, 75, 100])
    assert.deepEqual(capacityLadderTargets(8), [2, 4, 6, 8])
  })

  it("accepts a finer fraction list to probe past a coarse ladder", () => {
    assert.deepEqual(
      capacityLadderTargets(100, [0.4, 0.6, 0.8, 0.9, 1]),
      [40, 60, 80, 90, 100],
    )
  })

  it("dedupes when max pairs is small", () => {
    assert.deepEqual(capacityLadderTargets(2), [1, 2])
  })
})

describe("buildLadderStages", () => {
  it("ramps and holds each target, peaks longer, then cools to zero", () => {
    assert.deepEqual(
      buildLadderStages([2, 4], { rampS: 5, holdS: 8, peakHoldS: 12 }),
      [
        { duration: "5s", target: 2 },
        { duration: "8s", target: 2 },
        { duration: "5s", target: 4 },
        { duration: "12s", target: 4 },
        { duration: "5s", target: 0 },
      ],
    )
  })
})

describe("restMixShares", () => {
  it("returns counts and shares that sum to 1 for tagged REST ops", () => {
    const rows = restMixShares({
      message_send: 100,
      conversation_list: 20,
      message_history: 30,
      auth_login: 50,
    })
    assert.deepEqual(rows, [
      { name: "auth_login", count: 50, share: 0.25 },
      { name: "conversation_list", count: 20, share: 0.1 },
      { name: "message_history", count: 30, share: 0.15 },
      { name: "message_send", count: 100, share: 0.5 },
    ])
    const sum = rows.reduce((s, r) => s + r.share, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9)
  })

  it("returns empty mix when there are no REST counts", () => {
    assert.deepEqual(restMixShares({}), [])
    assert.deepEqual(restMixShares({ message_send: 0 }), [])
  })
})
