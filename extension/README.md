# ChatSpin Twitch Extension

Optional frontend and JWT-authenticated API. The existing local dashboard and OBS source remain available. All viewers in one channel share groups, draw candidates, probabilities and the authoritative winner. Interface language and displayed question language are personal preferences. Translations never replace original messages. The overlay is a client layer, not part of the encoded video; it will not automatically appear in recordings or another platform, and video latency can differ from extension animation timing.

## Views and registration

Register an Extension separately from the existing OAuth application. Enable Panel, Video Fullscreen and Mobile. Version 0.1.0 is a development version, not a public release. In Asset Hosting set:

| Field                        | File           |
| ---------------------------- | -------------- |
| Panel Viewer Path            | `viewer.html`  |
| Mobile Viewer Path           | `mobile.html`  |
| Video Fullscreen Viewer Path | `overlay.html` |
| Configuration Path           | `config.html`  |
| Live Configuration Path      | `live.html`    |

The Twitch defaults `panel.html` and `video_overlay.html` are **not** our filenames. Configure the backend origin in the extension's fetch/connect domain allowlist. Production origin: `https://chatspin.taplinko.store`. The backend allows the extension's exact Twitch CDN origin; add only trusted local test HTTPS origins to `EXTENSION_ALLOWED_ORIGINS` if needed. Never allow arbitrary origins.

Create a shared key in the Extension's **Settings → Secret Keys**. Store its Base64 value in `EXTENSION_SECRET`, unchanged. This and `EXTENSION_CLIENT_ID` are distinct from the OAuth application's client credentials. `EXTENSION_PREVIOUS_SECRET` optionally supports a rotation overlap. Do not expose any secret to the frontend.

## Build and upload

From the repository root:

```sh
VITE_EXTENSION_API_ORIGIN=https://chatspin.taplinko.store npm run extension:package
```

Upload `extension/chatspin-extension.zip` in the Twitch version's **Files** tab. Files must be at the ZIP root. Build output is readable and excludes the local preview. This frontend ZIP is separate from the Vercel web dashboard build. Uploading it does not release the extension publicly. Use Hosted Test, allowlist your Twitch test accounts, install/activate it on the channel, and configure the paths above. Privacy and terms URLs must be publicly accessible before review; replace the provisional dashboard screenshot with the actual extension UI.

For Local Test, serve the generated frontend over a locally trusted HTTPS origin and set the Base URI accordingly. The backend must be reachable by the viewer's browser. A bundle configured with localhost cannot serve remote testers.

## Backend choices

- Local server (`npm run dev`): original single-channel cookie sessions and OBS. Extension JWTs must match `TWITCH_BROADCASTER_ID`. Never enable the preview on a production server.
- Hosted (`api/cloud.ts` on Vercel): Supabase multi-channel storage. Channel is taken from the verified Twitch JWT or validated broadcaster OAuth identity, never a supplied body/query channel. No global broadcaster ID or global moderator list. The channel owner can manage a per-channel list of moderator Twitch user IDs from the hosted dashboard. Extension controls are available to the verified owner and allowlisted users whose signed Twitch role is moderator and whose identity is linked. Viewers cannot grant themselves controls. Viewers must share their Twitch identity before asking/supporting/joining. Anonymous users can read, not change state.

The shared secret is decoded server-side to verify HS256 signatures. Expired, forged, external-role and mismatched owner identities are rejected. Tokens stay in memory in the frontend; authorization refresh replaces the active token. Personal language settings use browser storage and never change global draw odds/settings. Both cloud and local APIs return restricted projections instead of credentials or internal work queues.

The config view links to the web dashboard to connect the broadcaster's own Twitch account. Chat intake in cloud uses authenticated EventSub webhooks; it does not depend on a long-running websocket on a laptop. See [hosted setup](../docs/hosting.md).

## Local demo preview

Run the existing development server and open `/extension/preview.html` in a private browser window. Use **Preview as viewer** or **Preview as streamer**. The preview uses an isolated simulated session, does not call Twitch or OpenAI and cannot authorize real channel actions. `?view=live` previews broadcaster controls. It uses the development web cookie, so use a separate browser profile/window to avoid replacing your current dashboard session. The preview is omitted from uploaded extension builds and its backend returns 404 in production.

### Personal overlay position

In the video overlay, drag the ChatSpin header to move the panel. The same handle
supports arrow keys (Shift for larger steps) and Home to restore the top-right
position. The browser remembers the position for that channel locally; it does
not change the broadcaster's settings or another viewer's layout. Positions stay
inside the video when its size changes, including fullscreen. Panel and mobile
views keep their regular layout. Upload a newly generated extension ZIP to Twitch
to deliver this frontend change.
