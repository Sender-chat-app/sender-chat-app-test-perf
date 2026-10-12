/** STOMP framing aligned with the browser realtime client. */

export function buildStompFrame(command, headers = {}, body = "") {
  const headerLines = Object.entries(headers)
    .map(([key, value]) => `${key}:${value}`)
    .join("\n")
  return `${command}\n${headerLines}\n\n${body}\0`
}

export function parseStompCommand(raw) {
  return String(raw).split("\n", 1)[0]
}

export function parseStompBody(raw) {
  const text = String(raw)
  const parts = text.split("\n\n")
  if (parts.length < 2) return null
  const body = parts.slice(1).join("\n\n").replace(/\0$/, "")
  if (!body) return null
  return JSON.parse(body)
}
