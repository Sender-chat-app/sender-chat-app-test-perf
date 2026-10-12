/**
 * Shared k6 target URLs. Override with PERF_API_URL / PERF_WS_URL.
 * When PERF_WS_URL is omitted, WS is derived from the API base.
 */

const DEFAULT_API_URL = "http://localhost:8080"

export const API_URL = (__ENV.PERF_API_URL || DEFAULT_API_URL).replace(/\/$/, "")

export const WS_URL = (
  __ENV.PERF_WS_URL ||
  API_URL.replace(/^http/, "ws") + "/ws"
).replace(/^http/, "ws")
