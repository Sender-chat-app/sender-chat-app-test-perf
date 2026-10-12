# 03: Realistic chat load scenario

**What to build:** An operator can run a realistic k6 chat scenario (default about 50 DM pairs) where senders post with human-like think-time, occasionally refresh conversation list and message history, receivers stay on STOMP with heartbeats, and the summary shows useful latency/throughput signals for “normal” concurrent chat.

**Blocked by:** 02 — Full DM dataset seed.

**Status:** done

- [x] Realistic scenario loads pair artifacts and runs paired sender/receiver VUs
- [x] Sender think-time is about 2–5 seconds between sends; occasional inbox and message-history reads are included
- [x] Receivers maintain STOMP subscription and ~30s presence heartbeats
- [x] Run completes with a readable k6 summary suitable for comparing against stress runs

## Results

See [../results/03-realistic-chat-load.md](../results/03-realistic-chat-load.md).

- `k6 run realistic.js` (50 pairs, 90s): exit 0, checks 100%, `receiver_got_message_created=100%`, `messages_sent=1164`, `ws_events_received=1164`, `message_send_duration` p95 ~238ms
- Pair index uses `exec.scenario.iterationInTest` (fixes `shared-iterations` + `__ITER` pinning every VU to pair 0)
- Custom metrics ready for ticket 04 stress comparison
- Smoke still passes after shared HTTP helper changes
