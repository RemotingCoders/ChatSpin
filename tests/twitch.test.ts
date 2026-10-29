import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, type WebSocket } from 'ws';
import { TwitchConnection } from '../server/twitch.ts';
test('EventSub subscribes, deduplicates notifications, reconnects, and handles revocation', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  const originalFetch = globalThis.fetch;
  let subscriptions = 0,
    connections = 0,
    received = 0;
  let current: WebSocket | undefined;
  globalThis.fetch = (async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.type, 'channel.chat.message');
    assert.equal(payload.condition.broadcaster_user_id, 'owner');
    assert.equal(payload.condition.user_id, 'owner');
    assert.equal(payload.transport.method, 'websocket');
    subscriptions++;
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  server.on('connection', (socket) => {
    current = socket;
    connections++;
    socket.send(
      JSON.stringify({
        metadata: { message_type: 'session_welcome' },
        payload: { session: { id: 'session-' + connections } },
      }),
    );
  });
  const client = new TwitchConnection(
    { access_token: 'test', refresh_token: 'test', expires_in: 3600 },
    'owner',
    () => received++,
    `ws://127.0.0.1:${address.port}`,
  );
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Expected EventSub state not reached');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    await client.start();
    await until(() => client.status === 'Connected');
    assert.equal(subscriptions, 1);
    const notification = JSON.stringify({
      metadata: { message_type: 'notification', message_id: 'duplicate' },
      payload: {
        event: {
          chatter_user_id: 'viewer',
          chatter_user_name: 'Viewer',
          message: { text: '!ask How do I start?' },
        },
      },
    });
    current!.send(notification);
    current!.send(notification);
    await until(() => received === 1);
    assert.equal(received, 1);
    current!.close();
    await until(() => connections === 2 && client.status === 'Connected');
    assert.equal(subscriptions, 2);
    current!.send(JSON.stringify({ metadata: { message_type: 'revocation' }, payload: {} }));
    await until(() => client.status.includes('revoked'));
  } finally {
    client.stop();
    for (const socket of server.clients) socket.terminate();
    server.close();
    globalThis.fetch = originalFetch;
  }
});

test('Twitch migration uses independent socket watchdogs and does not resubscribe', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No address');
  const endpoint = `ws://127.0.0.1:${address.port}`;
  let connections = 0,
    subscriptions = 0;
  const sockets: WebSocket[] = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async () => {
    subscriptions++;
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  server.on('connection', (socket) => {
    connections++;
    sockets.push(socket);
    socket.send(
      JSON.stringify({
        metadata: { message_type: 'session_welcome' },
        payload: { session: { id: 'session-' + connections, keepalive_timeout_seconds: 1 } },
      }),
    );
  });
  const client = new TwitchConnection(
    { access_token: 'test', refresh_token: 'test', expires_in: 3600 },
    'owner',
    () => {},
    endpoint,
  );
  const until = async (check: () => boolean) => {
    const end = Date.now() + 3000;
    while (!check()) {
      if (Date.now() > end) throw Error('Migration timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  try {
    await client.start();
    await until(() => client.status === 'Connected');
    sockets[0].send(
      JSON.stringify({
        metadata: { message_type: 'session_reconnect' },
        payload: { session: { reconnect_url: endpoint } },
      }),
    );
    await until(() => connections === 2 && client.status === 'Connected');
    assert.equal(subscriptions, 1);
    await until(() => sockets[0].readyState === 3);
    assert.equal(sockets[1].readyState, 1);
  } finally {
    client.stop();
    globalThis.fetch = fetchBefore;
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('Concurrent token requests share one refresh and persist the new credentials', async () => {
  const original = globalThis.fetch;
  let calls = 0,
    saved = 0;
  globalThis.fetch = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(
      JSON.stringify({ access_token: 'renewed', refresh_token: 'new-refresh', expires_in: 3600 }),
    );
  }) as typeof fetch;
  try {
    const client = new TwitchConnection(
      { access_token: 'expired', refresh_token: 'test', expires_in: 0 },
      'owner',
      () => {},
      undefined,
      () => saved++,
    );
    const tokens = await Promise.all([client.token(), client.token()]);
    assert.deepEqual(tokens, ['renewed', 'renewed']);
    assert.equal(calls, 1);
    assert.equal(saved, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('Validation outages preserve a subscribed socket and successful validation cannot complete a handshake', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No address');
  const original = globalThis.fetch;
  let validationStatus = 200,
    received = 0,
    removed = false;
  let socket: WebSocket | undefined;
  server.on('connection', (s) => {
    socket = s;
  });
  globalThis.fetch = (async (url) =>
    String(url).includes('/validate')
      ? Response.json(
          { user_id: 'owner', client_id: process.env.TWITCH_CLIENT_ID },
          { status: validationStatus },
        )
      : Response.json({}, { status: 202 })) as typeof fetch;
  const client = new TwitchConnection(
    { access_token: 'test', refresh_token: 'test', expires_in: 3600 },
    'owner',
    () => received++,
    `ws://127.0.0.1:${address.port}`,
    (value) => {
      removed = value === null;
    },
  );
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error('State timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  try {
    await client.start();
    await client.validate();
    assert.notEqual(client.status, 'Connected');
    await until(() => !!socket);
    await client.validate();
    assert.notEqual(client.status, 'Connected');
    socket!.send(
      JSON.stringify({
        metadata: { message_type: 'session_welcome' },
        payload: { session: { id: 'ready' } },
      }),
    );
    await until(() => client.status === 'Connected');
    validationStatus = 503;
    for (let i = 0; i < 7; i++) await client.validate();
    const serviceFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError('Network unavailable');
    };
    await client.validate();
    globalThis.fetch = serviceFetch;
    validationStatus = 429;
    await client.validate();
    assert.equal(client.status, 'Connected');
    assert.equal(removed, false);
    socket!.send(
      JSON.stringify({
        metadata: { message_type: 'notification', message_id: 'still-live' },
        payload: {
          event: {
            chatter_user_id: 'viewer',
            chatter_user_name: 'Viewer',
            message: { text: 'Still working?' },
          },
        },
      }),
    );
    await until(() => received === 1);
    validationStatus = 200;
    await client.validate();
    assert.equal(client.status, 'Connected');
    validationStatus = 401;
    await client.validate();
    assert.equal(removed, true);
    assert.match(client.status, /Connect again/);
  } finally {
    client.stop();
    globalThis.fetch = original;
    for (const s of server.clients) s.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
