# ChatSpin

Give your Twitch community a turn. ChatSpin organizes interview questions and selects a question or a volunteer with a synchronized wheel.

Built from an empty directory with Codex during the Codex x TwitchCon Hackathon submission period. All application text and documentation are in English; viewers' original questions retain their language.

## Run locally

Requirements: Node.js 22.12+ (tested with Node 24), npm, and a modern browser.

```sh
npm install
cp .env.example .env
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

| Variable | Purpose |
| --- | --- |
| `PORT` | Local listener, default `3000` |
| `APP_URL` | Exact browser origin, default `http://localhost:3000`; used for OAuth redirects and same-origin writes |
| `SESSION_SECRET` | Long random session signing secret; required in production |
| `TWITCH_CLIENT_ID` | Registered Twitch application's client ID |
| `TWITCH_CLIENT_SECRET` | Twitch server-side OAuth secret |
| `TWITCH_BROADCASTER_ID` | Stable numeric Twitch ID of the channel owner |
| `MODERATOR_IDS` | Optional comma-separated stable Twitch IDs explicitly authorized by the operator |
| `OPENAI_API_KEY` | Optional server-only API key for semantic grouping |
| `OPENAI_MODEL` | Default `gpt-4.1-mini`; configurable based on account availability |
| `ENABLE_DEMO` | Set `false` to disable local demo; always disabled in production |
| `DATA_FILE` | Real channel JSON persistence, default `./data/state.json` |

Changing `PORT` also requires changing `APP_URL`. Set `APP_URL` to the exact HTTPS public origin when using a reverse proxy. Configure only a trusted proxy; the application currently trusts one proxy hop.

OpenAI API usage requires your own API configuration and billing; a ChatGPT or Codex subscription does not provide this application's API credentials. Usage displays request and input/output token totals. Estimate spend using your model's current API rates. Without a key, exact duplicate matching remains available; other questions stay separate.

## Real Twitch walkthrough

1. Register a confidential application at the Twitch developer console. Add the exact redirect `http://localhost:3000/auth/callback` (or the HTTPS origin plus `/auth/callback`). Set its client ID and secret on the server.
2. Set `TWITCH_BROADCASTER_ID` to the channel owner's stable user ID. Restart ChatSpin.
3. Choose **Connect Twitch** and authorize as that broadcaster. Authorize `user:read:chat` for ingestion and `user:write:chat` for public replies. Reconnect existing installations to grant the new permission. The server uses Authorization Code flow, validates the returned token, and creates a `channel.chat.message` EventSub subscription on its WebSocket session.
4. Confirm the dashboard says **Connected**. From another Twitch account, send `What would you recommend to a first-time streamer?` in the channel chat.
5. Verify the original question and author in the queue. Select **Spotlight**, then **Review & answer**, then **Mark answered** with the optional answer field empty. Verify it leaves the open queue. Reopen it from the Answered tab to restore eligibility.
6. Send `!join` from two viewers. Switch to **Participant Wheel** and spin. Only distinct stable Twitch IDs enter. `!leave` withdraws an entry. Closing registration prevents new entries. Selected people are excluded by default; disable the checkbox to allow repeat turns.
7. Sign into `/viewer` in a separate browser with another Twitch account. Viewer OAuth requests no chat or email scopes. Submit or support questions. Only that viewer's originals and answers associated with their questions are returned; controller actions receive HTTP 403.
8. Write and approve an answer as the streamer. When a viewer repeats that question in Twitch chat, an exact duplicate or strong semantic equivalent receives the approved text publicly, mentioning the asker and replying to their message. Doubtful matches require explicit equivalence approval. Live-only answers without saved text are never sent. Viewer space also shows associated approved answers; no Whispers are sent.
9. Copy **OBS link** into an OBS Browser Source (suggested 1280×900). Keep its token private. It exposes only the spin snapshot and simulated-data flag, with no control endpoints. Spin again and verify identical result and animation. OBS tokens rotate on server restart; recopy the link.
10. Temporarily interrupt connectivity. The dashboard reflects reconnecting; the server retries closed sockets and uses Twitch's reconnect URL for session migration. Tokens refresh before subscription as necessary and validate hourly. Revoked credentials require reconnection. Use **Disconnect** to stop ingestion.

Moderators are authorized using `MODERATOR_IDS`, not names or client-submitted roles. They sign in through Viewer space and open the dashboard after authentication. This version intentionally uses an explicit operator allowlist instead of requesting Twitch moderation scopes.

## Grouping, selection, and corrections

Exact matching uses Unicode normalization, case folding, and whitespace normalization; original text is unchanged. Authors and explicit supporters count once per user per group. Distinct questions on the same topic remain separate unless the model or a controller verifies equivalence. Single-user groups remain eligible.

New real questions are processed in batches of up to five, with at most 30 candidate groups selected by lexical overlap. The model gets question IDs and representative text only, never credentials, author identities, or saved answers. Structured output and ID checks constrain decisions; messages are explicitly treated as untrusted data. Model failures preserve separate questions. Strong matches to pending groups and written-answer groups merge; uncertain matches and matches to live-only answers require review. Splitting moves an original and its author support; explicit group-level support stays with the original group. The UI explains this policy. Reopening clears the saved answer to prevent stale answer reuse.

The server chooses one result with Node's cryptographic `randomInt`, creates a persistent candidate/weight/result/time snapshot, and rejects another spin until it finishes. The animation derives its angle from that snapshot and server time; polling keeps the dashboard and OBS aligned. New arrivals and support during a spin affect future draws only. Equal chances use one ticket per group; support uses unique users; participants always have equal chances. Manual Spotlight is recorded as a direct selection. Answered groups are excluded until reopened. For many entries, sector labels become numbers or are hidden; the exact-chance list remains readable and sectors retain proportional area.

## Verification

`npm test` exercises duplicate identity, minority eligibility, support unions and splits, approved answer reuse, manual choices, participant exclusion, spin locking, and frozen probability snapshots. The HTTP integration test covers authentication, role restrictions, personal data isolation, CSRF/origin checks, and synchronization contracts using isolated local state.

`npm run test:ai` runs a live paid model evaluation with multilingual paraphrases, different answers within one topic, and instruction injection. It requires `OPENAI_API_KEY`; passing deterministic tests does not establish semantic model quality. Run it before using automatic grouping on a live channel. See [verification notes](docs/VERIFICATION.md).

## Architecture and limits

React + TypeScript frontend; Express + TypeScript backend; server-side OAuth/session cookies; Twitch EventSub WebSocket; OpenAI Responses API; atomic JSON writes. The dashboard, viewer space, and read-only OBS view share a single server. Polling is once per second; absolute server time drives animation, so late views catch up. Network delay can cause brief visual skew, but the authoritative winner is shared.

This is a single-channel, single-process prototype. JSON state has no multi-process locking or retention UI. Session and OAuth tokens stay in memory; a restart requires signing in and reconnecting. Express's development MemoryStore is not a production session store. State files contain viewer identifiers and original questions: restrict access and establish retention before hosting. No secrets are persisted or logged. Use a persistent encrypted token/session store, database transactions, audit logs, retention controls, shared rate limiting, and configured HTTPS before operating a hosted service at scale.

Messages are capped at 500 characters; written answers at 2,000. Web input is limited to 30 actions per user per minute. The AI queue holds at most 100 waiting groups and makes no parallel calls; overflow questions remain separate. Candidate retrieval is intentionally bounded and may miss multilingual matches, especially on large channels. There is no automatic semantic evaluation without credentials, and live Twitch permissions/reconnection still require verification with your account. An OBS link is a bearer capability: anyone possessing it can see the current presentation, but cannot control it. Anyone visiting Viewer space must authenticate, even to submit a question.

No audio capture, transcription, generated answers, calls, payments, betting, Twitch Extension, are included. Public chat replies reuse approved written answers only.

## Hackathon delivery

See [demo script and submission checklist](docs/DEMO.md). This project was implemented with Codex for architecture, source generation, UI, tests, and documentation. Save the **actual Codex session ID** from the app and record development clips now. Do not substitute the workspace directory name for the session ID. No repository has been published and no app has been deployed.

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

The streamer dashboard has separate **Clear questions** and **Clear participants** buttons under **Start fresh**. Each opens a confirmation dialog. Only the broadcaster or explicitly authorized moderators may clear collections, and clearing is blocked during a spin.

Clearing questions removes all groups, originals, support, saved answers, and any question draw from the current session; it preserves participants. Clearing participants removes registrations and any participant draw; it preserves questions and saved answers. Registration settings and usage totals stay unchanged. Clearing questions also empties the waiting AI queue; an active grouping batch must finish first. New incoming chat commands can create fresh entries afterward.

Before either action, the server saves a full session snapshot in a `backups/` directory alongside `DATA_FILE`, including for demo sessions. A failed backup prevents clearing. Backups contain viewer data and must remain private; the default `data/` location is excluded from Git. To recover a snapshot, stop the server, preserve the current state file, copy the chosen backup over `DATA_FILE`, then restart and reconnect Twitch. No restore endpoint is exposed to viewers.

## Automatic chat questions

Viewers can ask ordinary questions in Twitch chat without a command. ChatSpin captures messages with question marks (`?`, `¿`, `？`, or `؟`), and common English or Spanish question openings even without punctuation (for example, `Who are you` or `Cómo empezaste a transmitir`). Original wording and language are preserved. URL query strings alone do not trigger detection, and unrelated chat commands are excluded.

Detection uses local text rules, so it has no additional model-call cost. It is a heuristic, not a guarantee of recognizing every question or rejecting every rhetorical statement. Other languages work with question marks; unrecognized or unusually worded questions can still be submitted with `!ask your question` or through Viewer space. The explicit command remains available for questions without recognizable punctuation or openings. Messages must contain text and fit within the 500-character limit. Only new EventSub messages are processed; disconnected messages are not replayed.

## OBS candidate synchronization

OBS receives the current eligible entry list even before the first spin. The dashboard and presentation use the same server-side eligibility and weights. Both freeze the recorded candidates while a spin is active. Afterward, new questions, support changes, answered questions, registrations, and mode changes refresh the wheel for the next draw; the previous selected result remains in the spotlight. The OBS endpoint exposes entry titles and weights, not original messages, support identities, or written answers.

## Completing an answer

In **Review & answer**, the fixed bottom action bar has one **Mark answered** button. If the optional written answer contains text, the action saves it as approved and marks the question answered. If it is empty, the question is recorded as answered live without saved text. The dialog closes only after a successful save; errors leave the draft open. Originals and grouping corrections are collapsible so the main action remains visible on smaller windows.

## Automatic approved-answer replies

Replies are sent from the connected broadcaster account. The server sends at most one message part every two seconds, suppresses repeats to the same user and question for one minute, and retains that cooldown across restarts. Answers longer than Twitch’s message limit are split without rewriting. The queue holds at most 50 answers and expires jobs after five minutes; edited, reopened, or cleared answers invalidate queued replies. Failed or moderation-held messages are reported in the dashboard and are not automatically retried. No generated answer is posted. Tests use mocked Twitch endpoints; verify live delivery after reconnecting with write permission.
