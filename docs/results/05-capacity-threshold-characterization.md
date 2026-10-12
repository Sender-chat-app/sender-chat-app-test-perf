# Ticket 05 results — Capacity threshold characterization

**Date:** 2026-10-12 (mixed re-run); Probe B retained from 2026-10-11  
**Status:** Done (acceptance criteria met)

## Acceptance

| Criterion | Result |
|-----------|--------|
| Probe past ticket-04 green band until soft abort or documented max | Pass — mixed profile aborted at **150 pairs**; send-heavy completed **200 pairs** with no soft abort |
| Sustained msg/s + HTTP req/s; p95/p99 | Pass — see tables below (quote by **profile**, not a single RPS) |
| Idle vs peak host samples + noisy-laptop caveat | Pass — `../../scripts/sample-host.sh` (+ runbook) |
| Request-mix table (REST %; WS/heartbeat separate) | Pass — end-of-run table + `../../data/capacity-last-mix.json` |
| Soft stops unchanged from ticket 04 | Pass — same error-rate / send p95 / WS lag p95 |
| Smoke + short realistic still pass | Pass — smoke exit 0; `PERF_PAIRS=3 PERF_DURATION_S=20` realistic exit 0 |

## Host context

| Item | Value |
|------|-------|
| Machine | Dell Vostro 15 3510 — Intel i5-1135G7 (8 threads), ~7.5 GiB RAM |
| Stack | Single Spring Boot (`BackendApplication`), local Postgres + Redis |
| Seed | `../../data/pairs.json` with **300** pairs available; probes used **200** |
| Caveat | Personal laptop; CPU/RAM shared with IDE and other desktop processes. Numbers are exploratory, not an SLA. |

## Idle baseline (after prior runs cooled)

Instantaneous sample via `../../scripts/sample-host.sh` (1s `/proc` window):

| Process | CPU% (instant) | RSS |
|---------|----------------|-----|
| app_jvm | ~0.1% | ~531 MB |
| postgres | ~0.0% | ~15 MB |
| redis | ~0.0% | ~8 MB |
| loadavg | 13.8 / 9.3 / 5.1 (still elevated after send-heavy; later settled) | |

Earlier pre-probe sample (before mix run): loadavg ~2.0, app RSS ~506 MB.

## Probe A — Mixed chat (`PERF_MIX=1`, default)

```bash
cd perf/k6
k6 run capacity.js
# pairs=200 targets=50→100→150→200 think_ms=50-150 delay_abort_eval=120s
```

| Signal | Value |
|--------|-------|
| Soft abort | **Yes** — `http_req_duration{name:message_send}` p95 (`abortOnFail`, k6 exit **99**) |
| Abort stage | During **150-pair** hold (after 50 and 100 stages); never reached 200 |
| Last green band (approx.) | **~100 concurrent pairs** under this aggressive mixed profile |
| `messages_sent` | 13853 (~113.6/s whole-run incl. setup/ramp) |
| `http_reqs` | 21783 (~178.7/s whole-run; includes setup logins) |
| Send fail rate | 0% |
| checks | 100% |

Whole-run k6 rates dilute ramp + early abort; they are **not** a sustained SLA. Soft ceiling is better expressed as **~100 concurrent DM pairs** under this profile.

### Latency (mixed, aborted run)

| Metric | p95 | p99 |
|--------|-----|-----|
| `http_req_duration{name:message_send}` / `message_send_duration` | **~552–554 ms** | **~758–770 ms** |
| `ws_event_lag` | **~556 ms** | **~848 ms** |
| `inbox_list_duration` | **~800 ms** | **~1.01 s** |
| `message_history_duration` | **~550 ms** | **~731 ms** |

Send p95 crossed the ticket-04 soft stop (500 ms). WS lag p95 stayed under 1 s. Inbox list remained the slowest REST path and contended with send under 150 VUs.

### Request mix (in-scenario REST; setup logins excluded)

| Kind | Count | Share |
|------|------:|------:|
| `message_send` | 13853 | 64.8% |
| `message_history` | 4690 | 21.9% |
| `conversation_list` | 2840 | 13.3% |
| **HTTP total** | **21383** | 100% |

WS (not HTTP): `presence_heartbeats=300`, `MESSAGE_CREATED=13853`.

### Peak resource notes (mixed)

- app RSS grew ~506 → ~535 MB during earlier aborted ladders on this host  
- Watch loadavg during mixed probe stayed ~1.6–2.5 (1-minute) on the prior characterization pass  
- Postgres/Redis RSS flat (~15 MB / ~8 MB); docker stats unavailable without socket permissions — sampled host `postgres` / `redis-server` PIDs instead  

## Probe B — Send-heavy (`PERF_MIX=0`)

```bash
PERF_MIX=0 k6 run capacity.js
```

| Signal | Value |
|--------|-------|
| Soft abort | **Did not fire** through **200 pairs** (exit 0) |
| Documented max probe | No soft ceiling found below **200 pairs** / ~**574 msg/s** whole-run / ~**576 HTTP req/s** |
| `messages_sent` | 123085 (~573.9/s whole-run) |
| `ws_events_received` | 123055 (matches sends within noise) |
| Send fail rate | 0% |
| Send p95 / p99 | **331 ms** / **523 ms** |
| `ws_event_lag` p95 / p99 | **332 ms** / **524 ms** |
| REST mix | `message_send` 100% (123085) |

Host during send-heavy: 1-minute loadavg peaked ~**22** (laptop heavily contended); `ps` lifetime `%cpu` on the JVM climbed into the mid-60s (use instantaneous sampling for future notes — script updated).

## Interpretation

1. **Mixed chat-like traffic** (periodic inbox + history + aggressive think-time) hits the ticket-04 soft stops around **~100–150 concurrent DM pairs** on this laptop. Limiter: **REST latency** (send p95 over 500 ms; inbox still the slowest path), with WS lag tracking send time — not error rate.  
2. **Do not quote one average req/s as system capacity.** Mixed abort run showed ~**114 msg/s** / ~**179 HTTP req/s** whole-run at the soft cliff; send-heavy sustained hundreds of msg/s through 200 pairs. Capacity depends on **profile**.  
3. **Send-heavy** traffic stays under soft stops through **200 pairs**, so the write + in-memory STOMP path is not the first cliff when inbox/history are in the mix.  
4. Ticket 04’s green 100-pair stress (~70 msg/s, think 400–1200ms, no mix) remains consistent with the mixed green band (~100 pairs).  
5. Quote **msg/s** and **HTTP req/s** separately; heartbeats are not HTTP.

## Harness delivered

| Artifact | Role |
|----------|------|
| `../../k6/capacity.js` | Capacity ladder + mix + p99 + mix artifact |
| `../../k6/lib/capacity-plan.js` (+ tests) | Ladder targets, stages, REST mix shares |
| `../../scripts/sample-host.sh` | Idle/peak host sampling |
| `../../RUNBOOK.md` | Capacity knobs + resource procedure |
| `../../k6` / `realistic` / `stress` | `p(99)` in summary trends; stress reuses ladder helpers |

## Commands run

```bash
cd perf/k6 && npm test          # 6/6
cd perf/seed && npm test        # 10/10
k6 run smoke.js                 # exit 0
PERF_PAIRS=8 … k6 run capacity.js
k6 run capacity.js              # mixed — abort at 150 pairs, exit 99 (2026-10-12)
PERF_MIX=0 k6 run capacity.js   # send-heavy — full 200, exit 0 (2026-10-11)
PERF_PAIRS=3 PERF_DURATION_S=20 k6 run realistic.js  # exit 0
```

## Commit

Skipped: workspace is not a git repository (no `.git`).
