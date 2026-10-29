# Hosted service allowances and monetization readiness

ChatSpin's MIT source remains available for self-hosting. The hosted service can
charge for operation and support, but **no paid plan, checkout, subscription,
Bits purchase or billing provider is enabled by this change**. Prices, currency,
payment provider, refunds, tax handling and commercial terms require an operator
decision before implementing or enabling payments.

## Operator-owned AI allowances

Apply `supabase/migrations/202610290002_chatspin_ai_quotas.sql` before deploying
quota-enabled cloud processing. It adds only `chatspin_ai_quotas`,
`chatspin_entitlements` and `chatspin_reserve_ai`; browser roles have no access.
It does not change or delete another project's objects. If the migration is
missing or the quota service is unreachable, cloud AI fails closed and does not
send a provider request. Existing questions remain available for retry/review.

Server-only environment variables, never `VITE_`:

| Variable                           | Default | Meaning                                                              |
| ---------------------------------- | ------: | -------------------------------------------------------------------- |
| `CHATSPIN_AI_DAILY_CHANNEL_CALLS`  |     200 | Maximum reservations per channel and UTC day                         |
| `CHATSPIN_AI_DAILY_CHANNEL_TOKENS` |  200000 | Maximum estimated tokens per channel and UTC day                     |
| `CHATSPIN_AI_DAILY_GLOBAL_CALLS`   |    2000 | Shared maximum for the whole hosted deployment                       |
| `CHATSPIN_AI_DAILY_GLOBAL_TOKENS`  | 2000000 | Shared estimated-token maximum                                       |
| `CHATSPIN_REQUIRE_ENTITLEMENT`     |   false | When true, channels need an enabled operator-created entitlement row |

Zero disables the corresponding allowance. Invalid numeric values fail closed.
The database reserves a call and estimated tokens atomically against both channel
and global limits, always locking global first. The day is chosen by the database
clock. Starting a stream, restoring state or raising a UI setting cannot reset
these counters. One backend secret protects the quota RPC, so tenant requests
cannot supply their own ceilings.

Reservations remain charged after provider errors and ambiguous outcomes. Unused
estimated tokens are not refunded; this is deliberately conservative. These are
request/token safeguards, **not a currency-denominated billing meter or guarantee
of a particular invoice**. Keep provider-account spending controls in place and
select model/pricing separately. Usage history can be exported by the operator;
there is no customer invoice API yet.

## Entitlements foundation

`chatspin_entitlements` stores a channel's enabled state, optional lower daily
limits, and an operator-maintained plan label. No streamer route can alter this
record. Per-channel values cannot exceed the server ceilings. Without a row,
default allowances apply unless `CHATSPIN_REQUIRE_ENTITLEMENT=true`.

For a closed pilot, the operator creates rows for approved Twitch channel IDs,
then enables required entitlements. Disabling a row prevents subsequent AI
reservations; it does not delete the channel or cancel an already-sent provider
request. A plan label alone neither charges money nor proves payment.

A future billing integration should update entitlements only from authenticated,
verified provider events, idempotently, and record an audit trail. Failed payment,
cancellation and refund behavior need to be chosen before activation. Do not use
client-supplied plan names or an unverified checkout return URL to grant capacity.

## Rollout checks

1. Apply the migration and verify backend-only grants.
2. Set ceilings appropriate to the pilot and provider account.
3. Deploy code, then verify a normal reservation and a denied reservation using a
   non-production channel. Never lower global production ceilings just to test.
4. Confirm new live sessions do not reset the quota and different channels share
   the global cap.
5. Confirm UI/manual review stays useful while automatic work is quota-blocked.

Automated tests cover the reservation hook and safe failures. Real Postgres
concurrency, grants and end-to-end payment behavior are not claimed verified by
the unit test suite; payments remain unimplemented.
