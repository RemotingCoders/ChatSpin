# Vercel + Supabase (multi-channel)

This hosted backend is separate from `server/index.ts`, which retains the original local SQLite/single-channel mode. It requires Node 24, Vercel Functions and Supabase's Data API. The Vercel project root is `./`; build `npm run build`, output `dist`. `vercel.json` sends API, OAuth and extension requests to `api/cloud.ts`, with static dashboard/legal pages served from `dist`.

## Database

Run `supabase/migrations/202610280001_chatspin.sql` once as the existing database owner. It only creates `chatspin_` tables, indexes and a scoped commit function. It does not change other apps' tables or Supabase Auth settings. RLS denies browser `anon`/`authenticated` access; the backend's secret key has the service role. The secret key must never enter a public bundle. Supabase publishable/anon keys do not authorize this backend.

State, AI/reply jobs and version counters are per channel. Tokens and web sessions are AES-GCM encrypted with a key derived from `SESSION_SECRET`. Keep this stable: changing it invalidates sessions and makes stored credentials unreadable. Cloud data is a fresh installation: existing local data is not silently uploaded or attributed to another channel. No automatic SQLite-to-cloud import is provided.

Each update uses an atomic revision check. Workers acquire a durable, expiring per-channel lease, persisting reservations before paid AI calls and sending markers before public chat replies. Conflicting user actions receive 409 and can be retried; reads remain available. These leases are intentionally coarse for this first hosted version and can briefly block controls while AI is working. Chat events are durably recorded in a separate encrypted inbox so they do not wait for an AI lease.

## Production variables (Vercel, server-only)

| Variable | Purpose |
|---|---|
| `APP_URL` | `https://chatspin.taplinko.store` |
| `SUPABASE_URL` | HTTPS project origin, without `/rest/v1` |
| `SUPABASE_SECRET_KEY` | Supabase server Secret key |
| `SESSION_SECRET` | Stable random secret, at least 32 characters |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Shared ChatSpin OAuth application |
| `EXTENSION_CLIENT_ID`, `EXTENSION_SECRET` | Shared Twitch Extension registration and Base64 shared key |
| `OPENAI_API_KEY` | Server-side API key for AI; optional for explicit/local matching only |
| `CRON_SECRET` | Random secret (at least 32 characters) for Vercel's automatic cron Authorization header |
| `ENABLE_DEMO` | `false` (hosted backend never exposes demo endpoints) |

Optional: `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, `EXTENSION_PREVIOUS_SECRET`, `EXTENSION_ALLOWED_ORIGINS`. Do **not** set a global `TWITCH_BROADCASTER_ID` or `MODERATOR_IDS` for the hosted service. The owner connects their own Twitch account. `PORT`, `DATA_FILE` and `TRUST_PROXY_HOPS` belong to local operation, not this hosted entry point.

`VITE_EXTENSION_API_ORIGIN` is a **public origin**, used only to build the separate extension package. No other credentials use the `VITE_` prefix. Frontend and backend credentials are shared application registrations, while broadcaster authorizations are encrypted per channel. OAuth callback to add in Twitch: `https://chatspin.taplinko.store/auth/callback`.

## Background processing and chat

The backend subscribes to `channel.chat.message` with webhook transport after broadcaster OAuth, requesting `user:read:chat user:write:chat user:bot channel:bot`. Existing local grants need a reconnect to authorize those additional scopes. Twitch signs the raw payload; signatures, timestamps and channel identity are checked. The callback verification endpoint is public HTTPS and must not be blocked by Vercel Deployment Protection or an interactive login challenge. The webhook secret is derived server-side; it requires no extra user-supplied variable.

Work is triggered by incoming events/dashboard/extension requests using Vercel `waitUntil`. A minute-based cron retries queued work and runs retention/session cleanup without relying on a browser remaining open. Configure `CRON_SECRET` in Vercel before deployment. The configured minute schedule requires a plan supporting that frequency. Each cron invocation handles up to 20 channel records; this is an initial operational limit, not a high-scale multi-tenant scheduler. For a large hosted service, replace that sweep with a dedicated durable queue and fair scheduling before selling availability guarantees. Existing per-channel AI budgets are limits, not a commercial billing system or global organization spending cap.

Public reply unknown outcomes are not retried automatically to avoid duplicates. External provider/API failures leave persisted jobs for bounded retry. No public pricing, billing, Bits purchases or subscription management is implemented. The open-source MIT license is unchanged.

## Verification after deployment

1. `/api/health` should return JSON identifying the cloud backend. It is liveness, not proof of database credentials or migration correctness.
2. Connect your Twitch account at `/auth/twitch`; the session and encrypted credentials must persist across reloads.
3. Check Twitch webhook verification and a real incoming question. Check saved-answer reply delivery separately.
4. Connect a second broadcaster and confirm isolated questions, answers, participants and draws.
5. Upload/activate the extension and verify the same draw in panel/overlay/mobile. Test viewer identity sharing and denial of streamer actions.
6. Confirm `/privacy.html` and `/terms.html` are accessible, with current operator/contact information. Their current text is a service draft to review before commercial launch.

Local automated tests mock Twitch/Supabase. Passing them and compiling does not claim a successful live Vercel/Twitch integration. No secrets are logged or committed. Deployment credentials stay in Vercel; a remote verification still needs the deployed environment and a broadcaster's authorization.
