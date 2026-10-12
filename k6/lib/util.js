export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function thinkTimeSeconds() {
  // Human-like pause between sends: about 2–5 seconds.
  return 2 + Math.random() * 3
}

/** Stress think-time (seconds). Defaults target ~50–100 msg/s at 100 pairs. */
export function stressThinkTimeSeconds() {
  const minMs = Number(__ENV.PERF_THINK_MIN_MS || 400)
  const maxMs = Number(__ENV.PERF_THINK_MAX_MS || 1200)
  const lo = Number.isFinite(minMs) && minMs >= 0 ? minMs : 400
  const hi = Number.isFinite(maxMs) && maxMs >= lo ? maxMs : Math.max(lo, 1200)
  return (lo + Math.random() * (hi - lo)) / 1000
}

/** Embed send-start epoch ms so the receiver can measure send→MESSAGE_CREATED lag. */
export function stressMessageBody(clientMessageId, sentAtMs) {
  return "k6-stress|" + sentAtMs + "|" + clientMessageId
}

/** @returns {number|null} send-start epoch ms from a stress message body */
export function parseStressSentAt(body) {
  if (!body || typeof body !== "string") return null
  const parts = body.split("|")
  if (parts.length < 3 || parts[0] !== "k6-stress") return null
  const ts = Number(parts[1])
  return Number.isFinite(ts) ? ts : null
}
