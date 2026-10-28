# Review implementation — October 28, 2026

All priorities from the code review were implemented in this change. No live state or credentials were used in isolated server/browser tests.

| Priority | Review item | Implementation |
| --- | --- | --- |
| P1 | Timing bypasses | Exact and model-equivalent open-group matches share the five-minute guard; temporary-question metadata applies it to saved-answer reuse too. |
| P1 | Answer loss on merge | Existing answers transfer to pending destinations; conflicts require an explicit choice; previous versions are preserved. |
| P1 | Failed/lost AI work | Persisted detection inbox and grouping jobs, bounded backoff, restart recovery, manual reprocessing. |
| P1 | Arrivals during AI | Per-message tracking is resolved against the resulting groups after the asynchronous call. |
| P1 | Indirect questions | Structured semantic detection supplements the immediate local question/command path. |
| P2 | Stale answers | Session-only default, permanent opt-in, explicit new live session, old answers kept for review. |
| P2 | OBS link rotation | Persisted encrypted token; explicit regeneration with confirmation. |
| P2 | Unbounded HTTP waits | Twitch HTTP timeout and single-flight token refresh. |
| P2 | Twitch recovery | Per-socket watchdogs, bounded handshake, migration cleanup, credential revalidation. |
| P2 | Candidate retrieval | Cached multilingual vectors rank more than 30 eligible candidates. |
| P2 | Reply visibility/control | Pause/resume, bounded persisted logs/jobs, cancelled/failed/partial/unknown outcomes. |
| P2 | Storage robustness | Validated legacy import, SQLite WAL transactions, snapshots, backup recovery, restore CLI, single-process lease. |
| P2 | Consumption/retention | Configurable hard call/token ceilings, per-viewer intake limits, group cap, archived hourly retention. |
| P2 | Hosting sessions/tokens | Persistent encrypted sessions and OAuth credentials; same secret/data directory required across restart. |
| P3 | Polling races | Serialized loader, forced post-action reload, request timeouts. |
| P3 | Docs/tests | Updated walkthrough, public-answer demo, migration/recovery instructions, expanded regression and live semantic evaluations. |
| P3 | Frontend maintainability | Separate dashboard, OBS, review, operations, types, API, and workspace hook. |

## Operating choices

- Five minutes is the automatic open-question grouping window, not a promise that every similar sentence will merge. Saved answers use their explicit scope; temporary questions also keep the time guard.
- AI defaults: 200 requests / 200,000 reserved or actual tokens per live session; 2,000 groups; 30-day retention. Failures keep conservative token reservations. This is not a dollar budget.
- SQLite retains 20 snapshots; JSON backups from explicit clears are retained until the operator removes them. Backup files contain viewer data.
- Exactly-once public delivery cannot be guaranteed across an external API boundary. A persisted in-flight send with uncertain outcome is deliberately not retried after restart.
- Local semantic evaluation uses synthetic content and makes paid OpenAI calls. Mock Twitch tests do not establish real-account permission or network behavior.
- One process and one channel per data directory. Horizontal hosting remains outside this implementation; a second process is rejected rather than silently diverging.

## First restart after this update

1. Stop the old process and restart with Node.js 24+.
2. Existing JSON is imported to the adjacent SQLite database without deleting the source JSON.
3. Reconnect Twitch once because the previous version only kept credentials in memory.
4. Copy the new OBS link once. Subsequent restarts preserve it unless explicitly regenerated or the encryption key changes.
5. Check session-only/permanent scope on saved answers. Starting a new live session expires session-only reuse without deleting the answer history.
