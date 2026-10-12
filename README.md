# Sender Chat load-test harness — ticket results

Exploratory performance tooling against the public REST + STOMP API on a single app instance (in-memory STOMP broker). This file summarizes what each ticket delivered; detailed run notes live under `.scratch/k6-load-testing/results/`.

## Ticket 01 — Smoke harness for one DM pair

**Status:** Done

| Criterion | Result |
|-----------|--------|
| Perf env overlay without changing safe defaults | `perf/env.perf.example` (+ comments in `backend/.env.example`) |
| Node REST seeder: 2 users, friendship, DM, few messages, gitignored artifacts | `npm run seed:smoke` → `perf/data/users.json` + `pairs.json` |
| k6 smoke: sender + receiver STOMP, heartbeat, send, `MESSAGE_CREATED` | checks 100% (5/5), `messages_sent=1`, `ws_events_received=1` |
| Operator wipe / seed / run path | Documented in ticket 01 results |

**Artifacts:** `perf/seed`, `perf/k6/smoke.js`, `perf/env.perf.example`  
**Details:** [`.scratch/k6-load-testing/results/01-smoke-harness.md`](../.scratch/k6-load-testing/results/01-smoke-harness.md)

## Ticket 02 — Full DM dataset seed

**Status:** Done

| Criterion | Result |
|-----------|--------|
| ~200 users / ~100 DM pairs / ~50–100 messages per pair with bounded concurrency | `npm run seed:full` → **200 users**, **100 pairs**, **7451** seed messages (`concurrency=8`, messages 50–100 by pair index) |
| User + pair artifacts for paired sender/receiver assignment | Same gitignored `users.json` / `pairs.json` shape as ticket 01; smoke uses `pairs[0]` |
| Wipe-then-reseed produces a usable deterministic dataset | Truncate app tables + Redis `FLUSHALL`, then `seed:full` rewrote artifacts |
| Smoke re-run against the full seeded dataset | `k6 run smoke.js` exit 0, checks 100% (5/5) |

**New / changed:** `seed:full`, `--concurrency`, `--messages-min`/`--messages-max`, `lib/concurrency.mjs`, `lib/seed-plan.mjs`, 429 retries in seed API client, raised auth limits in `env.perf.example`  
**Details:** [`.scratch/k6-load-testing/results/02-full-dm-dataset-seed.md`](../.scratch/k6-load-testing/results/02-full-dm-dataset-seed.md)

## Ticket 03 — Realistic chat load scenario

**Status:** Done

| Criterion | Result |
|-----------|--------|
| Paired sender/receiver VUs from seeded artifacts (~50 pairs) | `perf/k6/realistic.js` — `PERF_PAIRS` (default 50), `PERF_DURATION_S` (default 120); pair index via `exec.scenario.iterationInTest` |
| Think-time 2–5s; occasional inbox + message history | Pass |
| Receivers: STOMP `/user/queue/events` + 30s presence heartbeats | Pass — `receiver_got_message_created=100%` on 50/50 |
| Readable summary for stress comparison | Counters/trends: `messages_sent`, `ws_events_received`, `message_send_duration`, `inbox_reads`, `history_reads` |

**Acceptance run (50 pairs, 90s):** `messages_sent=1164`, `ws_events_received=1164`, send fail 0%, send p95 ~238ms, inbox list 2xx 100%, checks 100%, exit 0.  
**Details:** [`.scratch/k6-load-testing/results/03-realistic-chat-load.md`](../.scratch/k6-load-testing/results/03-realistic-chat-load.md)

## Ticket 04 — Stress ladder + soft stops

**Status:** Done

| Criterion | Result |
|-----------|--------|
| Ramp toward ~100 pairs / ~50–100 msg/s | `perf/k6/stress.js` — ladder `25→50→75→100`, think-time 400–1200ms; acceptance ~70.6 msg/s overall |
| Custom metrics: sends, WS receives, send→WS lag | `messages_sent`, `ws_events_received`, `ws_event_lag` |
| Soft stops armed | error rate <1%, send p95 <500ms, lag p95 <1s (`abortOnFail`, `PERF_SOFT_ABORT=0` to disable) |
| Operator runbook | `perf/RUNBOOK.md` — interpret summary + host/Postgres/Redis watches |

**Acceptance run (100 pairs, default ladder):** `messages_sent=ws_events_received=16787`, send fail 0%, send p95 ~12ms, lag p95 ~13ms, soft abort did not fire, exit 0.  
**Details:** [`.scratch/k6-load-testing/results/04-stress-ladder-soft-stops.md`](../.scratch/k6-load-testing/results/04-stress-ladder-soft-stops.md)

## Ticket 05 — Capacity threshold characterization

**Status:** Done

| Criterion | Result |
|-----------|--------|
| Probe past ticket-04 green band until soft abort or documented max | Mixed: abort at **150 pairs**; send-heavy: **no ceiling** through 200 pairs |
| Sustained msg/s + HTTP req/s; p95/p99 | Mixed abort ~114 msg/s / ~179 HTTP req/s (whole-run, not SLA); send p95 ~552ms; send-heavy ~574 msg/s, send p95/p99 ~331/523ms |
| Host resource sampling on noisy laptop | `perf/scripts/sample-host.sh` (instant CPU via `/proc`) + runbook |
| Request-mix table (REST % + WS/heartbeat separate) | Mixed ~65% send / 22% history / 13% inbox; artifact `capacity-last-mix.json` |
| Soft stops unchanged from ticket 04 | Same signals; capacity default `PERF_DELAY_ABORT_EVAL=120s` (covers setup) |

**Acceptance:** Dell Vostro i5-1135G7 laptop — mixed soft ceiling ~100–150 pairs (profile-dependent; no single RPS); send-heavy green at 200 pairs.  
**Details:** [`.scratch/k6-load-testing/results/05-capacity-threshold-characterization.md`](../.scratch/k6-load-testing/results/05-capacity-threshold-characterization.md)

## Ticket 06 — Per-endpoint capacity + dataset comparison

**Status:** Done

| Criterion | Result |
|-----------|--------|
| Isolated REST probe via `PERF_ENDPOINT` | `perf/k6/endpoint.js` — catalog: login / list / history / send |
| Operator docs: change endpoint + load + grow seed | `perf/RUNBOOK.md` § Per-endpoint probe |
| One endpoint baseline vs larger seed | **`conversation_list`**: ~300→400 pairs; p95 ~3.87s→~3.86s (flat); floor ~700ms |
| Soft stops | Error rate + p95 (`PERF_P95_MS`, `PERF_SOFT_ABORT`) |
| Tests | `perf/k6` unit 10/10; smoke exit 0 after `seed:compare` |

**Details:** [`.scratch/k6-load-testing/results/06-per-endpoint-capacity.md`](../.scratch/k6-load-testing/results/06-per-endpoint-capacity.md)
