# Ticket 06 results — Per-endpoint capacity + dataset comparison

**Date:** 2026-10-11  
**Status:** Done (acceptance criteria met)

## Acceptance

| Criterion | Result |
|-----------|--------|
| `PERF_ENDPOINT=<id> k6 run endpoint.js` probes only that REST path | Pass — `../../k6/endpoint.js` + catalog |
| Catalog: login, conversation list, history, send | Pass — `auth_login`, `conversation_list`, `message_history`, `message_send` |
| Runbook explains endpoint + load knobs + seed compare | Pass — `../../RUNBOOK.md` § Per-endpoint probe |
| Soft stops (error rate + p95) with optional abort | Pass — `PERF_SOFT_ABORT` / `PERF_P95_MS` |
| One endpoint baseline + larger seed compared | Pass — **`conversation_list`** (below) |
| Unit tests + smoke | Pass — k6 lib 10/10; smoke exit 0 after reseed |

## Harness

| Artifact | Role |
|----------|------|
| `../../k6/endpoint.js` | Isolated VU ladder for one REST tag |
| `../../k6/lib/endpoints.js` (+ tests) | Catalog + `resolveEndpoint` |
| `npm run seed:compare` | 400 pairs, 80–150 messages/pair |
| `../../RUNBOOK.md` | How to change endpoint, load, grow seed |

**Operator:** run other catalog ids yourself — see runbook copy-paste examples.

## Endpoint under test: `conversation_list`

`GET /api/v1/conversations` — ticket-05 mixed-traffic bottleneck.

Shared load knobs for both runs:

```bash
PERF_ENDPOINT=conversation_list PERF_VUS=50 PERF_SOFT_ABORT=0 \
  PERF_STAGE_RAMP_S=8 PERF_STAGE_HOLD_S=15 PERF_PEAK_HOLD_S=30 \
  k6 run endpoint.js
```

(`PERF_SOFT_ABORT=0` so both ladders complete for comparison. Default `PERF_P95_MS=500` is still evaluated and reports as crossed — this endpoint’s floor latency is already ~700ms.)

### Soft ceiling note (default 500ms budget)

Short check (`PERF_VUS=8`, soft abort on): abort after `delayAbortEval` with **p95 ≈ 768ms**, **min ≈ 700ms**. So with a 500ms p95 budget, `conversation_list` has **no green concurrent band** on this host/seed — raise `PERF_P95_MS` (e.g. 1000 or 4000) if you want abort-based VU banding.

## Dataset comparison

| Field | Baseline seed | Larger seed (`seed:compare`) |
|-------|---------------|------------------------------|
| Seed | ~300 pairs / 600 users (pre-existing artifacts) | **400 pairs / 800 users / 45415 messages** |
| Abort (report-only) | Threshold crossed (p95 ≫ 500ms) | Same |
| `endpoint_calls` | 1450 (~12.1/s) | 1447 (~12.1/s) |
| `http_reqs` | 1500 (~12.5/s) | 1497 (~12.5/s) |
| Error rate | 0% | 0% |
| checks | 100% | 100% |
| **p95** | **3.87s** | **3.86s** |
| **p99** | **3.94s** | **4.02s** |
| min latency | ~700ms | ~699ms |

### Interpretation

1. Growing from ~300 → 400 DM pairs (and much deeper message histories) **did not meaningfully change** isolated inbox-list latency or throughput under 50 VUs.  
2. That matches the seed shape: each user still has roughly **one** DM, so `GET /conversations` work per call stays similar; corpus depth hits `message_history` harder — probe that id next when comparing message volume.  
3. Absolute cost is high: ~**0.7s floor**, ~**3.8–3.9s p95** at 50 VUs on this laptop. Ticket 05’s mixed abort was driven largely by this path.

## How to re-run other endpoints

```bash
cd perf/k6
PERF_ENDPOINT=message_history PERF_VUS=50 k6 run endpoint.js
PERF_ENDPOINT=message_send PERF_VUS=40 k6 run endpoint.js
PERF_ENDPOINT=auth_login PERF_VUS=30 k6 run endpoint.js
```

Full knob table: `../../RUNBOOK.md` → **Per-endpoint probe (ticket 06)**.

## Commands run

```bash
cd perf/k6 && npm test                                    # 10/10
PERF_ENDPOINT=conversation_list PERF_VUS=8 … k6 run endpoint.js
PERF_ENDPOINT=conversation_list PERF_VUS=50 PERF_SOFT_ABORT=0 …  # baseline
# wipe + redis FLUSHALL
cd perf/seed && npm run seed:compare                      # 400 pairs, 45415 msgs
PERF_ENDPOINT=conversation_list PERF_VUS=50 PERF_SOFT_ABORT=0 …  # larger
k6 run smoke.js                                           # exit 0
```

## Commit

Skipped: workspace is not a git repository (no `.git`).
