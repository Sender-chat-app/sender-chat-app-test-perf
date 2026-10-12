import { SharedArray } from "k6/data"

export const pairs = new SharedArray("pairs", function () {
  return JSON.parse(open("../../data/pairs.json"))
})

export function smokePair() {
  return pairAt(0)
}

export function pairAt(index) {
  if (!pairs.length) {
    throw new Error("perf/data/pairs.json is empty; run npm run seed:full (or seed:smoke) in perf/seed first")
  }
  if (index < 0 || index >= pairs.length) {
    throw new Error("pair index " + index + " out of range (have " + pairs.length + " pairs)")
  }
  return pairs[index]
}

/** How many pairs this run should use (env PERF_PAIRS, capped by seeded artifacts). */
export function configuredPairCount(defaultCount) {
  defaultCount = defaultCount === undefined ? 50 : defaultCount
  const requested = Number(__ENV.PERF_PAIRS || defaultCount)
  if (!Number.isFinite(requested) || requested < 1) {
    throw new Error("PERF_PAIRS must be >= 1")
  }
  return Math.min(Math.floor(requested), pairs.length)
}
