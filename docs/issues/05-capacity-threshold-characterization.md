# 05: Capacity threshold characterization

**What to build:** An operator can drive the single-app DM stack past the ticket-04 soft-stop band until a reproducible capacity threshold appears (or until a documented “no ceiling found” ceiling on this host), and leave behind a results note that answers four questions for a personal-laptop run: sustained request/message throughput, p95/p99 latency, how much hardware the stack actually used amid other local processes, and the mix of request types in the run.

**Blocked by:** 04 — Stress ladder with soft stop signals.

**Status:** done

- [x] Capacity scenario (or stress extension) can push beyond the green 100-pair / ~70 msg/s band from ticket 04 until soft stops fire, or until a stated max probe is reached without breach
- [x] End-of-run summary reports sustained **req/s** (and **msg/s**) plus **p95 / p99** for the primary chat paths
- [x] Operator procedure samples **host resource use** for app JVM, Postgres, Redis, and k6, with an idle baseline so laptop noise is visible
- [x] Results document the **request mix** (counts and share) across tagged REST ops, STOMP presence heartbeats, and WS `MESSAGE_CREATED` receives
- [x] Findings are written under `.scratch/k6-load-testing/results/05-…` and summarized in `../../README.md` / runbook pointers

## Results

See [../results/05-capacity-threshold-characterization.md](../results/05-capacity-threshold-characterization.md).

- Mixed (`PERF_MIX=1`): soft abort at **150 pairs** — send p95 ~552 ms; REST mix ~65% send / 22% history / 13% inbox; whole-run ~114 msg/s / ~179 HTTP req/s (not a sustained SLA)
- Send-heavy (`PERF_MIX=0`): **no soft ceiling** through 200 pairs — ~574 msg/s whole-run, send p95 ~331ms / p99 ~523ms
- Harness: `../../k6/capacity.js`, `perf/scripts/sample-host.sh`, capacity-plan unit tests 6/6
