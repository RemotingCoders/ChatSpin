import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuestion, emptyState } from '../server/domain.ts';
import { ApprovedReplies, approvedReplyParts } from '../server/replies.ts';
import { TwitchConnection } from '../server/twitch.ts';

const viewer = { id: 'viewer', name: 'Viewer', login: 'viewer' };
function fixture() {
  const state = emptyState(); const group = addQuestion(state, viewer, 'Where do you live?');
  group.status = 'written'; group.answer = 'I live in Argentina.';
  const sent: { text: string; parent: string }[] = [];
  const replies = new ApprovedReplies(() => state, async (text, parent) => { sent.push({ text, parent }); }, () => true, () => {});
  return { state, group, sent, replies };
}

test('Approved answers mention the viewer and reply to the exact incoming chat message', async () => {
  const { group, sent, replies } = fixture();
  assert.equal(replies.enqueue(group, viewer, 'incoming-message', 1000), true);
  await replies.flush(1000);
  assert.deepEqual(sent, [{ text: '@viewer I live in Argentina.', parent: 'incoming-message' }]);
});

test('Pending questions, live-only answers, and messages without Twitch IDs are never posted', async () => {
  const { group, sent, replies } = fixture();
  group.status = 'pending'; assert.equal(replies.enqueue(group, viewer, 'one'), false);
  group.status = 'live'; group.answer = ''; assert.equal(replies.enqueue(group, viewer, 'two'), false);
  group.status = 'written'; group.answer = 'Approved'; assert.equal(replies.enqueue(group, viewer), false);
  await replies.flush(); assert.equal(sent.length, 0);
});

test('Duplicate users are suppressed for sixty seconds, including across queue recreation', async () => {
  const { state, group, replies, sent } = fixture();
  replies.enqueue(group, viewer, 'one', 1000); await replies.flush(1000);
  assert.equal(replies.enqueue(group, { ...viewer, name: 'Renamed' }, 'two', 2000), false);
  const restarted = new ApprovedReplies(() => state, async () => {}, () => true, () => {});
  assert.equal(restarted.enqueue(group, viewer, 'three', 2000), false);
  assert.equal(replies.enqueue(group, { id: 'other', name: 'Other' }, 'four', 2000), true);
  await replies.flush(2000); assert.equal(sent.length, 2);
  assert.equal(replies.enqueue(group, viewer, 'five', 62000), true);
});

test('Long answers preserve approved wording and fit Twitch message limits', () => {
  const answer = 'Approved text 💚 '.repeat(100).trim();
  const parts = approvedReplyParts(viewer, answer);
  assert.ok(parts.length > 1); assert.ok(parts.every(part => Array.from(part).length <= 500));
  assert.equal(parts.map(part => part.slice('@viewer '.length)).join(''), answer);
});

test('Reopening, editing, or clearing a group invalidates queued replies', async () => {
  for (const change of ['reopen', 'edit', 'clear']) {
    const { state, group, replies, sent } = fixture(); replies.enqueue(group, viewer, 'one');
    if (change === 'reopen') group.status = 'pending';
    if (change === 'edit') group.answer = 'A corrected answer';
    if (change === 'clear') state.groups = [];
    await replies.flush(); assert.equal(sent.length, 0);
  }
});

test('Disconnected replies wait and failed sends are reported without automatic duplicate retries', async () => {
  const { state, group } = fixture(); let ready = false, calls = 0;
  const queue = new ApprovedReplies(() => state, async () => { calls++; throw new Error('Held'); }, () => ready, () => {});
  queue.enqueue(group, viewer, 'one'); await queue.flush(); assert.equal(calls, 0);
  ready = true; await queue.flush(); await queue.flush(); assert.equal(calls, 1); assert.match(queue.status, /failed/);
});

test('Twitch chat API uses broadcaster identity and recognizes dropped messages', async () => {
  const originalFetch = globalThis.fetch; let dropped = false;
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), 'https://api.twitch.tv/helix/chat/messages');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, { broadcaster_id: 'owner', sender_id: 'owner', message: '@viewer Approved answer', reply_parent_message_id: 'parent' });
    return new Response(JSON.stringify({ data: [{ is_sent: !dropped }] }));
  }) as typeof fetch;
  try {
    const client = new TwitchConnection({ access_token: 'test', refresh_token: 'test', expires_in: 3600, scope: ['user:write:chat'] }, 'owner', () => {});
    client.status = 'Connected'; await client.sendChatMessage('@viewer Approved answer', 'parent');
    dropped = true; await assert.rejects(client.sendChatMessage('@viewer Approved answer', 'parent'), /did not send/);
    const readOnly = new TwitchConnection({ access_token: 'test', refresh_token: 'test', expires_in: 3600 }, 'owner', () => {});
    readOnly.status = 'Connected'; await assert.rejects(readOnly.sendChatMessage('@viewer Approved answer', 'parent'), /write permission/);
  } finally { globalThis.fetch = originalFetch; }
});
