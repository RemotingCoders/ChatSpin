import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, webhookSecret } from '../server/cloud-twitch.ts';
import { cloudDashboardAction } from '../server/cloud-actions.ts';
import { emptyState, addQuestion } from '../server/domain.ts';
import { bindBudget, reserveAI, flushBudget } from '../server/limits.ts';
test('EventSub webhook signatures reject altered bodies, stale timestamps and wrong channels', () => {
  const channel = '101',
    secret = webhookSecret('private-server-secret', channel),
    raw = Buffer.from('{"event":"test"}'),
    id = 'message',
    timestamp = new Date().toISOString();
  const headers = {
    'twitch-eventsub-message-id': id,
    'twitch-eventsub-message-timestamp': timestamp,
    'twitch-eventsub-message-signature':
      'sha256=' +
      createHmac('sha256', secret)
        .update(id + timestamp)
        .update(raw)
        .digest('hex'),
  };
  assert.ok(verifyWebhook(raw, headers, secret));
  assert.equal(verifyWebhook(Buffer.from('{}'), headers, secret), false);
  assert.equal(verifyWebhook(raw, headers, webhookSecret('private-server-secret', '202')), false);
  assert.equal(verifyWebhook(raw, headers, secret, Date.now() + 700000), false);
  assert.equal(verifyWebhook(raw, {}, secret), false);
});
test('Hosted dashboard actions retain answer lifecycle and request snapshots before destructive changes', () => {
  const state = emptyState(),
    user = { id: '101', name: 'Owner' },
    g = addQuestion(state, user, 'Where are you from?');
  cloudDashboardAction(state, user, {
    type: 'answer',
    id: g.id,
    text: 'Argentina',
    value: 'session',
  });
  assert.equal(g.answer, 'Argentina');
  assert.equal(g.status, 'written');
  assert.throws(() => cloudDashboardAction(state, user, { type: 'clear-questions' }), /Confirm/);
  assert.equal(
    cloudDashboardAction(state, user, { type: 'clear-questions', confirmed: true }),
    true,
  );
  assert.equal(state.groups.length, 0);
  assert.throws(() =>
    cloudDashboardAction(state, user, { type: 'ask', text: 'A question?', channel: '202' }),
  );
});
test('Cloud AI waits for durable budget reservations before provider calls', async () => {
  const state = emptyState();
  let saved = false;
  bindBudget(
    state,
    () => {},
    async () => {
      saved = true;
    },
  );
  reserveAI(state, 50);
  assert.equal(saved, false);
  await flushBudget(state);
  assert.equal(saved, true);
  bindBudget(
    state,
    () => {},
    async () => {
      throw Error('database unavailable');
    },
  );
  reserveAI(state, 50);
  await assert.rejects(flushBudget(state), /database unavailable/);
});

import { database } from './fixtures/cloud-db.ts';
import { createCloudApp } from '../server/cloud.ts';
test('Hosted OAuth binds each channel to validated identity and uses persisted sessions and webhooks', async () => {
  const { repository } = database(),
    origin = 'https://chatspin.example',
    secret = 'a'.repeat(40),
    savedFetch = globalThis.fetch,
    oldId = process.env.TWITCH_CLIENT_ID,
    oldSecret = process.env.TWITCH_CLIENT_SECRET;
  process.env.TWITCH_CLIENT_ID = 'app';
  process.env.TWITCH_CLIENT_SECRET = 'test-secret';
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === 'https://id.twitch.tv/oauth2/token') {
      const fields = init?.body as URLSearchParams;
      return Response.json({
        access_token: fields.get('code') || 'app-token',
        refresh_token: 'refresh',
        expires_in: 3600,
      });
    }
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      const user = new Headers(init?.headers).get('Authorization')!.slice(6);
      return Response.json({
        user_id: user,
        login: 'owner' + user,
        client_id: 'app',
        scopes: ['user:read:chat', 'user:write:chat', 'user:bot', 'channel:bot'],
      });
    }
    if (url === 'https://api.twitch.tv/helix/eventsub/subscriptions')
      return Response.json({ data: [{ id: 'subscription' }] }, { status: 202 });
    return savedFetch(input, init);
  }) as typeof fetch;
  const work: Promise<unknown>[] = [];
  const server = createCloudApp(repository, origin, secret, (p) => {
    work.push(p);
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const request = (path: string, init: RequestInit = {}) =>
    savedFetch(base + path, {
      ...init,
      redirect: 'manual',
      headers: { 'X-Forwarded-Proto': 'https', ...init.headers },
    });
  const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
  async function login(id: string) {
    const start = await request('/auth/twitch?channel=999');
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const result = await request('/auth/callback?code=' + id + '&state=' + state, {
      headers: { Cookie: cookie(start) },
    });
    assert.equal(result.status, 302);
    return cookie(result);
  }
  try {
    assert.equal((await request('/api/state')).status, 401);
    const one = await login('101'),
      two = await login('202');
    assert.equal((await repository.getSecret<any>('101', 'twitch')).access_token, '101');
    assert.equal((await repository.getSecret<any>('202', 'twitch')).access_token, '202');
    assert.equal(
      (
        await request('/api/action', {
          method: 'POST',
          headers: {
            Cookie: one,
            'Content-Type': 'application/json',
            Origin: 'https://evil.example',
          },
          body: '{}',
        })
      ).status,
      403,
    );
    // Disable background work for these read projections, without altering production scheduling.
    for (const id of ['101', '202'])
      await repository.mutate(id, (s) => {
        s.cloudMaintenance = Date.now();
      });
    await repository.mutate('101', (s) => {
      addQuestion(s, { id: '101', name: 'Owner' }, 'Private channel one?').aiProcessed = true;
    });
    const stateOne = await (await request('/api/state', { headers: { Cookie: one } })).json(),
      stateTwo = await (
        await request('/api/state?channel=101', { headers: { Cookie: two } })
      ).json();
    assert.equal(stateOne.groups.length, 1);
    assert.equal(stateTwo.groups.length, 0);
    assert.equal(stateOne.cloudRates, undefined);
    assert.equal(stateOne.cloudLease, undefined);
    const overlayPath = new URL(stateOne.obsUrl).pathname + new URL(stateOne.obsUrl).search;
    assert.equal((await request(overlayPath.replace('/obs?', '/api/overlay?'))).status, 200);
    const raw = JSON.stringify({
        subscription: { type: 'channel.chat.message', condition: { broadcaster_user_id: '101' } },
        challenge: 'verified',
      }),
      timestamp = new Date().toISOString(),
      id = 'challenge';
    const signature =
      'sha256=' +
      createHmac('sha256', webhookSecret(secret, '101'))
        .update(id + timestamp + raw)
        .digest('hex');
    const event = await request('/api/twitch/events/101', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'twitch-eventsub-message-id': id,
        'twitch-eventsub-message-timestamp': timestamp,
        'twitch-eventsub-message-signature': signature,
        'twitch-eventsub-message-type': 'webhook_callback_verification',
      },
      body: raw,
    });
    assert.equal(event.status, 200);
    assert.equal(await event.text(), 'verified');
    assert.equal((await repository.getSecret<any>('101', 'chat-status')).status, 'Connected');
    await repository.mutate('101', (s) => {
      s.questionLanguage = 'en';
    });
    const lease = await repository.acquire('101');
    const languageResponse = await request('/api/action', {
      method: 'POST',
      headers: { Cookie: one, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'question-language', value: 'original' }),
    });
    assert.equal(languageResponse.status, 200);
    assert.equal(await repository.getSecret('101', 'question-language'), 'original');
    assert.equal(
      (await (await request('/api/state', { headers: { Cookie: one } })).json()).questionLanguage,
      'original',
    );
    assert.equal(await repository.getSecret('202', 'question-language'), undefined);
    delete lease.state.cloudLease;
    await repository.commit(lease);
    assert.equal((await request('/api/cron')).status, 403);
  } finally {
    await Promise.allSettled(work);
    server.close();
    server.closeAllConnections();
    globalThis.fetch = savedFetch;
    if (oldId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = oldSecret;
  }
});

import { aiFailure } from '../server/ai-status.ts';
test('AI error status exposes only known failure categories, never provider messages', () => {
  assert.match(
    aiFailure({ status: 401, message: 'private-key' }, 'Retry queued'),
    /authentication/,
  );
  assert.match(
    aiFailure({ status: 429, code: 'insufficient_quota' }, 'Retry queued'),
    /quota exhausted/,
  );
  assert.equal(
    aiFailure({ status: 500, message: 'private question and key' }, 'Retry queued'),
    'Retry queued',
  );
});

import { processCloudChannel } from '../server/cloud-work.ts';
test('Hosted worker persists provider failures and releases the channel after failed grouping and translation', async () => {
  const { repository } = database(),
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  try {
    await repository.mutate('101', (state) => {
      addQuestion(state, { id: '7', name: 'Viewer' }, 'Que estas haciendo?');
      state.questionLanguage = 'en';
      state.cloudMaintenance = Date.now();
    });
    const failure = async (state: ReturnType<typeof emptyState>) => {
      reserveAI(state, 100);
      await flushBudget(state);
      throw Object.assign(Error('private provider message'), { status: 401 });
    };
    await processCloudChannel(repository, '101', {
      reserve: async () => {},
      group: async (state) => failure(state),
      translate: async (_items, _language, state) => failure(state),
    });
    const { state } = await repository.load('101');
    assert.equal(state.aiBudget?.calls, 2);
    assert.equal(state.usage.calls, 0);
    assert.equal(state.cloudLease, undefined);
    assert.match(state.cloudStatus!.ai, /authentication failed/);
    assert.match(state.cloudStatus!.translation, /authentication failed/);
    assert.equal(state.groups[0].text, 'Que estas haciendo?');
    assert.equal(state.groups[0].translations?.en, undefined);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
