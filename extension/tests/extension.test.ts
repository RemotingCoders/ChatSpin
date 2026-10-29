import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import { verifyExtensionJWT, extensionController, linkedViewer } from '../server/auth.ts';
import { applyExtensionAction, extensionState } from '../server/service.ts';
import { extensionRouter } from '../server/router.ts';
import { addQuestion, demoState, emptyState, spin } from '../../server/domain.ts';
const key = Buffer.alloc(32, 7).toString('base64'),
  channel = '12345',
  origin = 'https://example.ext-twitch.tv';
const claims = (changes: Record<string, unknown> = {}) => ({
  channel_id: channel,
  exp: Math.floor(Date.now() / 1000) + 300,
  opaque_user_id: 'Uviewer',
  role: 'viewer',
  user_id: '99',
  ...changes,
});
function jwt(payload: Record<string, unknown>, secret = key, alg = 'HS256') {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url'),
    body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return (
    header +
    '.' +
    body +
    '.' +
    createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(header + '.' + body)
      .digest('base64url')
  );
}
test('Extension authentication rejects forged, expired, external-role and cross-channel tokens', () => {
  assert.equal(verifyExtensionJWT(jwt(claims()), [key], channel).user_id, '99');
  for (const token of [
    jwt(claims({ exp: 1 })),
    jwt(claims({ channel_id: 'other' })),
    jwt(claims({ role: 'external' })),
    jwt(claims(), Buffer.alloc(32, 8).toString('base64')),
    jwt(claims(), key, 'none'),
  ])
    assert.throws(() => verifyExtensionJWT(token, [key], channel));
  assert.equal(
    verifyExtensionJWT(jwt(claims()), [Buffer.alloc(32, 8).toString('base64'), key], channel).role,
    'viewer',
  );
});
test('Only channel owners and explicitly allowed linked moderators receive controller permissions', () => {
  assert.equal(extensionController(claims() as never, []), false);
  assert.equal(
    extensionController(
      claims({ role: 'broadcaster', opaque_user_id: 'U' + channel, user_id: undefined }) as never,
      [],
    ),
    true,
  );
  assert.equal(extensionController(claims({ role: 'broadcaster' }) as never, []), false);
  assert.equal(extensionController(claims({ role: 'moderator' }) as never, []), false);
  assert.equal(extensionController(claims({ role: 'moderator' }) as never, ['99']), true);
  assert.equal(
    linkedViewer(claims({ opaque_user_id: 'Anonymous', user_id: undefined }) as never),
    undefined,
  );
  assert.equal(linkedViewer(claims({ is_unlinked: true }) as never), undefined);
});
test('Personal question languages change only projection, not shared settings, weights or winner', () => {
  const s = demoState();
  const g = s.groups[0];
  spin(s, g.id);
  const before = JSON.stringify(s),
    actor = { controller: false, anonymous: false, user: { id: '99', name: 'Viewer' } };
  const es = extensionState(s, actor, 'es'),
    ru = extensionState(s, actor, 'ru');
  assert.notEqual(es.groups[0].text, ru.groups[0].text);
  assert.equal(es.spin!.winner, ru.spin!.winner);
  assert.deepEqual(
    es.entries.map((e) => e.weight),
    ru.entries.map((e) => e.weight),
  );
  assert.equal(JSON.stringify(s), before);
  assert.equal(es.groups[0].originals.length, 0);
});
test('Viewer participation uses verified identity and never grants spin, answer or settings control', () => {
  const s = emptyState(),
    actor = { controller: false, anonymous: false, user: { id: '99', name: 'Viewer' } };
  for (const type of ['spin', 'mode', 'toggle-registration', 'answer'])
    assert.throws(() =>
      applyExtensionAction(
        s,
        actor,
        {
          type,
          ...(type === 'mode' ? { value: 'participants' } : {}),
          ...(type === 'answer' ? { id: 'missing', text: 'x' } : {}),
        },
        () => {},
      ),
    );
  applyExtensionAction(s, actor, { type: 'ask', text: 'What is ChatSpin?' }, () => {});
  applyExtensionAction(s, actor, { type: 'join' }, () => {});
  applyExtensionAction(s, actor, { type: 'join' }, () => {});
  assert.equal(s.participants.length, 1);
  assert.equal(s.groups[0].questions[0].user.id, '99');
  assert.throws(
    () =>
      applyExtensionAction(
        s,
        { controller: false, anonymous: true },
        { type: 'ask', text: 'A question?' },
        () => {},
      ),
    /identity/,
  );
  assert.throws(() =>
    applyExtensionAction(
      s,
      actor,
      { type: 'ask', text: 'Question?', user: { id: channel } },
      () => {},
    ),
  );
});
test('Extension controllers operate the same shared draw and answer lifecycle', () => {
  const s = emptyState(),
    g = addQuestion(s, { id: '99', name: 'Viewer' }, 'Question?');
  g.aiProcessed = true;
  const actor = { controller: true, anonymous: false, user: { id: channel, name: 'Owner' } };
  applyExtensionAction(s, actor, { type: 'spotlight', id: g.id }, () => {});
  assert.equal(s.spin!.winner, g.id);
  applyExtensionAction(s, actor, { type: 'answer', id: g.id, text: 'Approved' }, () => {});
  assert.equal(g.status, 'written');
  assert.equal(g.answer, 'Approved');
  assert.equal(
    extensionState(
      s,
      { controller: false, anonymous: false, user: { id: '99', name: 'Viewer' } },
      'original',
    ).groups[0].answer,
    'Approved',
  );
});
test('Extension HTTP API enforces JWT, channel, CORS and viewer permissions independently of cookies', async () => {
  const s = emptyState();
  let saves = 0;
  const app = express();
  app.use(
    '/extension-api',
    extensionRouter({
      state: () => s,
      persist: () => saves++,
      enqueue: () => {},
      busy: () => false,
      demand: () => {},
      clientId: 'example',
      secrets: [key],
      channel,
      origins: [origin],
      moderators: [],
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No server');
  const base = `http://127.0.0.1:${address.port}/extension-api`;
  const call = (path: string, token?: string, body?: unknown, source = origin) =>
    fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: source,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await call('/state')).status, 401);
    assert.equal(
      (await call('/state', jwt(claims()), undefined, 'https://untrusted.example')).status,
      403,
    );
    const response = await call('/state', jwt(claims()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const data = await response.json();
    assert.equal(data.obsUrl, undefined);
    assert.equal(data.settings, undefined);
    assert.equal((await call('/action', jwt(claims()), { type: 'spin' })).status, 403);
    assert.equal(
      (await call('/action', jwt(claims()), { type: 'ask', text: 'A question?' })).status,
      200,
    );
    assert.equal(saves, 1);
    s.groups.forEach((g) => (g.aiProcessed = true));
    assert.equal(
      (
        await call(
          '/action',
          jwt(claims({ role: 'broadcaster', opaque_user_id: 'U' + channel, user_id: channel })),
          { type: 'spin' },
        )
      ).status,
      200,
    );
    assert.equal((await call('/state', jwt(claims({ channel_id: '54321' })))).status, 401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('Answer saving removes empty and written answers from the wheel by default, with explicit opt-out', () => {
  for (const text of ['', 'Argentina'])
    for (const removeFromWheel of [undefined, true, false]) {
      const state = emptyState(),
        group = addQuestion(state, { id: '99', name: 'Viewer' }, 'Where are you from?');
      group.aiProcessed = true;
      const actor = { controller: true, anonymous: false, user: { id: channel, name: 'Owner' } };
      applyExtensionAction(
        state,
        actor,
        {
          type: 'answer',
          id: group.id,
          text,
          ...(removeFromWheel === undefined ? {} : { removeFromWheel }),
        },
        () => {},
      );
      const projected = extensionState(state, actor, 'original');
      assert.equal(group.answer, text);
      assert.equal(
        projected.entries.some((entry) => entry.id === group.id),
        removeFromWheel === false,
      );
      assert.equal(group.status, removeFromWheel === false ? 'pending' : text ? 'written' : 'live');
      assert.equal(group.questions.length, 1);
    }
});
