import http from "k6/http"
import { API_URL } from "./config.js"

export function apiUrl(path) {
  return API_URL + "/api/v1" + path
}

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  }
}

export function login(email, password) {
  const res = http.post(
    apiUrl("/auth/login"),
    JSON.stringify({ email: email, password: password }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "auth_login" },
    },
  )
  if (res.status !== 200) {
    throw new Error("login failed for " + email + ": " + res.status + " " + res.body)
  }
  return res.json()
}

export function listConversations(token, limit) {
  limit = limit === undefined ? 30 : limit
  return http.get(apiUrl("/conversations?limit=" + limit), {
    headers: authHeaders(token),
    tags: { name: "conversation_list" },
    timeout: "60s",
  })
}

export function listMessages(token, conversationId, limit) {
  limit = limit === undefined ? 50 : limit
  return http.get(apiUrl("/conversations/" + conversationId + "/messages?limit=" + limit), {
    headers: authHeaders(token),
    tags: { name: "message_history" },
    timeout: "60s",
  })
}

export function sendMessage(token, conversationId, body, clientMessageId) {
  return http.post(
    apiUrl("/conversations/" + conversationId + "/messages"),
    JSON.stringify({ body: body, clientMessageId: clientMessageId }),
    {
      headers: authHeaders(token),
      tags: { name: "message_send" },
      timeout: "60s",
    },
  )
}
