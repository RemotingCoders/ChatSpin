# ChatSpin

Give your Twitch community a turn. ChatSpin organizes interview questions and selects a question or a volunteer with a synchronized wheel.

Built from an empty directory with Codex during the Codex x TwitchCon Hackathon submission period. The interface supports English, Spanish, Russian and German. Question presentation can preserve the original language or use any of those four languages; original viewer messages remain intact. Documentation is in English.

## Built with Codex

ChatSpin was built with OpenAI Codex through iterative implementation, code review, automated testing and live Twitch debugging. Codex helped build the React interface, question processing and translations, Twitch OAuth/EventSub integration, extension views, hosted persistence, authorization and regression tests. Human testing drove product choices and verified live behavior; automated checks are recorded in [verification](docs/VERIFICATION.md).

Main Codex session ID: `01a17004-f93e-7b11-bd0e-82c75f7e2e0a` (the same thread supplied in the Devpost submission).

No construction-footage clip is currently published in this repository. The locally prepared narration and black-background timing video are not footage of building with Codex. The final demo should include real Codex build/debug footage and the working Twitch integration, with its public YouTube link added here when available. See the [official submission requirements](https://twitchcon-codex.devpost.com/rules).

### Project name and hackathon entrant

The project is **ChatSpin**. The Twitch registration uses **ChatSpin by TapLinko** because Twitch rejected the shorter name during registration. The creator states that TapLinko is a trademark registered in his personal name in Argentina; this repository does not independently verify that registration. Registration evidence can be supplied for verification through Argentina’s INPI if requested.

TapLinko identifies the creator’s brand, not a company entering the hackathon. The Devpost draft identifies the entrant as a **Team of Individuals** (Damián and Sol). Brand use does not establish eligibility or replace the organizers’ review of entrant and project ownership requirements.

## Run locally

Requirements: Node.js 24+ (built-in SQLite), npm, and a modern browser.

```sh
npm install
# Only on first setup, if .env does not already exist:
cp -n .env.example .env
npm run dev
```

Open http://localhost:3000. Select **Explore the local demo** to use clearly labeled simulated data. The demo is separate from real channel data, resets on server restart, and does not connect Twitch or call OpenAI. Demo equivalent groups are curated. Duplicate detection works locally in both modes.

```sh
npm test
npm run build
npm start
```

`npm start` serves the built frontend. Production disables demo sign-in and requires `SESSION_SECRET`. No deployment is performed by these commands. The server binds to loopback; put a configured HTTPS reverse proxy in front of it for remote access. Do not expose the development server publicly.

## Server configuration

Set variables in `.env`; never commit it.

| Variable                 | Purpose                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `PORT`                   | Local listener, default `3000`                                                                            |
| `APP_URL`                | Exact browser origin, default `http://localhost:3000`; used for OAuth redirects and same-origin writes    |
| `SESSION_SECRET`         | Long random session signing secret; required in production                                                |
| `TWITCH_CLIENT_ID`       | Registered Twitch application's client ID                                                                 |
| `TWITCH_CLIENT_SECRET`   | Twitch server-side OAuth secret                                                                           |
| `TWITCH_BROADCASTER_ID`  | Stable numeric Twitch ID of the channel owner                                                             |
| `MODERATOR_IDS`          | Optional comma-separated stable Twitch IDs explicitly authorized by the operator                          |
| `OPENAI_API_KEY`         | Optional server-only API key for semantic grouping                                                        |
| `OPENAI_MODEL`           | Default `gpt-4.1-mini`; configurable based on account availability                                        |
| `ENABLE_DEMO`            | Set `false` to disable local demo; always disabled in production                                          |
| `DATA_FILE`              | Legacy import/backup path, default `./data/state.json`; live storage uses the adjacent `.sqlite` database |
| `OPENAI_EMBEDDING_MODEL` | Semantic candidate index, default `text-embedding-3-small`                                                |

Changing `PORT` also requires changing `APP_URL`. Set `APP_URL` to the exact HTTPS public origin when using a reverse proxy. Set `TRUST_PROXY_HOPS=1` only when exactly one trusted reverse proxy terminates HTTPS; the default is `0` (no trusted proxy). Production requires a random signing/encryption secret of at least 32 characters.

OpenAI API usage requires your own API configuration and billing; a ChatGPT or Codex subscription does not provide this application's API credentials. Usage displays request and input/output token totals. Estimate spend using your model's current API rates. Without a key, exact duplicate matching and public replies using the original approved answer remain available; questions require explicit manual approval before entering the wheel. With a key, public replies resolve the question language and translate the approved answer in one inference, reusing cached translations. Forced-language translation still requires AI; select original language to use a manually reviewed question without translation.

## Real Twitch walkthrough

1. Register a confidential application at the Twitch developer console. Add the exact redirect `http://localhost:3000/auth/callback` (or the HTTPS origin plus `/auth/callback`). Set its client ID and secret on the server.
2. Set `TWITCH_BROADCASTER_ID` to the channel owner's stable user ID. Restart ChatSpin.
3. Choose **Connect Twitch** and authorize as that broadcaster. Authorize `user:read:chat` for ingestion and `user:write:chat` for public replies. Reconnect existing installations to grant the new permission. The server uses Authorization Code flow, validates the returned token, and creates a `channel.chat.message` EventSub subscription on its WebSocket session.
4. Confirm the dashboard says **Connected**. From another Twitch account, send `What would you recommend to a first-time streamer?` in the channel chat.
5. Verify the original question and author in the queue. Select **Spotlight**, then **Review & answer**, then **Mark answered** with the optional answer field empty. Verify it leaves the open queue. Reopen it from the Answered tab to restore eligibility.
6. Send `!join` from two viewers. Switch to **Participant Wheel** and spin. Only distinct stable Twitch IDs enter. `!leave` withdraws an entry. Closing registration prevents new entries. Selected people are excluded by default; disable the checkbox to allow repeat turns.
7. Sign into `/viewer` in a separate browser with another Twitch account. Viewer OAuth requests no chat or email scopes. Submit or support questions. Only that viewer's originals and answers associated with their questions are returned; controller actions receive HTTP 403.
8. Write and approve an answer as the streamer. When a viewer repeats that question in Twitch chat, an exact duplicate or strong semantic equivalent receives the approved text publicly, mentioning the asker and replying to their message. Doubtful matches require explicit equivalence approval. Live-only answers without saved text are never sent. Viewer space also shows associated approved answers; no Whispers are sent.
9. Copy **OBS link** into an OBS Browser Source (suggested 1280×900). Keep its token private. It exposes the spin snapshot, eligible entry titles/weights, mode, and simulated-data flag, with no control endpoints. Spin again and verify identical result and animation. The OBS link persists across restarts. **Regenerate OBS link** explicitly invalidates the old one.
10. Temporarily interrupt connectivity. The dashboard reflects reconnecting; the server retries closed sockets and uses Twitch's reconnect URL for session migration. Tokens refresh before subscription as necessary and validate hourly. Revoked credentials require reconnection. Use **Disconnect** to stop ingestion.

In local mode, moderators are authorized using `MODERATOR_IDS`, not names or client-submitted roles. They sign in through Viewer space and open the dashboard after authentication. This version intentionally uses an explicit operator allowlist instead of requesting Twitch moderation scopes.

## Grouping, selection, and corrections

Exact matching uses Unicode normalization, case folding, and whitespace normalization; original text is unchanged. Authors and explicit supporters count once per user per group. Distinct questions on the same topic remain separate unless the model or a controller verifies equivalence. Single-user groups remain eligible.

New real questions are processed in batches of up to five, with at most 30 candidate groups. When more candidates exist, cached multilingual embeddings rank them by semantic similarity. The model gets question IDs, representative text, status, and first/last message times, never credentials, author identities, or saved answers. Current-activity and goal questions can share a contextual group when they seek the same explanation and all originals arrived within five minutes. Every automatic merge between open groups, including exact wording, must fit a five-minute combined time span. Current-activity questions retain this time restriction after answering; independently equivalent saved answers follow their session/permanent scope. Manual equivalence approval can override automatic grouping. Structured output and ID checks constrain decisions; messages are explicitly treated as untrusted data. Model failures preserve separate questions. Strong matches to pending groups and written-answer groups merge; uncertain matches and matches to live-only answers require review. Splitting moves an original and its author support; explicit group-level support stays with the original group. The UI explains this policy. Reopening clears the active answer and preserves it in answer history. Merging preserves existing answers; conflicting answers require choosing a winner. Previous versions remain available in the review dialog.

The server chooses one result with Node's cryptographic `randomInt`, creates a persistent candidate/weight/result/time snapshot, and rejects another spin until it finishes. The animation derives its angle from that snapshot and server time; polling keeps the dashboard and OBS aligned. New arrivals and support during a spin affect future draws only. Equal chances use one ticket per group; support uses unique users; participants always have equal chances. Manual Spotlight is recorded as a direct selection. Answered groups are excluded until reopened. For many entries, sector labels become numbers or are hidden; the exact-chance list remains readable and sectors retain proportional area.

## Verification

`npm test` exercises duplicate identity, minority eligibility, support unions and splits, approved answer reuse, manual choices, participant exclusion, spin locking, and frozen probability snapshots. The HTTP integration test covers authentication, role restrictions, personal data isolation, CSRF/origin checks, and synchronization contracts using isolated local state.

`npm run test:ai` runs a live paid model evaluation with multilingual paraphrases, different answers within one topic, and instruction injection. It requires `OPENAI_API_KEY`; passing deterministic tests does not establish semantic model quality. Run it before using automatic grouping on a live channel. See [verification notes](docs/VERIFICATION.md).

## Architecture and limits

React + TypeScript frontend; Express + TypeScript backend; server-side OAuth/session cookies; Twitch EventSub WebSocket; OpenAI Responses and Embeddings APIs; transactional SQLite persistence. The dashboard, viewer space, and read-only OBS view share a single server. Polling is once per second; absolute server time drives animation, so late views catch up. Network delay can cause brief visual skew, but the authoritative winner is shared.

This is a single-channel, single-process application. A process lease rejects another process using the same data file. It is not a horizontally scaled service. SQLite uses WAL transactions; startup validates state, imports existing JSON without deleting it, and can recover invalid state from validated snapshots/backups. Keep the whole data directory private and backed up.

Browser sessions and Twitch credentials are encrypted with AES-256-GCM using a key derived from `SESSION_SECRET`; without an explicit secret, local development creates a private adjacent `.key` file. The OBS token is persisted encrypted as well. Keep the same signing/encryption secret and data directory across restarts. Changing the secret invalidates saved credentials and sessions. Production still requires an explicit strong `SESSION_SECRET` and configured HTTPS. OAuth credentials refresh through a single shared refresh request and are revalidated when restored; revoked credentials require reconnecting. Disconnect removes saved Twitch credentials. No credentials are logged.

Messages are capped at 500 characters; written answers at 2,000. Web input is limited to 30 actions per user per minute. The AI inbox and grouping queue each hold at most 100 entries and are processed serially. Jobs persist across restart and retry up to three times with backoff; **Reprocess open questions** retries exhausted jobs. Per-viewer Twitch intake is capped at ten messages per minute and web actions at thirty. Candidate retrieval is intentionally bounded and may miss multilingual matches, especially on large channels. There is no automatic semantic evaluation without credentials, and live Twitch permissions/reconnection still require verification with your account. An OBS link is a bearer capability: anyone possessing it can see the current presentation, but cannot control it. Anyone visiting Viewer space must authenticate, even to submit a question.

No audio capture, transcription, independently generated answers, calls, payments, or betting are included. An optional Twitch Extension is included, with panel, overlay and mobile views. Public chat replies use approved written answers, translated when AI is configured; the approved source is preserved.

## Hackathon delivery

See [demo script and submission checklist](docs/DEMO.md). This project was implemented with Codex for architecture, source generation, UI, tests, and documentation. Save the **actual Codex session ID** from the app and record development clips now. Do not substitute the workspace directory name for the session ID. Repository changes are pushed only when authorized; app deployment is a separate action.

Official sources checked October 24, 2026:

- [Hackathon rules](https://twitchcon-codex.devpost.com/rules)
- [Twitch OAuth flows](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- [Twitch EventSub WebSockets](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [Chat message authorization](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

## License

ChatSpin is licensed under the [MIT License](LICENSE). Third-party dependencies retain their respective licenses.

## Start fresh

The streamer dashboard has separate **Clear questions and answers** and **Clear participants** buttons under **Start fresh**. Each opens a confirmation dialog. Only the broadcaster or explicitly authorized moderators may clear collections, and clearing is blocked during a spin.

Clearing questions removes all groups, originals, support, saved answers, reply jobs/history, and any question draw from the current session; it preserves participants. Clearing participants removes registrations and any participant draw; it preserves questions and saved answers. Registration settings and usage totals stay unchanged. Clearing questions also empties the waiting AI queue; an active grouping batch must finish first. New incoming chat commands can create fresh entries afterward.

Before either action, the server saves a full session snapshot in a `backups/` directory alongside `DATA_FILE`, including for demo sessions. A failed backup prevents clearing. Backups contain viewer data and must remain private; the default `data/` location is excluded from Git. To recover a snapshot, stop the server and run `npm run restore -- /absolute/path/to/backup.json`, then restart. The restore command validates the backup and preserves a pre-restore snapshot. Copying JSON over `DATA_FILE` does not replace an already imported SQLite state. No restore endpoint is exposed to viewers.

## Automatic chat questions

Viewers can ask ordinary questions in Twitch chat without a command. ChatSpin captures messages with question marks (`?`, `¿`, `？`, or `؟`), and common English or Spanish question openings even without punctuation (for example, `Who are you` or `Cómo empezaste a transmitir`). Original wording and language are preserved. URL query strings alone do not trigger detection, and unrelated chat commands are excluded.

Recognizable questions and `!ask` enter immediately through local rules. Other ordinary messages are batched for semantic question detection with structured outputs, including indirect requests and other languages. Commands and empty/oversized messages are excluded. Detection makes API calls and shares the same hard call/token budget as grouping and embeddings. Original text is preserved; the model never writes answers. Without an API key, only locally recognized questions are accepted. Only new EventSub messages are processed; disconnected messages are not replayed.

## OBS candidate synchronization

OBS receives the current eligible entry list even before the first spin. The dashboard and presentation use the same server-side eligibility and weights. Both freeze the recorded candidates while a spin is active. Afterward, new questions, support changes, answered questions, registrations, and mode changes refresh the wheel for the next draw; the previous selected result remains in the spotlight. The OBS endpoint exposes entry titles and weights, not original messages, support identities, or written answers.

## Completing an answer

In **Review & answer**, the fixed bottom action bar has one **Mark answered** button. If the optional written answer contains text, the action saves it as approved and marks the question answered. If it is empty, the question is recorded as answered live without saved text. The dialog closes only after a successful save; errors leave the draft open. Originals and grouping corrections are collapsible so the main action remains visible on smaller windows.

## Automatic approved-answer replies

Replies are sent from the connected broadcaster account. The server sends at most one message part every two seconds, suppresses repeats to the same user and question for one minute, and retains that cooldown across restarts. Answers longer than Twitch’s message limit are split without rewriting. The queue holds at most 50 answers and expires jobs after five minutes; edited, reopened, or cleared answers invalidate queued replies. Failed or moderation-held messages are reported in the dashboard and are not automatically retried. The model translates approved content; it does not independently answer the viewer’s question. Tests use mocked Twitch endpoints; verify live delivery after reconnecting with write permission.

## Live session controls, budgets, and retention

**Start new live session** creates a new logical broadcast without deleting history. New written answers default to **This live session only**; select **Across live sessions** only for answers that should remain valid. Repeated questions cannot use an expired session answer. Restarting the process does not start a new live session.

Under **Live session & automation**, pause/resume public replies, reprocess open questions, inspect the latest 100 reply records, and configure limits. Defaults are 200 AI API requests and 200,000 reserved/actual tokens per live session, 2,000 groups, and 30 days of question retention. Calls are reserved before network access; failures retain conservative reservations. Token ceilings are not currency budgets, and embedding requests count too. Starting a new live session resets the AI budget.

An hourly maintenance task archives state before removing questions older than the selected retention period. SQLite keeps the last 20 snapshots. Explicit clear operations also produce private JSON backups; these backups are not automatically purged. Store/export anything you need before reducing retention. Removing expired content does not clear participant registrations.

Public reply jobs survive restart, send at most one message part every two seconds, and expire after five minutes. A network send with uncertain outcome is not retried automatically, preventing duplicate public posts. History reports sent, failed/held, partial, or cancelled jobs. Messages arriving while grouping is running are tracked individually, including multiple viewers asking the same question.

The frontend separates dashboard, OBS, review dialog, automation controls, types, and request logic. Polling is serialized; action-triggered reloads wait for stale polls and then fetch fresh state.

## Interface and question languages

Two independent settings are available:

- **Interface language**, in the header: English, Español, Русский, or Deutsch. The browser remembers the choice. A streamer/controller change also saves the shared OBS interface language; viewers can choose their own interface locally.
- **Question language**, under **Live session & automation → Language settings**: original, English, Spanish, Russian, or German. It controls question titles, the full spotlight question, the queue, and OBS. Originals remain available in the review dialog, and cross-language equivalence still uses original messages.

Question translations use structured model output, are cached separately per language and source, and share the same AI call/token budget. When unavailable or pending, originals remain available in the review queue with a status notice. A forced-language wheel waits for a current translation and grouping/previous-answer checks before admitting a question; questions are retained for retry, not dropped or answered by the translation model. Configure OpenAI before selecting a forced question language in a real workspace. Reprocessing retries exhausted translations. Changing the question language is blocked during an active draw; an already running animation retains its frozen labels until completion.

Editing a title in a forced language updates that language's display title without rewriting the original question or other languages. Editing the title in original mode changes the source title and invalidates stale translations. Approved written answers remain stored unchanged. With OpenAI configured, public replies are translated into the language of the incoming question, and the extension displays answers in the viewer’s selected language. Translations are cached separately and may change wording to convey the approved answer, but must not invent new facts. Unsupported or failed translations are withheld with a status message. Without OpenAI, public replies send the original approved text.

The labeled demo has prepared question translations in all four languages and makes no runtime model calls. UI catalogs are static, so changing interface language has no API cost. Developers can add missing UI strings with `node --import tsx scripts/generate-locales.ts`; this optional maintenance tool makes paid API calls with public UI strings only and preserves existing translations.

## Optional Twitch Extension and hosted multi-channel backend

The existing local app remains available. The optional [`extension/`](extension/README.md) provides panel, overlay, mobile, configuration and live control views with Twitch JWT authentication and personal display language. Hosted operation uses [`api/cloud.ts`](api/cloud.ts), Supabase tables with the `chatspin_` prefix, per-channel OAuth credentials and EventSub webhooks. It has no global broadcaster account. See [Vercel/Supabase deployment](docs/hosting.md) for variables, SQL, cron, installation paths, limitations and real-world verification. The normal Vite build serves the dashboard; the Twitch frontend ZIP is built separately.

Public legal documents are served at `/privacy.html` and `/terms.html`; they distinguish the MIT source license from any future hosted service. Billing and Bits monetization are not implemented.

## Hosted reliability and operator controls

The hosted service hides AI budget editors and rejects budget changes through the API. Daily provider-controlled channel/global allowances live separately from session state and cannot be reset by a streamer or backup restoration. See [operator quotas and monetization](docs/monetization.md). Install the quota migration before deploying this version.

Cloud owners can delegate extension controls to explicitly listed Twitch moderators, review processing failures, manually approve questions, preview channel backups and restore them with confirmation. Restore preserves current moderator delegation and never replays old public replies. Local installation settings remain available.

See [rollout and live acceptance checklist](docs/stabilization-verification.md) for deployment order and the real Twitch checks that automated tests do not replace.

## Code style and readability

Run `npm run format` before committing and `npm run format:check` to verify formatting. Prettier formats the maintained TypeScript, TSX, JavaScript, CSS, HTML, JSON and Markdown with two-space indentation and a 100-column target. Generated bundles, local data, credentials and demo media are excluded.

The dashboard uses a minimum CSS text size of 13 px, 14 px controls and 15 px question titles. Muted text has been brightened for the dark surfaces. The extension uses at least 12 px CSS text. Layouts were checked at 1920×1080, 1280×800 and 390×844; contrast checks cover the demo text and wheel palette, not a full accessibility certification.
