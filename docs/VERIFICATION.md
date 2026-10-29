# Verification record

Updated October 29, 2026 with Node.js 24. The latest full deterministic suite passed 139 tests; earlier live checks are recorded separately below.

## Automated verification

- TypeScript validation, production Vite build, extension packaging, compiled-backend import verification and Prettier format check passed.
- All 139 deterministic tests passed in the latest run. They cover authorization, viewer privacy, origin protection, ordinary questions, minority eligibility, unique supporters, immutable spins, manual choices, participant exclusions, and OBS synchronization.
- Regression tests cover timing for exact and semantic matches, temporary questions, conflicting answer merges, history preservation, recovered AI jobs, indirect detection, and messages arriving while grouping is pending.
- Persistence tests cover legacy JSON import, SQLite recovery, encrypted tokens and sessions, persistent OBS token, scope expiry, hard AI budget reservations, retention, paused replies, queue recovery, uncertain sends, process leases, and serialized frontend reloads.
- Twitch tests use mocked HTTP and local WebSocket servers. They cover deduplication, reconnect/resubscription, revocation, session migration without resubscription, independent socket lifetimes, single-flight credential refresh, and HTTP cancellation.

## Live semantic evaluation

`npm run test:ai` makes paid API calls with synthetic examples only. It checks six equivalence/distinction fixtures, four timing/distinction holdouts, multilingual indirect detection, and semantic retrieval among more than 30 candidates. The initial run exposed inconsistent separation of beginner-community-growth wording; the instructions were clarified and the full evaluation passed. These samples do not guarantee every future model decision.

## Isolated browser verification

A separate server with empty Twitch/OpenAI credentials and temporary storage was used. Confirmed demo entry, new operations controls, pause/resume state, new-live-session confirmation/cancellation, answer scope selection, single-action answer save/close, answer editing/history availability, and dialog/save-button bounds inside the viewport. No screenshots or live viewer data were published. The temporary server and browser tab were closed afterward.

## Still requires the operator’s real channel

After applying all required [hosted migrations](hosting.md#database) and deploying, verify real public replies, long-stream token renewal/network recovery, and the retained OBS source link. The operator has reported successful live translated replies; repeat acceptance checks after changes to delivery or authorization. No live Twitch messages were sent by automated tests. Production reverse proxy/TLS configuration depends on the chosen host. Automated test results alone do not establish deployment success.

See [implementation review](IMPLEMENTATION-REVIEW.md) for the completed priority matrix and migration steps.

## Multilingual presentation — October 28 update

- The earlier multilingual evaluation covered catalog coverage in Spanish/German/Russian, interpolation/plurals, unchanged configuration names and commands, original-language presentation, all four cached question languages, active-spin freezing, stale translation invalidation, retry backoff, and HTTP/OBS language consistency.
- Live synthetic question translation was verified separately for English, Spanish, Russian and German. Original inputs remained unchanged.
- An isolated browser/server with no Twitch or OpenAI credentials was used to switch the interface through English, Spanish, Russian and German. Question language was changed independently; a Russian spotlight question with German interface text matched the OBS presentation. No screenshots or real chat data were displayed. Test tabs and server were closed; the operator starts the actual project.

## Latest regression and presentation checks — October 29

The 139-test suite includes no-key approved replies, single-inference reply translation, stale moderator-edit rejection, client validation status codes, invalid overlay signatures without channel creation, forced-language title editing, raw-byte EventSub signatures, scoped subscription deletion and bounded Twitch reconnect/refresh failures. See [rollout checklist](stabilization-verification.md) for remaining live checks.

An isolated demo was checked at 1920×1080, 1280×800 and 390×844. Dashboard text has a 13 px CSS minimum, controls 14 px and question titles 15 px; the checked demo text/background pairs meet a 4.5:1 contrast ratio. This is a targeted presentation check, not a complete WCAG audit. No paid provider calls or real Twitch messages were used for these latest checks.
