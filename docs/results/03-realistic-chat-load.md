# Ticket 03 results — Realistic chat load scenario

**Date:** 2026-10-09  
**Status:** Done (acceptance criteria met)

## Acceptance

| Criterion | Result |
|-----------|--------|
| Realistic scenario loads pair artifacts and runs paired sender/receiver VUs | Pass — `../../k6/realistic.js`, default 50 pairs from `pairs.json` |
| Sender think-time ~2–5s; occasional inbox + message-history reads | Pass — `thinkTimeSeconds()`, inbox every 5 sends, history every 3 |
| Receivers maintain STOMP subscription and ~30s presence heartbeats | Pass — hold for scenario duration; heartbeat interval 30s |
| Run completes with readable k6 summary suitable for stress comparison | Pass — custom counters/trends + default end-of-test table |

## Commands run

```bash
cd perf/k6
PERF_PAIRS=10 PERF_DURATION_S=45 k6 run realistic.js   # clean local check
PERF_DURATION_S=90 k6 run realistic.js                 # default 50 pairs
k6 run smoke.js                                        # still green
```

## Acceptance run summary (50 pairs, 90s)

| Signal | Value |
|--------|-------|
| pairs / duration | 50 / 90s |
| messages_sent | 1164 (~9.4/s) |
| ws_events_received | 1164 (matches sends; one `MESSAGE_CREATED` per receiver) |
| receiver_got_message_created | 100% (50/50) |
| http_req_failed{message_send} | 0% |
| message_send_duration p95 | ~238ms |
| inbox list 2xx | 100% |
| checks | 100% (3085/3085) |
| thresholds | Pass (send fail rate + receiver event rate) |
| exit | 0 |

## Design notes

- `setup()` pre-logs all senders/receivers sequentially to avoid a bcrypt login stampede at scenario start.
- Pair assignment uses `exec.scenario.iterationInTest` (not `__ITER`). With `shared-iterations`, `__ITER` is per-VU and stays `0` on the first/only iteration, which previously pinned every VU onto `pairs[0]`.
- Env knobs: `PERF_PAIRS` (default 50, capped by seeded pairs), `PERF_DURATION_S` (default 120), `PERF_API_URL` / `PERF_WS_URL`.
- Metrics intended for stress comparison (ticket 04): `messages_sent`, `ws_events_received`, `message_send_duration`, `inbox_reads`, `history_reads`, tagged `http_req_duration{name:message_send}`.

## Follow-ups applied after first acceptance draft

The first recorded 50/90s numbers (`messages_sent≈292`, `ws_events_received≈12400`, send p95≈23s, inbox ~45% 2xx) were **invalid**: every VU used `sessions[0]`, so all senders contested one conversation (`SELECT … FOR UPDATE`) and all receivers shared one STOMP user (event fan-out ×50).

After correcting pair indexing, plus related backend hardening:

- Inbox list batches friendship/members/latest/unread and calls Redis presence **outside** the DB transaction (`ConversationService.list`).
- Auth BCrypt runs outside the session-write transaction so Hikari connections are not held during hashing.

Re-run above is the acceptance baseline for ticket 04.

## Commit

Skipped: workspace is not a git repository (no `.git`).
