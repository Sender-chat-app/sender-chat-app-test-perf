# Ticket 02 results — Full DM dataset seed

**Date:** 2026-10-08  
**Status:** Done (acceptance criteria met)

## Acceptance

| Criterion | Result |
|-----------|--------|
| Seeder scales to ~200 users / ~100 DM pairs / ~50–100 messages per pair with bounded concurrency | Pass — `npm run seed:full` (100 pairs, messages 50–100 by index, concurrency 8) |
| Seed outputs include user and pair artifacts for paired sender/receiver assignment | Pass — 200 users / 100 pairs in gitignored JSON |
| Generated data is gitignored; wipe-then-reseed produces a usable deterministic dataset | Pass — truncate + Redis flush, then reseed |
| Smoke can be re-run successfully against the full seeded dataset | Pass — checks 100% (5/5) |

## Commands run

```bash
cd perf/seed && npm test          # 10/10 pass
# wipe durable + ephemeral state (local): truncate app tables; redis-cli FLUSHALL
cd perf/seed && npm run seed:full
cd perf/k6 && k6 run smoke.js     # exit 0
```

## Seed summary

- users: 200
- pairs: 100
- seed messages: 7451 (deterministic 50–100 per pair via `messagesForPair`)
- wall time: ~33s with concurrency 8
- wrote `../../data/users.json`, `perf/data/pairs.json`

## k6 smoke (against full dataset)

- checks: 100% (5/5)
- http_req_failed: 0%
- messages_sent: 1
- ws_events_received: 1
- Uses `pairs[0]` only (same smoke scenario as ticket 01)

## Unit tests

- Existing artifact + STOMP helpers
- New: `mapPool` order/concurrency, `messagesForPair` fixed vs range, `pairIndexes`

## Env note

Full seed needs the perf auth overlay (`RATE_LIMIT_AUTH_CREDENTIALS_MAX_HITS` ≥ ~200 from one IP). Applied locally for verification; see `../../env.perf.example`. Seed client retries HTTP 429 with backoff.

## Commit

Skipped: workspace is not a git repository (no `.git`).
