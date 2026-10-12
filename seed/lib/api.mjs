import { DEFAULT_API_URL } from "./config.mjs"

const MAX_RETRIES = 6

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createApi(baseUrl = process.env.PERF_API_URL ?? DEFAULT_API_URL) {
  const root = baseUrl.replace(/\/$/, "")

  async function request(path, { method = "GET", token, body } = {}) {
    const headers = { "Content-Type": "application/json" }
    if (token) headers.Authorization = `Bearer ${token}`

    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${root}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      let json = null
      if (text) {
        try {
          json = JSON.parse(text)
        } catch {
          json = text
        }
      }
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get("retry-after"))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 500 * 2 ** attempt)
        await sleep(waitMs)
        continue
      }
      if (!response.ok) {
        const detail = typeof json === "object" && json ? JSON.stringify(json) : text
        throw new Error(`${method} ${path} -> ${response.status}: ${detail}`)
      }
      return json
    }
  }

  return {
    register({ username, email, password }) {
      return request("/auth/register", {
        method: "POST",
        body: { username, email, password },
      })
    },
    login({ email, password }) {
      return request("/auth/login", {
        method: "POST",
        body: { email, password },
      })
    },
    createFriendRequest(token, userId) {
      return request("/friendships", {
        method: "POST",
        token,
        body: { userId },
      })
    },
    listIncomingRequests(token) {
      return request("/friendships/requests", { token })
    },
    decideFriendship(token, friendshipId, decision) {
      return request(`/friendships/${friendshipId}`, {
        method: "PATCH",
        token,
        body: { decision },
      })
    },
    createDirect(token, otherUserId) {
      return request("/conversations/direct", {
        method: "POST",
        token,
        body: { otherUserId },
      })
    },
    sendMessage(token, conversationId, { body, clientMessageId }) {
      return request(`/conversations/${conversationId}/messages`, {
        method: "POST",
        token,
        body: { body, clientMessageId },
      })
    },
  }
}
