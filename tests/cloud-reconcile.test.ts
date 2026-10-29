import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCloudChat, subscribeCloudChat } from '../server/cloud-twitch.ts';
import type { SupabaseRepository } from '../server/supabase.ts';
const origin = 'https://chatspin.example',
  channel = '101',
  now = 1000000;
function fakeStore(status: any = { status: 'Connected' }) {
  let row = { value: status, version: '1' },
    version = 1,
    credentials = true;
  const repository = {
    async secretRecord() {
      return structuredClone(row);
    },
    async getSecret(_channel: string, name: string) {
      return name === 'twitch' && credentials ? { access_token: 'fake' } : undefined;
    },
    async replaceSecret(_channel: string, _name: string, expected: string, value: any) {
      if (row.version !== expected) return undefined;
      row = { value, version: String(++version) };
      return row.version;
    },
    async putSecret(_channel: string, _name: string, value: any) {
      row = { value, version: String(++version) };
    },
  } as unknown as SupabaseRepository;
  return {
    repository,
    status: () => row.value,
    disconnect: () => {
      credentials = false;
      row = { value: { status: 'Disconnected' }, version: String(++version) };
    },
  };
}
const owned = (status: string) => ({
  id: 'subscription',
  type: 'channel.chat.message',
  status,
  condition: { broadcaster_user_id: channel, user_id: channel },
  transport: { method: 'webhook', callback: origin + '/api/twitch/events/' + channel },
});
async function mockNetwork(
  rows: any[],
  run: (requests: { url: string; method: string }[]) => Promise<void>,
  duringLookup?: () => void,
) {
  const previous = globalThis.fetch;
  const requests: { url: string; method: string }[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input),
      method = init?.method || 'GET';
    requests.push({ url, method });
    if (url === 'https://id.twitch.tv/oauth2/token')
      return Response.json({ access_token: 'app-token' });
    if (method === 'GET') {
      duringLookup?.();
      return Response.json({ data: rows, pagination: {} });
    }
    return new Response(null, { status: method === 'POST' ? 202 : 204 });
  }) as typeof fetch;
  try {
    await run(requests);
  } finally {
    globalThis.fetch = previous;
  }
}
test('Healthy EventSub subscriptions are retained and checks are throttled durably', async () => {
  const store = fakeStore();
  await mockNetwork([owned('enabled')], async (calls) => {
    await reconcileCloudChat(store.repository, channel, origin, 'secret', now);
    assert.equal(store.status().status, 'Connected');
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1].url).searchParams.get('user_id'), channel);
    await reconcileCloudChat(store.repository, channel, origin, 'secret', now + 1000);
    assert.equal(calls.length, 2);
  });
});
test('Missing and delivery-failed subscriptions recover automatically without OAuth', async () => {
  for (const rows of [
    [],
    [owned('notification_failures_exceeded')],
    [owned('webhook_callback_verification_failed')],
  ]) {
    const store = fakeStore();
    await mockNetwork(rows, async (calls) => {
      await reconcileCloudChat(store.repository, channel, origin, 'secret', now);
      assert.equal(calls.filter((r) => r.method === 'DELETE').length, rows.length);
      assert.equal(calls.filter((r) => r.method === 'POST' && r.url.includes('/helix/')).length, 1);
      assert.equal(store.status().status, 'Awaiting webhook verification');
    });
  }
});
test('Revoked authorization and pending verification do not trigger automatic subscriptions', async () => {
  for (const reason of [
    'authorization_revoked',
    'user_removed',
    'version_removed',
    'webhook_callback_verification_pending',
  ]) {
    const store = fakeStore();
    await mockNetwork([owned(reason)], async (calls) => {
      await reconcileCloudChat(store.repository, channel, origin, 'secret', now);
      assert.equal(calls.filter((r) => r.url.includes('/helix/') && r.method !== 'GET').length, 0);
      if (reason === 'authorization_revoked') {
        assert.equal(store.status().reason, reason);
        await reconcileCloudChat(store.repository, channel, origin, 'secret', now + 600000);
        assert.equal(calls.length, 2);
      }
    });
  }
});
test('Disconnected channels never reconnect and concurrent disconnect is not overwritten', async () => {
  const stopped = fakeStore({ status: 'Disconnected' });
  await mockNetwork([], async (calls) => {
    await reconcileCloudChat(stopped.repository, channel, origin, 'secret', now);
    assert.equal(calls.length, 0);
  });
  const racing = fakeStore();
  await mockNetwork(
    [],
    async (calls) => {
      await reconcileCloudChat(racing.repository, channel, origin, 'secret', now);
      assert.equal(racing.status().status, 'Disconnected');
      assert.equal(
        calls.some((r) => r.method === 'POST' && r.url.includes('/helix/')),
        false,
      );
    },
    racing.disconnect,
  );
});
test('Recovery never deletes subscriptions belonging to another callback or channel', async () => {
  const store = fakeStore(),
    foreign = {
      ...owned('notification_failures_exceeded'),
      transport: { method: 'webhook', callback: 'https://other.example/events' },
    };
  await mockNetwork([foreign], async (calls) => {
    await reconcileCloudChat(store.repository, channel, origin, 'secret', now);
    assert.equal(
      calls.some((r) => r.method === 'DELETE'),
      false,
    );
    assert.equal(calls.filter((r) => r.method === 'POST' && r.url.includes('/helix/')).length, 1);
  });
});
test('Explicit OAuth subscription does not overwrite a disconnect that happens during creation', async () => {
  const store = fakeStore();
  const old = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input).includes('/oauth2/')) return Response.json({ access_token: 'app' });
    store.disconnect();
    return new Response(null, { status: 409 });
  }) as typeof fetch;
  try {
    await subscribeCloudChat(store.repository, channel, origin, 'secret');
    assert.equal(store.status().status, 'Disconnected');
  } finally {
    globalThis.fetch = old;
  }
});
