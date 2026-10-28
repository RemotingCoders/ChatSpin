# Verification record

Checked October 28, 2026 with Node.js 24.

## Automated verification

- TypeScript validation and production Vite build.
- All 61 deterministic tests passed. They cover authorization, viewer privacy, origin protection, ordinary questions, minority eligibility, unique supporters, immutable spins, manual choices, participant exclusions, and OBS synchronization.
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

## Multilingual presentation — October 28 update

- 61 deterministic tests passed, including catalog coverage in Spanish/German/Russian, interpolation/plurals, unchanged configuration names and commands, original-language presentation, all four cached question languages, active-spin freezing, stale translation invalidation, retry backoff, and HTTP/OBS language consistency.
- Live synthetic question translation was verified separately for English, Spanish, Russian and German. Original inputs remained unchanged.
- An isolated browser/server with no Twitch or OpenAI credentials was used to switch the interface through English, Spanish, Russian and German. Question language was changed independently; a Russian spotlight question with German interface text matched the OBS presentation. No screenshots or real chat data were displayed. Test tabs and server were closed; the operator starts the actual project.
