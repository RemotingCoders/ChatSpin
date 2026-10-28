# Verification record

Checked October 28, 2026 with Node.js 24.

## Automated verification

- TypeScript validation and production Vite build.
- All 52 deterministic tests passed. They cover authorization, viewer privacy, origin protection, ordinary questions, minority eligibility, unique supporters, immutable spins, manual choices, participant exclusions, and OBS synchronization.
- Regression tests cover timing for exact and semantic matches, temporary questions, conflicting answer merges, history preservation, recovered AI jobs, indirect detection, and messages arriving while grouping is pending.
- Persistence tests cover legacy JSON import, SQLite recovery, encrypted tokens and sessions, persistent OBS token, scope expiry, hard AI budget reservations, retention, paused replies, queue recovery, uncertain sends, process leases, and serialized frontend reloads.
- Twitch tests use mocked HTTP and local WebSocket servers. They cover deduplication, reconnect/resubscription, revocation, session migration without resubscription, independent socket lifetimes, single-flight credential refresh, and HTTP cancellation.

## Live semantic evaluation

`npm run test:ai` makes paid API calls with synthetic examples only. It checks six equivalence/distinction fixtures, four timing/distinction holdouts, multilingual indirect detection, and semantic retrieval among more than 30 candidates. The initial run exposed inconsistent separation of beginner-community-growth wording; the instructions were clarified and the full evaluation passed. These samples do not guarantee every future model decision.

## Isolated browser verification

A separate server with empty Twitch/OpenAI credentials and temporary storage was used. Confirmed demo entry, new operations controls, pause/resume state, new-live-session confirmation/cancellation, answer scope selection, single-action answer save/close, answer editing/history availability, and dialog/save-button bounds inside the viewport. No screenshots or live viewer data were published. The temporary server and browser tab were closed afterward.

## Still requires the operator’s real channel

After the migration restart, reconnect Twitch once and verify a real public reply, long-stream token renewal/network recovery, and the retained OBS source link. No live Twitch messages were sent by automated tests. Production reverse proxy/TLS configuration depends on the chosen host; this change performs no deployment.

See [implementation review](IMPLEMENTATION-REVIEW.md) for the completed priority matrix and migration steps.
