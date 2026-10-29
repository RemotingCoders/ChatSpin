import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import express from 'express';
import { SupabaseRepository, StateConflict, ChannelBusy } from '../server/supabase.ts';
import { addQuestion, emptyState } from '../server/domain.ts';
import { cloudExtensionRouter } from '../extension/server/cloud.ts';
import { database } from './fixtures/cloud-db.ts';
test('Cloud storage keeps channels isolated and refuses stale commits', async () => {
  const { repository } = database(),
    one = await repository.load('101'),
    other = await repository.load('202');
  addQuestion(one.state, { id: '7', name: 'A' }, 'First channel question?');
  await repository.commit(one);
  assert.equal((await repository.load('101')).state.groups.length, 1);
  assert.equal(other.state.groups.length, 0);
  const stale = await repository.load('101'),
    fresh = await repository.load('101');
  fresh.state.registration = false;
  await repository.commit(fresh);
  await assert.rejects(repository.commit(stale), StateConflict);
  assert.equal((await repository.load('101')).state.registration, false);
});
test('Cloud secrets are encrypted, scoped by channel, and fail closed with the wrong key', async () => {
  const { repository, secrets } = database();
  await repository.load('101');
  await repository.load('202');
  await repository.putSecret('101', 'twitch', { access_token: 'private-token' });
  assert.deepEqual(await repository.getSecret('101', 'twitch'), { access_token: 'private-token' });
  assert.equal(await repository.getSecret('202', 'twitch'), undefined);
  assert.ok(![...secrets.values()].some((v) => v.includes('private-token')));
  const encrypted = repository.seal({ value: 'private' });
  assert.throws(() =>
    new SupabaseRepository('https://project.supabase.co', 'server-only', 'b'.repeat(40)).unseal(
      encrypted,
    ),
  );
  await assert.rejects(repository.load('101&channel_id=202'));
});
test('Supabase provider failures do not expose provider bodies or secrets', async () => {
  const repository = new SupabaseRepository(
    'https://project.supabase.co',
    'server-only',
    'a'.repeat(40),
    (async () =>
      new Response(JSON.stringify({ message: 'private-token' }), { status: 500 })) as typeof fetch,
  );
  await assert.rejects(
    repository.load('101'),
    (error) => error instanceof Error && !error.message.includes('private-token'),
  );
  assert.throws(
    () => new SupabaseRepository('http://project.supabase.co', 'server-only', 'a'.repeat(40)),
  );
});
test('Application conflict responses use bounded retries and support the previous database code during migration', async () => {
  for (const code of ['PT409', '40001']) {
    let attempts = 0;
    const repository = new SupabaseRepository(
      'https://project.supabase.co',
      'server-only',
      'a'.repeat(40),
      (async (input) => {
        if (String(input).includes('/rpc/')) {
          attempts++;
          return Response.json({ code }, { status: 409 });
        }
        return Response.json([{ channel_id: '101', revision: 0, state: emptyState() }]);
      }) as typeof fetch,
    );
    await assert.rejects(
      repository.mutate('101', () => {}),
      StateConflict,
    );
    assert.equal(attempts, 4);
  }
});
test('Multi-channel extension trusts signed channel only and isolates owner controls', async () => {
  const { repository } = database(),
    secret = randomBytes(32).toString('base64'),
    origin = 'https://extension.ext-twitch.tv';
  const token = (channel: string, role = 'broadcaster', user = channel) => {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
      payload = Buffer.from(
        JSON.stringify({
          channel_id: channel,
          role,
          opaque_user_id: 'U' + user,
          user_id: user,
          exp: Date.now() / 1000 + 300,
        }),
      ).toString('base64url'),
      data = head + '.' + payload;
    return (
      data +
      '.' +
      createHmac('sha256', Buffer.from(secret, 'base64')).update(data).digest('base64url')
    );
  };
  const app = express();
  app.use(
    '/extension-api',
    cloudExtensionRouter({ repository, clientId: 'extension', secrets: [secret] }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/extension-api';
  const call = (path: string, t: string, body?: unknown) =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + t, Origin: origin, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal(
      (await call('/action', token('101'), { type: 'ask', text: 'Channel one only?' })).status,
      200,
    );
    assert.equal((await (await call('/state', token('101'))).json()).groups.length, 1);
    assert.equal((await (await call('/state', token('202'))).json()).groups.length, 0);
    assert.equal(
      (await call('/action', token('101', 'viewer', '9'), { type: 'spin' })).status,
      403,
    );
    assert.equal(
      (await call('/action', token('202'), { type: 'ask', text: 'Test?', channel_id: '101' }))
        .status,
      400,
    );
    assert.equal((await call('/state', token('101', 'broadcaster', '202'))).status, 401);
    assert.equal(
      (await fetch(base + '/state', { headers: { Cookie: 'connect.sid=fake' } })).status,
      401,
    );
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('Cloud processing leases fence concurrent writes, expire safely, and rate limits persist', async () => {
  const { repository } = database();
  const locked = await repository.acquire('101');
  await repository.mutate('101', (s) => {
    s.registration = false;
  });
  assert.equal((await repository.load('101')).state.registration, false);
  await assert.rejects(repository.acquire('101'), ChannelBusy);
  await repository.mutate('101', (s) => {
    s.cloudLease!.until = Date.now() - 1;
  });
  await repository.mutate('101', (s) => {
    s.registration = false;
  });
  assert.equal((await repository.load('101')).state.registration, false);
  for (let i = 0; i < 30; i++) await repository.rate('101', '7');
  await assert.rejects(
    repository.rate('101', '7'),
    (error) => (error as { status: number }).status === 429,
  );
  await repository.rate('202', '7');
});
test('Cloud sessions expire and durable inboxes stay isolated by channel', async () => {
  const { repository } = database();
  await repository.setSession('one', { user: { id: '101' } }, Date.now() + 60000);
  assert.deepEqual(await repository.getSession('one'), { user: { id: '101' } });
  await repository.setSession('expired', { user: { id: '202' } }, Date.now() - 1000);
  assert.equal(await repository.getSession('expired'), undefined);
  await repository.destroySession('one');
  assert.equal(await repository.getSession('one'), undefined);
  await repository.load('101');
  await repository.putSecret('101', 'inbox:message', { text: 'Question?' });
  assert.equal((await repository.inbox('101')).length, 1);
  assert.equal((await repository.inbox('202')).length, 0);
});

test('Extension state responds while a translation-demand write is stalled and skips recent demands', async () => {
  const { repository } = database();
  await repository.load('101');
  await repository.mutate('101', (s) => {
    s.questionLanguage = 'en';
    addQuestion(s, { id: '7', name: 'Viewer' }, 'Where are you from?');
  });
  const secret = randomBytes(32).toString('base64'),
    head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    payload = Buffer.from(
      JSON.stringify({
        channel_id: '101',
        role: 'viewer',
        opaque_user_id: 'U7',
        user_id: '7',
        exp: Date.now() / 1000 + 300,
      }),
    ).toString('base64url'),
    data = head + '.' + payload;
  const token =
    data +
    '.' +
    createHmac('sha256', Buffer.from(secret, 'base64')).update(data).digest('base64url');
  const originalMutate = repository.mutate.bind(repository);
  let release!: () => void,
    writes = 0;
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  repository.mutate = (async (...args: Parameters<typeof originalMutate>) => {
    writes++;
    await stalled;
    return originalMutate(...args);
  }) as typeof repository.mutate;
  const background: Promise<unknown>[] = [];
  let scheduled = 0;
  const app = express();
  app.use(
    '/extension-api',
    cloudExtensionRouter({
      repository,
      clientId: 'extension',
      secrets: [secret],
      background: (p) => {
        background.push(p);
      },
      schedule: () => {
        scheduled++;
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url =
    'http://127.0.0.1:' + (server.address() as { port: number }).port + '/extension-api/state';
  const read = () =>
    fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Origin: 'https://extension.ext-twitch.tv' },
      signal: AbortSignal.timeout(2000),
    });
  try {
    const response = await read();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).groups.length, 1);
    assert.equal(writes, 1);
    assert.equal(scheduled, 0);
    release();
    await Promise.all(background);
    assert.equal(scheduled, 1);
    assert.equal((await read()).status, 200);
    assert.equal(writes, 1);
    assert.equal(scheduled, 2);
  } finally {
    release();
    await Promise.allSettled(background);
    server.close();
    server.closeAllConnections();
  }
});
