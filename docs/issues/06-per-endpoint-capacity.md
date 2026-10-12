# 06: Per-endpoint capacity probes + dataset comparison

**What to build:** An operator can probe **one REST endpoint at a time** with a documented VU ladder, soft-stop thresholds, and p95/p99 reporting; switch the target endpoint and load knobs via env vars without editing scenario logic; grow the seeded DM dataset and re-run the **same** endpoint probe to compare how dataset size shifts the soft capacity band.

**Blocked by:** 05 — Capacity threshold characterization.

**Status:** done

- [x] Endpoint catalog covers the main seed-backed chat REST paths (at least login, conversation list, message history, message send)
- [x] Single k6 entrypoint selects the endpoint via env and runs an isolated ladder (no mixed traffic)
- [x] Operator runbook explains how to change endpoint, load shape, soft stops, and how to grow the seed then compare two runs
- [x] Baseline probe recorded for **one** endpoint; larger dataset generated; same endpoint re-probed; results compare the two
- [x] Findings under `.scratch/k6-load-testing/results/06-…` and summarized in `../../README.md`

## Results

See [../results/06-per-endpoint-capacity.md](../results/06-per-endpoint-capacity.md).

- Harness: `../../k6/endpoint.js`, catalog + tests (`resolveEndpoint`), `npm run seed:compare`
- Acceptance endpoint **`conversation_list`**: baseline (~300 pairs) vs larger (400 pairs / 45415 msgs) — p95 ~3.87s vs ~3.86s (no meaningful shift); floor ~700ms so default 500ms soft stop never greens
- Operator docs: `../../RUNBOOK.md` § Per-endpoint probe — change `PERF_ENDPOINT` / `PERF_VUS` / think-time / soft stops; other catalog ids left for the operator
