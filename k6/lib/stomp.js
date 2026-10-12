export function buildStompFrame(command, headers, body) {
  body = body === undefined ? "" : body
  const headerLines = Object.entries(headers || {})
    .map(function (entry) {
      return entry[0] + ":" + entry[1]
    })
    .join("\n")
  return command + "\n" + headerLines + "\n\n" + body + "\0"
}

export function parseStompCommand(raw) {
  return String(raw).split("\n")[0]
}

export function parseStompBody(raw) {
  const text = String(raw)
  const parts = text.split("\n\n")
  if (parts.length < 2) return null
  const body = parts.slice(1).join("\n\n").replace(/\0$/, "")
  if (!body) return null
  return JSON.parse(body)
}
