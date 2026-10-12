# 02: Full DM dataset seed

**What to build:** An operator can seed a deterministic load dataset of about 200 users, 100 friendship-backed DM pairs, and about 50–100 historical messages per conversation through the public REST API, with gitignored JSON artifacts that k6 can assign to VUs after a clean wipe-and-reseed.

**Blocked by:** 01 — Smoke harness for one DM pair.

**Status:** done

- [x] Seeder scales to ~200 users / ~100 DM pairs / ~50–100 messages per pair with bounded concurrency
- [x] Seed outputs include user and pair artifacts sufficient for paired sender/receiver assignment
- [x] Generated data is gitignored; wipe-then-reseed produces a usable deterministic dataset
- [x] Smoke can be re-run successfully against the full seeded dataset

## Results

See [../results/02-full-dm-dataset-seed.md](../results/02-full-dm-dataset-seed.md).

- `../../seed` unit tests: 10/10 pass
- `npm run seed:full`: 200 users, 100 pairs, 7451 seed messages
- `k6 run smoke.js` on full dataset: exit 0, checks 100%
