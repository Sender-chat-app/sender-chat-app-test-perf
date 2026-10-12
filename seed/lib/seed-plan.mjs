/**
 * Deterministic historical message count for a DM pair.
 * When `fixed` is set, every pair gets that count.
 * Otherwise count is in [min, max] cycling by pair index.
 */
export function messagesForPair(pairIndex, { min = 50, max = 100, fixed } = {}) {
  if (!Number.isInteger(pairIndex) || pairIndex < 0) {
    throw new Error("pairIndex must be an integer >= 0")
  }
  if (fixed !== undefined && fixed !== null) {
    if (!Number.isInteger(fixed) || fixed < 0) {
      throw new Error("fixed message count must be an integer >= 0")
    }
    return fixed
  }
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    throw new Error("messages range must satisfy 0 <= min <= max")
  }
  const span = max - min + 1
  return min + (pairIndex % span)
}

export function pairIndexes(pairCount) {
  if (!Number.isInteger(pairCount) || pairCount < 1) {
    throw new Error("pairCount must be an integer >= 1")
  }
  return Array.from({ length: pairCount }, (_, i) => i)
}
