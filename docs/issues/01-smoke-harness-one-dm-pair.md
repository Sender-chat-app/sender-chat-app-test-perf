# 01: Smoke harness for one DM pair

**What to build:** An operator can wipe a local/staging perf environment, apply raised rate-limit / JWT env overlays, seed a single friendship-backed DM with a few messages via the public REST API, and run a k6 smoke that logs both users in, keeps a STOMP receiver on `/user/queue/events` with presence heartbeats, sends a text message over REST, and observes `MESSAGE_CREATED` on the receiver — proving the load harness works end-to-end before scaling data or load.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Perf env overlay is documented (raised auth/friendship/conversation/message limits and longer JWT) without changing safe defaults for normal development
- [x] A Node REST seeder can create two users, friend request/accept, one direct conversation, a few seed messages, and write a gitignored pair credential artifact
- [x] k6 smoke uses one sender VU and one receiver VU against that pair: login with email/password, Bearer on REST and STOMP CONNECT, subscribe, heartbeat, send, receive `MESSAGE_CREATED`
- [x] Operator runbook covers wipe Postgres/Redis, seed, and run smoke successfully on a single app instance

## Results

See [../results/01-smoke-harness.md](../results/01-smoke-harness.md).

- `../../seed` unit tests: 5/5 pass
- `npm run seed:smoke`: seeded `conversationId=1`, wrote `../../data/users.json` + `pairs.json`
- `k6 run smoke.js`: exit 0, checks 100%, `messages_sent=1`, `ws_events_received=1`
- Commit: blocked (no git repo in workspace)
