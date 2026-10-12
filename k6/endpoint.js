import { check, sleep } from "k6"
import http from "k6/http"
import { Counter, Rate, Trend } from "k6/metrics"
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js"
import { buildLadderStages, capacityLadderTargets } from "./lib/capacity-plan.js"
import { pairs } from "./lib/data.js"
import { resolveEndpoint } from "./lib/endpoints.js"
import {
  apiUrl,
  listConversations,
  listMessages,
  login,
  sendMessage,
} from "./lib/http.js"
import { uuid } from "./lib/util.js"

/**
 * Isolated per-endpoint capacity probe (ticket 06).
 *
 *   PERF_ENDPOINT=conversation_list k6 run endpoint.js
 *
 * Each VU owns one seeded pair credential and repeatedly calls only the
 * selected REST endpoint. Soft stops watch that endpoint's error rate + p95.
 */

const ENDPOINT = resolveEndpoint(__ENV.PERF_ENDPOINT || "conversation_list")

function configuredVuCount(defaultCount) {
  const requested = Number(__ENV.PERF_VUS || defaultCount)
  if (!Number.isFinite(requested) || requested < 1) {
    throw new Error("PERF_VUS must be >= 1")
  }
  return Math.min(Math.floor(requested), pairs.length)
}

const VU_COUNT = configuredVuCount(50)
const STAGE_RAMP_S = Number(__ENV.PERF_STAGE_RAMP_S || 10)
const STAGE_HOLD_S = Number(__ENV.PERF_STAGE_HOLD_S || 20)
const PEAK_HOLD_S = Number(__ENV.PERF_PEAK_HOLD_S || 40)
const SOFT_ABORT = (__ENV.PERF_SOFT_ABORT || "1") !== "0"
const DELAY_ABORT_EVAL = __ENV.PERF_DELAY_ABORT_EVAL || "60s"
const THINK_MIN_MS = Number(__ENV.PERF_THINK_MIN_MS || 50)
const THINK_MAX_MS = Number(__ENV.PERF_THINK_MAX_MS || 150)
const P95_MS = Number(__ENV.PERF_P95_MS || 500)
const LIST_LIMIT = Number(__ENV.PERF_LIST_LIMIT || 30)
const HISTORY_LIMIT = Number(__ENV.PERF_HISTORY_LIMIT || 50)

function parseFractions(raw) {
  if (!raw) return null
  const parts = String(raw)
    .split(",")
    .map(function (s) {
      return Number(s.trim())
    })
    .filter(function (n) {
      return Number.isFinite(n) && n > 0 && n <= 1
    })
  return parts.length ? parts : null
}

const FRACTIONS = parseFractions(__ENV.PERF_LADDER_FRACTIONS)
const TARGETS = capacityLadderTargets(VU_COUNT, FRACTIONS || undefined)
const STAGES = buildLadderStages(TARGETS, {
  rampS: STAGE_RAMP_S,
  holdS: STAGE_HOLD_S,
  peakHoldS: PEAK_HOLD_S,
})

const calls = new Counter("endpoint_calls")
const callDuration = new Trend("endpoint_duration", true)
const callErrors = new Rate("endpoint_errors")

function softThreshold(expr) {
  if (!SOFT_ABORT) return expr
  return {
    threshold: expr,
    abortOnFail: true,
    delayAbortEval: DELAY_ABORT_EVAL,
  }
}

function thinkTimeSeconds() {
  const lo = Number.isFinite(THINK_MIN_MS) && THINK_MIN_MS >= 0 ? THINK_MIN_MS : 50
  const hi = Number.isFinite(THINK_MAX_MS) && THINK_MAX_MS >= lo ? THINK_MAX_MS : Math.max(lo, 150)
  return (lo + Math.random() * (hi - lo)) / 1000
}

export const options = {
  scenarios: {
    endpoint: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: STAGES,
      gracefulRampDown: "10s",
      gracefulStop: "15s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    ["http_req_failed{name:" + ENDPOINT.tag + "}"]: [softThreshold("rate<0.01")],
    ["http_req_duration{name:" + ENDPOINT.tag + "}"]: [
      softThreshold("p(95)<" + P95_MS),
    ],
  },
}

export function setup() {
  console.log(
    "endpoint probe: id=" +
      ENDPOINT.id +
      " method=" +
      ENDPOINT.method +
      " path=" +
      ENDPOINT.path +
      " vus=" +
      VU_COUNT +
      " targets=" +
      TARGETS.join("→") +
      " think_ms=" +
      THINK_MIN_MS +
      "-" +
      THINK_MAX_MS +
      " p95_ms=" +
      P95_MS +
      " soft_abort=" +
      SOFT_ABORT,
  )
  if (pairs.length < VU_COUNT) {
    throw new Error("need " + VU_COUNT + " seeded pairs, have " + pairs.length)
  }

  const sessions = []
  for (let i = 0; i < VU_COUNT; i++) {
    const pair = pairs[i]
    let token = null
    if (ENDPOINT.id !== "auth_login") {
      const auth = login(pair.sender.email, pair.password)
      token = auth.accessToken
    }
    sessions.push({
      conversationId: pair.conversationId,
      email: pair.sender.email,
      password: pair.password,
      token: token,
    })
    if ((i + 1) % 25 === 0 || i + 1 === VU_COUNT) {
      console.log("setup prepared sessions " + (i + 1) + "/" + VU_COUNT)
    }
  }
  return {
    sessions: sessions,
    endpointId: ENDPOINT.id,
    seedPairsAvailable: pairs.length,
  }
}

export default function (data) {
  const session = data.sessions[__VU - 1]
  if (!session) {
    throw new Error("no session for VU " + __VU)
  }

  const started = Date.now()
  const res = invokeEndpoint(session)
  const elapsed = Date.now() - started
  callDuration.add(elapsed)
  calls.add(1)

  const ok = res && res.status >= 200 && res.status < 300
  callErrors.add(!ok)
  check(res, {
    "endpoint status 2xx": function (r) {
      return r && r.status >= 200 && r.status < 300
    },
  })

  sleep(thinkTimeSeconds())
}

function invokeEndpoint(session) {
  if (ENDPOINT.id === "auth_login") {
    return http.post(
      apiUrl("/auth/login"),
      JSON.stringify({ email: session.email, password: session.password }),
      {
        headers: { "Content-Type": "application/json" },
        tags: { name: "auth_login" },
        timeout: "60s",
      },
    )
  }
  if (ENDPOINT.id === "conversation_list") {
    return listConversations(session.token, LIST_LIMIT)
  }
  if (ENDPOINT.id === "message_history") {
    return listMessages(session.token, session.conversationId, HISTORY_LIMIT)
  }
  if (ENDPOINT.id === "message_send") {
    const id = uuid()
    return sendMessage(
      session.token,
      session.conversationId,
      "k6-endpoint " + id,
      id,
    )
  }
  throw new Error("unhandled endpoint " + ENDPOINT.id)
}

export function handleSummary(data) {
  const lines = []
  lines.push("")
  lines.push("=== endpoint probe summary ===")
  lines.push("endpoint=" + ENDPOINT.id + " tag=" + ENDPOINT.tag)
  lines.push("vus_max=" + VU_COUNT + " targets=" + TARGETS.join("→"))
  lines.push(
    "soft_abort=" +
      SOFT_ABORT +
      " p95_threshold_ms=" +
      P95_MS +
      " delay_abort_eval=" +
      DELAY_ABORT_EVAL,
  )
  const dur = data.metrics && data.metrics["http_req_duration{name:" + ENDPOINT.tag + "}"]
  if (dur && dur.values) {
    const p95 = dur.values["p(95)"]
    const p99 = dur.values["p(99)"]
    lines.push(
      "duration_ms p95=" +
        (p95 !== undefined ? Number(p95).toFixed(2) : "?") +
        " p99=" +
        (p99 !== undefined ? Number(p99).toFixed(2) : "?"),
    )
  }
  const failed = data.metrics && data.metrics["http_req_failed{name:" + ENDPOINT.tag + "}"]
  if (failed && failed.values && failed.values.rate !== undefined) {
    lines.push("error_rate=" + failed.values.rate)
  }
  const callMetric = data.metrics && data.metrics.endpoint_calls
  if (callMetric && callMetric.values && callMetric.values.count !== undefined) {
    lines.push("endpoint_calls=" + callMetric.values.count)
  }
  lines.push("")

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }) + lines.join("\n"),
  }
}
