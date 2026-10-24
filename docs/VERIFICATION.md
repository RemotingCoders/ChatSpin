# Verification record

Checked locally on October 24, 2026 with Node.js 24.

## Automated

- `npm run build`: TypeScript validation and production Vite bundle.
- `npm test`: domain tests for identity deduplication, minority eligibility, unique support weights, frozen draws, duplicate spin prevention, group merge/split policy, answered-group review, manual selection, and participant exclusion.
- Grouping decision tests cover same-batch paraphrases, merge aliases, uncertain matches, invalid targets, and cycle prevention. These use supplied model decisions and do not measure model quality.
- HTTP integration test starts an isolated server and checks anonymous rejection, origin protection, viewer control denial, filtering of other viewers' originals and approved answers, exact-match answer delivery, unique support, reopening, dashboard/OBS snapshot equality, and concurrent spin rejection.
- EventSub transport test uses a local mock WebSocket server: subscription payload, message deduplication, reconnect after a closed socket, resubscription, and revocation. This is not a live Twitch test.
- `npm run test:ai` intentionally exits with a configuration message when no key is supplied. Live semantic evaluation was not run because `OPENAI_API_KEY` is absent.

## Browser smoke test

Opened the application locally, entered the explicitly labeled demo, spun the question wheel, observed the spinning/selected states, opened the selected original, and marked it answered live. The open-question count decreased and the answered count increased. The responsive narrow layout was visually inspected.

## External verification still required

- Real broadcaster OAuth, granted scope, channel identity, EventSub delivery from Twitch, refresh/revocation with real tokens, and recovery from actual network failures.
- Paid live model evaluation (`npm run test:ai`), followed by representative channel-language samples and operator review of grouping quality.
- OBS Browser Source on the streaming computer, including network latency and viewport sizing.
- Real viewer OAuth in two separate browser sessions and the complete real Twitch walkthrough in README.md.

No application, repository, or video was published or deployed. This is a local prototype; the demo does not imply a connected Twitch channel or a passing live-model evaluation.
