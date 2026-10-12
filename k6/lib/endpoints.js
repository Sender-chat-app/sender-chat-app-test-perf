/**
 * Catalog of seed-backed REST endpoints for isolated capacity probes (ticket 06).
 * Each entry is metadata only — k6 call sites live in endpoint.js.
 */

const CATALOG = {
  auth_login: {
    id: "auth_login",
    tag: "auth_login",
    method: "POST",
    path: "/api/v1/auth/login",
    needsConversation: false,
    description: "Email/password login (uses seeded pair sender credentials).",
  },
  conversation_list: {
    id: "conversation_list",
    tag: "conversation_list",
    method: "GET",
    path: "/api/v1/conversations",
    needsConversation: false,
    description: "Inbox / conversation list for the authenticated user.",
  },
  message_history: {
    id: "message_history",
    tag: "message_history",
    method: "GET",
    path: "/api/v1/conversations/{conversationId}/messages",
    needsConversation: true,
    description: "Paged message history for one seeded DM.",
  },
  message_send: {
    id: "message_send",
    tag: "message_send",
    method: "POST",
    path: "/api/v1/conversations/{conversationId}/messages",
    needsConversation: true,
    description: "Send a text message on one seeded DM (creates durable rows).",
  },
}

export const ENDPOINT_IDS = Object.keys(CATALOG).sort()

/**
 * @param {string|undefined|null} id
 * @returns {typeof CATALOG[string]}
 */
export function resolveEndpoint(id) {
  if (id === undefined || id === null || String(id).trim() === "") {
    throw new Error(
      "PERF_ENDPOINT is required (one of: " + ENDPOINT_IDS.join(", ") + ")",
    )
  }
  const key = String(id).trim()
  const ep = CATALOG[key]
  if (!ep) {
    throw new Error(
      "unknown PERF_ENDPOINT=" +
        key +
        " (known: " +
        ENDPOINT_IDS.join(", ") +
        ")",
    )
  }
  return ep
}
