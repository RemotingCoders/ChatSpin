# Hosted stabilization rollout and verification

## Deployment order

1. Run `supabase/migrations/202610290002_chatspin_ai_quotas.sql` in the existing Supabase project. It adds only `chatspin_` objects; it must precede the quota-enabled backend deployment. Without it, AI work fails closed and remains retryable.
2. Deploy the backend. Provider quota defaults are documented in `monetization.md`; no public budget editor remains. Existing local installations retain their controls.
3. Build the extension package with its production API origin and upload it in Twitch Local Test, then switch back to Hosted Test. Backend deployment alone does not update the extension UI.
4. Reprocess failed questions after installing the migration if an older deployment attempted work without it.

## Automated coverage

The suite covers interleaved channel edits and worker commits, conflicting answers, old-token refresh after disconnect, channel isolation, 100 concurrent cached view reads, persisted message-rate limits, full-queue retry, quota denial, authorization boundaries, frozen localized spins, hosted budget visibility, and recoverable versus revoked EventSub subscriptions. Provider calls are simulated. This does not certify production capacity or actual Twitch rendering.

## Live acceptance (requires test accounts and a live channel)

- Owner and viewer open the channel. A viewer cannot spin, approve, answer, restore, or delegate moderators.
- Owner adds an actual Twitch moderator's numeric ID. Only that linked moderator gains extension controls; removing the ID revokes them on the next request.
- Send paraphrases in two languages. Verify pending status, one resulting group, translated wheel entry, and no answered question flashing into the wheel.
- While AI is processing, submit/support another question and change a harmless setting. Verify both changes remain after processing.
- Spin with a personal translation pending; verify placeholders/labels stay fixed for that spin and translated text appears afterward.
- Save an answer with removal checked, then repeat the question from a different account. Verify the approved public reply and no new wheel candidate.
- Submit an answer longer than one Twitch message. Verify all parts arrive in order with paced sends.
- Disconnect while work is queued. Verify no new public sends start with the removed authorization. A request already accepted by Twitch cannot be recalled.
- Preview a backup, cancel, then test restore on a disposable channel. Verify the pre-restore backup exists and no historical public replies replay.
- Check desktop/fullscreen dragging and mobile panel layout in Twitch. Browser unit tests do not substitute for this step.

## Remaining product decisions

Payments, pricing, payment processor, refunds, taxation, and Twitch release/review are not activated. The entitlement/quota foundation is backend-only. Production load testing with realistic channels and viewer counts is still needed; the mocked 100-reader test proves coalescing, not a capacity guarantee.

## Operations

A worker owns a processing lease, but interactive actions no longer wait for it. Its changes are rebased onto the latest revision; incompatible edits stop the worker rather than overwrite streamer changes. Persisted jobs retry on subsequent processing. The lease is released after a caught conflict; an interrupted process expires naturally.

State reads are coalesced per channel for two seconds within a Vercel instance; configuration/status reads cache for five seconds. Writes invalidate the local instance cache; another instance sees changes within the TTL. Background scheduling is throttled to five seconds per channel per instance. This is bounded staleness, not a distributed cache.

## Approved answer translations

The approved source text is retained unchanged. The extension uses the viewer’s language (or the channel language when inherited); Original shows the approved source. Pending or failed translations show a status instead of silently showing another language. The answer editor always edits the source.

Automatic Twitch replies detect the language of the incoming question and translate only the approved answer. English, Spanish, German and Russian are supported; ambiguous or other languages withhold the reply with a logged reason. Translations share provider quotas, have three bounded attempts, and cache by approved text and target language. Changing the approved answer invalidates queued replies and old translation results. Reprocess retries failed translation jobs.

Live check: approve an English answer, repeat the question in Spanish from another account, and verify a Spanish public reply mentioning that account. Switch a viewer to German and then Original: only that viewer’s answer display changes, while the saved approved source remains English.


## Demo regression fixes (2026-10-29)

- Public replies bypass translation when OpenAI is not configured. With AI, language detection and answer translation share one request; repeated text/language pairs reuse the cache. Manual merging preserves the viewer question text.
- OBS legends show all entries without an internal scroll area, identical result text is not repeated, and candidate updates preserve wheel rotation. Results are scoped to the selected mode.
- Startup token validation retries with bounded backoff. Revoked refresh credentials stop immediately; repeated transient failures stop with a reconnect message.
- Cloud title edits use the persisted display language; validation errors return 400 and stale edits return 409. Overlay signatures are authenticated before loading or creating a channel.
- Disconnect removes only this app's webhook subscriptions for that channel. Failed deletion is persisted for cron retry; a subsequent reconnect prevents deleting its new subscription.
- Editors submit a version of the content they opened. A stale moderator edit is rejected without overwriting the saved answer; reopen the editor to review the current version.
- Vercel runtime helpers are disabled through `NODEJS_HELPERS=0` in `vercel.json`; Express receives the original stream. The API entry also explicitly disables body parsing. A signed webhook regression uses whitespace-preserving raw bytes. Reference: https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration

Deployment needs the new backend/web build and a newly uploaded extension ZIP. No SQL migration is required. Real Twitch delivery, OBS canvas sizing, and the deployed webhook must still be checked in the live demo environment.
