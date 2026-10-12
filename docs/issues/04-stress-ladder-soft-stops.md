# 04: Stress ladder with soft stop signals

**What to build:** An operator can ramp stress load toward about 100 DM pairs and about 50–100 messages per second, see custom metrics for sends, WS receives, and send-to-`MESSAGE_CREATED` lag, and stop the ladder when soft exploratory thresholds are breached, correlating with basic host/Postgres/Redis observation notes in the runbook.

**Blocked by:** 03 — Realistic chat load scenario.

**Status:** done

- [x] Stress scenario ramps toward ~100 pairs / ~50–100 msg/s on a single app instance
- [x] Custom metrics cover messages sent, WS events received, and WS event lag
- [x] Soft stop signals are configured: error rate > 1%, REST send p95 > 500ms, send→WS lag p95 > 1s
- [x] Runbook explains how to interpret results and what to watch on host/DB/Redis during the run

## Results

See [../results/04-stress-ladder-soft-stops.md](../results/04-stress-ladder-soft-stops.md).

- `k6 run stress.js` (100 pairs, default ladder): exit 0, checks 100%, `messages_sent=ws_events_received=16787` (~70.6/s overall), send p95 ~12ms, `ws_event_lag` p95 ~13ms, soft-stop abort did not fire
- Operator runbook: `../../RUNBOOK.md`
- One VU per pair (STOMP + REST) avoids cross-scenario `__VU` collisions
