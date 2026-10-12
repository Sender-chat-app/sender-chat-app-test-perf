# Ticket 01 results — Smoke harness for one DM pair

**Date:** 2026-10-08  
**Status:** Done (acceptance criteria met)

## Acceptance

| Criterion | Result |
|-----------|--------|
| Perf env overlay documented without changing safe defaults | Pass — `../../env.perf.example` + comments in `backend/.env.example` |
| Node REST seeder: 2 users, friendship, DM, few messages, gitignored artifacts | Pass — `npm run seed:smoke` → `conversationId=1`, wrote `perf/data/*.json` |
| k6 smoke: sender + receiver STOMP, heartbeat, send, `MESSAGE_CREATED` | Pass — checks 100% (5/5) |
| Runbook wipe/seed/run | Pass — `../../README.md` |

## Commands run

```bash
cd perf/seed && npm test          # 5/5 pass
cd perf/seed && npm run seed:smoke
cd perf/k6 && k6 run smoke.js     # exit 0
```

## k6 smoke summary (second run)

- checks: 100% (receiver WS 101, STOMP connected, MESSAGE_CREATED; sender 2xx + id)
- http_req_failed: 0%
- messages_sent: 1
- ws_events_received: 1
- Note: send endpoint returns **201 Created** (check uses 2xx)

## Unit tests

Seam: pure helpers `buildPairArtifact` / STOMP frame build-parse (aligned with browser client).

## Commit

Skipped: workspace is **not a git repository** (no `.git`). Initialize git (or open a repo) before committing.

## Code review (post-implement)

### Standards
- No hard AGENTS breaches; `../../data` gitignored; seed password is disposable load-test-only in source.
- Judgement: STOMP framing duplicated (seed tested / k6 not); friendship 409 detected via error string.

### Spec
- Acceptance met for local smoke path.
- Partial/clarified: staging URL env vars documented; heartbeat now intervals every 30s while waiting.
- Mild scope: `--pairs`/`--messages` flags ahead of ticket 02; idempotent re-seed helpers.

## Follow-ups (ticket 02+)

- Scale seeder to ~200 users / 100 pairs
- Realistic + stress scenarios
- Fold notes into existing `docs/*.md` (deferred)

