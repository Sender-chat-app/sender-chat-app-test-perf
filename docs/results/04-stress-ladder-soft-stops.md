# Ticket 04 results — Stress ladder with soft stop signals

**Date:** 2026-10-09  
**Status:** Done (acceptance criteria met)

## Acceptance

| Criterion | Result |
|-----------|--------|
| Stress scenario ramps toward ~100 pairs / ~50–100 msg/s on a single app instance | Pass — `../../k6/stress.js`, ladder `25→50→75→100`, think-time 400–1200ms |
| Custom metrics: messages sent, WS events received, WS event lag | Pass — `messages_sent`, `ws_events_received`, `ws_event_lag` (+ `message_send_duration`) |
| Soft stops: error rate > 1%, REST send p95 > 500ms, send→WS lag p95 > 1s | Pass — configured with `abortOnFail` + `delayAbortEval=45s` (`PERF_SOFT_ABORT=0` to report-only) |
| Runbook for interpreting results + host/DB/Redis watches | Pass — `../../RUNBOOK.md` |

## Commands run

```bash
cd perf/k6
PERF_PAIRS=8 PERF_STAGE_RAMP_S=5 PERF_STAGE_HOLD_S=8 PERF_PEAK_HOLD_S=12 k6 run stress.js
k6 run stress.js          # default 100-pair ladder
k6 run smoke.js           # still green
```

## Acceptance run summary (100 pairs, default stages)

| Signal | Value |
|--------|-------|
| ladder | 25→50→75→100 (ramp 15s, hold 30s, peak 45s) |
| messages_sent | 16787 (~70.6/s over whole run incl. ramp) |
| ws_events_received | 16787 (matches sends) |
| http_req_failed{message_send} | 0% |
| http_req_duration{message_send} p95 | ~12ms |
| ws_event_lag p95 | ~13ms |
| checks | 100% (33574/33574) |
| soft-stop abort | Did not fire (all thresholds green) |
| exit | 0 |

Soft thresholds are armed; on this host the single-instance stack stayed under the exploratory limits through 100 pairs. A threshold abort (non-zero exit) on a weaker machine is a valid soft-stop finding — see the runbook.

## Design notes

- **One VU per DM pair** owns both STOMP receive (receiver token) and REST send (sender token). Two `ramping-vus` scenarios cannot use `__VU - 1` safely because k6 VU ids are global across scenarios (first short run spun millions of failed iterations on `VU 10` with only 8 pairs).
- Send→WS lag: body embeds `k6-stress|<sentAtMs>|<clientMessageId>`; receiver parses on `MESSAGE_CREATED`.
- Think-time via `socket.setTimeout` (cannot `sleep` inside the WS callback).
- Env knobs documented in `../../RUNBOOK.md`.

## Commit

Skipped: workspace is not a git repository (no `.git`).
