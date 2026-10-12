# Sender Chat load-test operator runbook

Exploratory k6 harness against the **public REST + STOMP API** on a **single app instance** (in-memory STOMP broker). This is not a CI gate or an SLA certificate — use it to find where the single-node stack soft-fails under DM chat load.

## Prerequisites

1. Postgres + Redis up (Docker Compose or local).
2. Backend running with the perf overlay from `perf/env.perf.example` copied into `backend/.env` (raised rate limits + longer JWT). Do **not** use that overlay for normal local development.
3. Seeded artifacts: `perf/data/users.json` and `pairs.json` (gitignored).

```bash
# Wipe durable + ephemeral state when you need a clean dataset
# (adjust credentials to your local Postgres/Redis)
PGPASSWORD=… psql -h localhost -U postgres -d sender -c '
  TRUNCATE TABLE message_attachments, messages, conversation_members, conversations,
    friendships, refresh_tokens, users RESTART IDENTITY CASCADE;'
redis-cli FLUSHALL

cd perf/seed && npm run seed:full   # ~200 users / 100 DM pairs
```

Confirm health: `curl -s http://localhost:8080/actuator/health`

## Scenarios

| Script | Intent | Default shape |
|--------|--------|---------------|
| `perf/k6/smoke.js` | One pair, one send, one `MESSAGE_CREATED` | 1 sender + 1 receiver |
| `perf/k6/realistic.js` | Human-like chat | ~50 pairs, think-time 2–5s, occasional inbox/history |
| `perf/k6/stress.js` | Stress ladder + soft stops | Ramp toward ~100 pairs, think-time ~0.4–1.2s |
| `perf/k6/capacity.js` | Capacity threshold probe | Default ~200 pairs, think-time ~50–150ms, mixed REST reads, p95/p99 |
| `perf/k6/endpoint.js` | **One REST endpoint** at a time | VU ladder; select path with `PERF_ENDPOINT` |

```bash
cd perf/k6
k6 run smoke.js
PERF_DURATION_S=90 k6 run realistic.js
k6 run stress.js
k6 run capacity.js
PERF_ENDPOINT=conversation_list k6 run endpoint.js
```

### Stress ladder knobs

| Env | Default | Meaning |
|-----|---------|---------|
| `PERF_PAIRS` | 100 | Max DM pairs (capped by seed) |
| `PERF_STAGE_RAMP_S` | 15 | Seconds to ramp between ladder steps |
| `PERF_STAGE_HOLD_S` | 30 | Hold at 25% / 50% / 75% |
| `PERF_PEAK_HOLD_S` | 45 | Hold at 100% |
| `PERF_THINK_MIN_MS` / `PERF_THINK_MAX_MS` | 400 / 1200 | Pause between sends (targets ~50–100 msg/s at peak) |
| `PERF_SOFT_ABORT` | `1` | `0` disables abort-on-threshold (still reports) |
| `PERF_DELAY_ABORT_EVAL` | `45s` | Ignore soft thresholds during warm-up |
| `PERF_API_URL` / `PERF_WS_URL` | localhost:8080 | Override targets |

Short local check:

```bash
PERF_PAIRS=8 PERF_STAGE_RAMP_S=5 PERF_STAGE_HOLD_S=8 PERF_PEAK_HOLD_S=12 k6 run stress.js
```

Each stress / capacity VU owns one seeded DM pair: it keeps a STOMP subscription as the receiver and REST-sends as the sender on the same VU (avoids k6’s global `__VU` id clash across scenarios).

### Capacity probe knobs (ticket 05)

Pushes past the ticket-04 green band to find a soft ceiling (or document “no ceiling found”). Soft-stop signals are the same as stress.

| Env | Default | Meaning |
|-----|---------|---------|
| `PERF_PAIRS` | 200 | Requested max DM pairs (capped by seeded `pairs.json`) |
| `PERF_STAGE_RAMP_S` / `PERF_STAGE_HOLD_S` / `PERF_PEAK_HOLD_S` | 10 / 20 / 60 | Ladder timing (longer peak than stress) |
| `PERF_THINK_MIN_MS` / `PERF_THINK_MAX_MS` | 50 / 150 | Aggressive send pacing |
| `PERF_MIX` | `1` | `1` = occasional inbox + history (chat-like); `0` = send-heavy only |
| `PERF_LADDER_FRACTIONS` | `0.25,0.5,0.75,1` | Comma fractions for VU targets |
| `PERF_MIX_OUT` | `../data/capacity-last-mix.json` | Request-mix artifact (gitignored under `perf/data/`) |
| `PERF_SOFT_ABORT` | `1` | Abort ladder when soft thresholds breach |
| `PERF_DELAY_ABORT_EVAL` | `120s` | Skip abort during setup + first ramp (stress default is `45s`) |

Short local check:

```bash
PERF_PAIRS=8 PERF_STAGE_RAMP_S=5 PERF_STAGE_HOLD_S=8 PERF_PEAK_HOLD_S=12 k6 run capacity.js
```

End-of-run summary includes **p95 and p99**, plus a **REST request-mix** table for in-scenario chat traffic (`message_send`, and when `PERF_MIX=1` also `conversation_list` / `message_history`). Setup logins (2× pairs) are excluded from that mix so early abort does not inflate `auth_login` share. Heartbeats and `MESSAGE_CREATED` are listed separately — they are not HTTP requests.

`PERF_PAIRS` defaults to 200 but is **capped by the seed** (`configuredPairCount`). `npm run seed:full` yields ~100 pairs; re-seed with a higher `--pairs` if you want the full 200-pair ladder. Quote whole-run k6 rates with care — they dilute ramp/cool-down; note the abort stage when soft stops fire.

### Host resource sampling (noisy laptop)

CPU% on a personal laptop is shared with other desktop processes. Capture an **idle baseline** (app up, seed done, no k6) and samples during the peak/abort stage:

```bash
# one-shot
./perf/scripts/sample-host.sh

# during a capacity run (second terminal)
./perf/scripts/sample-host.sh --watch 2
```

Optional: set `PERF_PG_CONTAINER` / `PERF_REDIS_CONTAINER` (defaults `sender-postgres` / `sender-redis`) or `PERF_JAVA_PATTERN`. Record load average alongside process CPU/RSS in the results note.

### Per-endpoint probe (ticket 06) — how to run

Isolates **one** public REST path so you can find that endpoint’s soft ceiling without mixed chat traffic. Default endpoint is `conversation_list` (ticket-05 bottleneck).

#### 1) Catalog (change endpoint here)

| `PERF_ENDPOINT` | Method + path | Notes |
|-----------------|---------------|-------|
| `auth_login` | `POST /api/v1/auth/login` | No pre-login in setup; each iteration logs in |
| `conversation_list` | `GET /api/v1/conversations` | Inbox list (`PERF_LIST_LIMIT`, default 30) |
| `message_history` | `GET /api/v1/conversations/{id}/messages` | History (`PERF_HISTORY_LIMIT`, default 50) |
| `message_send` | `POST /api/v1/conversations/{id}/messages` | Creates durable messages — re-seed if the DB gets huge |

```bash
cd perf/k6

# List / validate ids: unknown values throw at startup with the known catalog.
PERF_ENDPOINT=conversation_list k6 run endpoint.js

# Other endpoints (same load knobs):
PERF_ENDPOINT=message_history k6 run endpoint.js
PERF_ENDPOINT=message_send k6 run endpoint.js
PERF_ENDPOINT=auth_login k6 run endpoint.js
```

To add a new catalog id later: extend `perf/k6/lib/endpoints.js`, add a branch in `invokeEndpoint` inside `endpoint.js`, and cover it in `endpoints.test.mjs`.

#### 2) Change load (VU ladder + think-time)

| Env | Default | Meaning |
|-----|---------|---------|
| `PERF_ENDPOINT` | `conversation_list` | Which catalog id to hammer |
| `PERF_VUS` | 50 | Max concurrent VUs (capped by seeded pair count) |
| `PERF_STAGE_RAMP_S` / `PERF_STAGE_HOLD_S` / `PERF_PEAK_HOLD_S` | 10 / 20 / 40 | Ladder timing |
| `PERF_LADDER_FRACTIONS` | `0.25,0.5,0.75,1` | VU targets as fractions of `PERF_VUS` |
| `PERF_THINK_MIN_MS` / `PERF_THINK_MAX_MS` | 50 / 150 | Pause after each call |
| `PERF_P95_MS` | 500 | Soft-stop p95 threshold for **this** endpoint |
| `PERF_SOFT_ABORT` | `1` | `0` = report thresholds but do not abort |
| `PERF_DELAY_ABORT_EVAL` | `60s` | Ignore abort during setup + early ramp |
| `PERF_LIST_LIMIT` / `PERF_HISTORY_LIMIT` | 30 / 50 | Query `limit` for list/history |
| `PERF_API_URL` | `http://localhost:8080` | API base |

Examples:

```bash
# Light local check (~8 VUs, short stages)
PERF_ENDPOINT=conversation_list PERF_VUS=8 \
  PERF_STAGE_RAMP_S=5 PERF_STAGE_HOLD_S=8 PERF_PEAK_HOLD_S=12 \
  k6 run endpoint.js

# Heavier ladder, looser latency budget, no abort (measure only)
PERF_ENDPOINT=message_history PERF_VUS=100 PERF_P95_MS=1000 PERF_SOFT_ABORT=0 \
  k6 run endpoint.js

# Faster hammer (less think-time) on message send
PERF_ENDPOINT=message_send PERF_VUS=40 \
  PERF_THINK_MIN_MS=20 PERF_THINK_MAX_MS=80 \
  k6 run endpoint.js
```

Soft stops (when `PERF_SOFT_ABORT=1`):

| Signal | Default | Metric |
|--------|---------|--------|
| Error rate | < 1% | `http_req_failed{name:<tag>}` |
| Latency | p95 < `PERF_P95_MS` | `http_req_duration{name:<tag>}` |

k6 exit **99** ≈ soft ceiling found. Note the VU band on screen when abort fires (`endpoint [ … ] N/M VUs`).

#### 3) Grow dataset and compare two runs

Keep **the same** `PERF_ENDPOINT` and load knobs; only change the seed. That isolates “does a larger DM corpus move the soft band?”

```bash
# --- Baseline seed (example: current artifacts, or seed:full) ---
# Record: pair count, messages-min/max, and k6 summary (p95/p99, abort stage, endpoint_calls).

# --- Wipe + larger seed (ticket 06 compare profile) ---
PGPASSWORD=… psql -h localhost -U postgres -d sender -c '
  TRUNCATE TABLE message_attachments, messages, conversation_members, conversations,
    friendships, refresh_tokens, users RESTART IDENTITY CASCADE;'
redis-cli FLUSHALL

cd perf/seed
npm run seed:compare   # 400 pairs, 80–150 messages/pair, concurrency 8
# Or custom:
# npm run seed -- --pairs 500 --messages-min 100 --messages-max 200 --concurrency 8

cd ../k6
# Same knobs as baseline:
PERF_ENDPOINT=conversation_list PERF_VUS=50 k6 run endpoint.js
```

Compare side by side in your notes:

| Field | Baseline seed | Larger seed |
|-------|---------------|-------------|
| Seed pairs / msg range | … | … |
| Abort? / last green VU band | … | … |
| req/s (`http_reqs` or `endpoint_calls`) | … | … |
| p95 / p99 | … | … |

**Tip:** `message_history` is more sensitive to `--messages-min/max` than `conversation_list` (this seed gives each user roughly one DM). Use history when you care about corpus depth; use list when you care about concurrent inbox readers.

#### 4) Acceptance note for ticket 06

The harness lands all four catalog ids. The written results file documents **one** endpoint end-to-end (baseline + larger seed). Run the other ids yourself with the commands above.

## Soft stop signals (stress / capacity)

Configured as k6 thresholds with `abortOnFail` (when `PERF_SOFT_ABORT=1`):

| Signal | Threshold | Metric |
|--------|-----------|--------|
| Send error rate | < 1% | `http_req_failed{name:message_send}` |
| REST send latency | p95 < 500ms | `http_req_duration{name:message_send}` |
| Send → `MESSAGE_CREATED` lag | p95 < 1s | `ws_event_lag` (client send-start timestamp embedded in body) |

A non-zero k6 exit from a threshold abort means the **ladder found a soft limit** — that is useful exploratory output, not necessarily a harness defect. Compare against a green `realistic.js` run on the same seed.

### How to read the summary

- `messages_sent` vs `ws_events_received` — should stay close (one receiver event per successful send for that pair). Large gaps → dropped STOMP delivery, slow receivers, or early abort.
- `message_send_duration` / tagged `http_req_duration{name:message_send}` — REST path (authz, DB commit, after-commit publish scheduling).
- `ws_event_lag` — full path from sender `Date.now()` before POST until receiver parses `MESSAGE_CREATED` (REST + commit + in-memory broker + WS).
- Ladder step where abort fires ≈ first concurrent-pair band that breached a soft threshold on this host.

## What to watch during a stress run

Open these in a second terminal **before** `k6 run stress.js`. Soft stops tell *that* the system struggled; these notes tell *where*.

### Host (app JVM)

```bash
# CPU / memory pressure on the machine hosting the Spring Boot process
top -H -p "$(pgrep -nf 'com.sender.backend.BackendApplication')"
# or: pidstat -u -r -p <pid> 1
```

Watch for: sustained CPU ~100% on the app process, rising RSS, GC thrash (if you use `-Xlog:gc*` / VisualVM). Single-instance in-memory STOMP means all fan-out shares that JVM.

### PostgreSQL

```bash
PGPASSWORD=… psql -h localhost -U postgres -d sender -c "
  SELECT state, count(*) FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()
  GROUP BY 1 ORDER BY 2 DESC;"

# Hot locks / long queries while senders are active
PGPASSWORD=… psql -h localhost -U postgres -d sender -c "
  SELECT wait_event_type, wait_event, left(query, 100)
  FROM pg_stat_activity
  WHERE datname = current_database() AND state <> 'idle'
  ORDER BY query_start;"
```

Watch for: many `active` / `idle in transaction` sessions, `Lock` wait events on conversation/message rows, send p95 climbing while DB waits dominate.

### Redis

```bash
redis-cli INFO clients
redis-cli INFO stats | grep -E 'instantaneous_ops|rejected|evicted'
redis-cli --latency
```

Watch for: rising `connected_clients` (presence heartbeats), elevated `instantaneous_ops_per_sec`, latency spikes. Redis is **ephemeral** (presence / short-lived cache / fan-out helpers) — it should not be the durability bottleneck; if send latency is fine but presence looks sick, note it separately from message durability.

### Correlation cheat-sheet

| Soft stop | Likely place to look first |
|-----------|----------------------------|
| Send error rate > 1% | App logs (4xx/5xx), rate limits, pool exhaustion |
| Send p95 > 500ms | Postgres waits, Hikari pool, lock contention on DM send |
| WS lag p95 > 1s | JVM/STOMP saturation, receiver connect gaps, GC — after REST p95 is already healthy |

## After the run

1. Capture the k6 end-of-test summary (and whether abort fired).
2. Note peak pair band reached and approx `messages_sent / effective_send_seconds`.
3. Keep host/DB/Redis observations next to that summary under `.scratch/k6-load-testing/results/` when documenting a ticket.
4. Re-seed if the dataset is dirty enough to skew follow-up runs (`seed:full` after truncate + `FLUSHALL`).
)
