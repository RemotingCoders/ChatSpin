import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SupabaseRepository } from './supabase.js';
import { timedFetch } from './http.js';
export const webhookSecret = (secret: string, channel: string) =>
  createHmac('sha256', secret)
    .update('chatspin.eventsub:' + channel)
    .digest('hex');
export function verifyWebhook(
  raw: Buffer,
  headers: Record<string, string | undefined>,
  secret: string,
  now = Date.now(),
) {
  const id = headers['twitch-eventsub-message-id'],
    timestamp = headers['twitch-eventsub-message-timestamp'],
    supplied = headers['twitch-eventsub-message-signature'];
  if (
    !id ||
    id.length > 256 ||
    !timestamp ||
    !supplied ||
    !Number.isFinite(Date.parse(timestamp)) ||
    Math.abs(now - Date.parse(timestamp)) > 600000
  )
    return false;
  const expected =
    'sha256=' + createHmac('sha256', secret).update(id).update(timestamp).update(raw).digest('hex');
  const a = Buffer.from(supplied),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function appToken() {
  const response = await timedFetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID!,
      client_secret: process.env.TWITCH_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) throw Error('Twitch application authorization failed.');
  return (await response.json()).access_token as string;
}
type ChatStatus = { status: string; reason?: string; checkedAt?: number };
const subscriptionEndpoint = 'https://api.twitch.tv/helix/eventsub/subscriptions';
const recoverable = new Set([
  'notification_failures_exceeded',
  'webhook_callback_verification_failed',
]);
const terminal = new Set([
  'authorization_revoked',
  'user_removed',
  'moderator_removed',
  'version_removed',
]);
const stopped = (status: ChatStatus | undefined) =>
  !status ||
  status.status === 'Disconnected' ||
  status.status.startsWith('Chat permission revoked') ||
  (!!status.reason && terminal.has(status.reason));
const headers = (token: string) => ({
  Authorization: 'Bearer ' + token,
  'Client-Id': process.env.TWITCH_CLIENT_ID!,
  'Content-Type': 'application/json',
});
async function createSubscription(channel: string, origin: string, secret: string, token: string) {
  return timedFetch(subscriptionEndpoint, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: channel, user_id: channel },
      transport: {
        method: 'webhook',
        callback: origin + '/api/twitch/events/' + channel,
        secret: webhookSecret(secret, channel),
      },
    }),
  });
}
export async function subscribeCloudChat(
  repository: SupabaseRepository,
  channel: string,
  origin: string,
  secret: string,
) {
  // An explicit OAuth reconnect authorizes replacing a previous revoked status.
  await repository.putSecret(channel, 'chat-status', {
    status: 'Awaiting webhook verification',
    checkedAt: Date.now(),
  });
  const before = await repository.secretRecord<ChatStatus>(channel, 'chat-status');
  const response = await createSubscription(channel, origin, secret, await appToken());
  if (!response.ok && response.status !== 409) {
    if (before)
      await repository.replaceSecret(channel, 'chat-status', before.version, {
        status: 'Chat subscription failed. Retrying automatically.',
        checkedAt: Date.now(),
      });
    throw Error('Twitch chat subscription failed.');
  }
  // A 409 only proves a subscription exists, not that it is enabled. Reconcile
  // it next; do not overwrite a challenge's Connected status or a disconnect.
  if (response.status === 409 && before)
    await repository.replaceSecret(channel, 'chat-status', before.version, {
      status: 'Checking existing chat subscription',
      checkedAt: 0,
    });
}
export async function reconcileCloudChat(
  repository: SupabaseRepository,
  channel: string,
  origin: string,
  secret: string,
  now = Date.now(),
) {
  if (await repository.getSecret(channel, 'eventsub-cleanup')) {
    await unsubscribeCloudChat(repository, channel, origin);
    return;
  }
  const current = await repository.secretRecord<ChatStatus>(channel, 'chat-status');
  if (
    !current ||
    stopped(current.value) ||
    (current.value.checkedAt && current.value.checkedAt > now - 300000)
  )
    return;
  if (!(await repository.getSecret(channel, 'twitch'))) return;
  // CAS throttles across instances and cannot overwrite a concurrent disconnect.
  let version = await repository.replaceSecret(channel, 'chat-status', current.version, {
    ...current.value,
    checkedAt: now,
  });
  if (!version) return;
  const update = async (value: ChatStatus) => {
    const next = await repository.replaceSecret(channel, 'chat-status', version!, {
      ...value,
      checkedAt: now,
    });
    if (next) version = next;
  };
  const stillActive = async () => {
    const row = await repository.secretRecord<ChatStatus>(channel, 'chat-status');
    return (
      !!row &&
      row.version === version &&
      !stopped(row.value) &&
      !!(await repository.getSecret(channel, 'twitch'))
    );
  };
  try {
    const token = await appToken();
    type Subscription = {
      id: string;
      type: string;
      status: string;
      condition?: { broadcaster_user_id?: string; user_id?: string };
      transport?: { method?: string; callback?: string };
    };
    const rows: Subscription[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = new URL(subscriptionEndpoint);
      url.searchParams.set('user_id', channel);
      url.searchParams.set('first', '100');
      if (cursor) url.searchParams.set('after', cursor);
      const response = await timedFetch(url, { headers: headers(token) });
      if (!response.ok) throw Error('Subscription lookup failed');
      const body = (await response.json()) as {
        data: Subscription[];
        pagination?: { cursor?: string };
      };
      if (!Array.isArray(body.data)) throw Error('Invalid subscription list');
      rows.push(...body.data);
      cursor = body.pagination?.cursor;
      if (!cursor) break;
    }
    if (cursor) throw Error('Subscription lookup incomplete');
    if (!(await stillActive())) return;
    const owned = rows.filter(
      (r) =>
        r.type === 'channel.chat.message' &&
        r.condition?.broadcaster_user_id === channel &&
        r.condition?.user_id === channel &&
        r.transport?.method === 'webhook' &&
        r.transport.callback === origin + '/api/twitch/events/' + channel,
    );
    if (owned.some((r) => r.status === 'enabled')) {
      await update({ status: 'Connected' });
      return;
    }
    const revoked = owned.find((r) => terminal.has(r.status));
    if (revoked) {
      await update({ status: 'Chat permission revoked. Connect again.', reason: revoked.status });
      return;
    }
    if (owned.some((r) => r.status === 'webhook_callback_verification_pending')) {
      await update({ status: 'Awaiting webhook verification' });
      return;
    }
    if (owned.some((r) => !recoverable.has(r.status))) {
      await update({ status: 'Chat subscription requires operator review.' });
      return;
    }
    for (const row of owned) {
      if (!(await stillActive())) return;
      const response = await timedFetch(
        subscriptionEndpoint + '?id=' + encodeURIComponent(row.id),
        { method: 'DELETE', headers: headers(token) },
      );
      if (!response.ok && response.status !== 404) throw Error('Subscription cleanup failed');
    }
    if (!(await stillActive())) return;
    await update({ status: 'Awaiting webhook verification' });
    if (!(await stillActive())) return;
    const response = await createSubscription(channel, origin, secret, token);
    if (!response.ok && response.status !== 409) throw Error('Subscription recovery failed');
  } catch {
    await update({ status: 'Chat subscription check failed. Retrying automatically.' });
  }
}
export function cloudWebhooks(
  repository: SupabaseRepository,
  secret: string,
  schedule: (channel: string) => void,
) {
  const router = express.Router();
  router.post(
    '/api/twitch/events/:channel',
    express.raw({ type: 'application/json', limit: '64kb' }),
    async (req, res) => {
      const channel = String(req.params.channel);
      if (!/^\d{1,30}$/.test(channel) || !Buffer.isBuffer(req.body)) return res.sendStatus(400);
      const headers = Object.fromEntries(
        [
          'twitch-eventsub-message-id',
          'twitch-eventsub-message-timestamp',
          'twitch-eventsub-message-signature',
        ].map((key) => [key, req.get(key)]),
      );
      if (!verifyWebhook(req.body, headers, webhookSecret(secret, channel)))
        return res.sendStatus(403);
      let body;
      try {
        body = JSON.parse(req.body.toString());
      } catch {
        return res.sendStatus(400);
      }
      if (
        body.subscription?.type !== 'channel.chat.message' ||
        body.subscription?.condition?.broadcaster_user_id !== channel
      )
        return res.sendStatus(403);
      const type = req.get('twitch-eventsub-message-type');
      if (type === 'webhook_callback_verification') {
        if (typeof body.challenge !== 'string') return res.sendStatus(400);
        const current = await repository.secretRecord<ChatStatus>(channel, 'chat-status');
        if (current && !stopped(current.value) && (await repository.getSecret(channel, 'twitch')))
          await repository.replaceSecret(channel, 'chat-status', current.version, {
            status: 'Connected',
            checkedAt: Date.now(),
          });
        return res.type('text/plain').send(body.challenge);
      }
      if (type === 'revocation') {
        const current = await repository.secretRecord<ChatStatus>(channel, 'chat-status'),
          reason = String(body.subscription.status || 'authorization_revoked');
        if (current && !stopped(current.value)) {
          const retry = recoverable.has(reason),
            changed = await repository.replaceSecret(channel, 'chat-status', current.version, {
              status: retry
                ? 'Chat delivery interrupted. Retrying automatically.'
                : 'Chat permission revoked. Connect again.',
              reason,
              checkedAt: retry ? 0 : Date.now(),
            });
          if (changed && retry) schedule(channel);
        }
        return res.sendStatus(204);
      }
      if (type !== 'notification') return res.sendStatus(400);
      const chatStatus = await repository.getSecret<{ status: string }>(channel, 'chat-status');
      if (chatStatus?.status !== 'Connected') return res.sendStatus(204);
      const event = body.event;
      if (
        event?.broadcaster_user_id !== channel ||
        typeof event.chatter_user_id !== 'string' ||
        !/^\d+$/.test(event.chatter_user_id) ||
        typeof event.message?.text !== 'string' ||
        typeof event.message_id !== 'string'
      )
        return res.sendStatus(400);
      if (event.reply && event.chatter_user_id === channel) return res.sendStatus(204);
      // Durable inbox is independent of the channel's AI lease, so chat delivery never waits for a model call.
      await repository.putSecret(channel, 'inbox:' + event.message_id, {
        user: {
          id: event.chatter_user_id,
          name: String(event.chatter_user_name || event.chatter_user_id),
          login: String(event.chatter_user_login || ''),
        },
        text: event.message.text,
        messageId: event.message_id,
        at: Date.now(),
      });
      schedule(channel);
      res.sendStatus(204);
    },
  );
  return router;
}

/** Delete only this channel's webhook at our callback, never another app endpoint. */
export async function unsubscribeCloudChat(
  repository: SupabaseRepository,
  channel: string,
  origin: string,
) {
  try {
    const token = await appToken();
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const url = new URL(subscriptionEndpoint);
      url.searchParams.set('user_id', channel);
      url.searchParams.set('first', '100');
      if (cursor) url.searchParams.set('after', cursor);
      const response = await timedFetch(url, { headers: headers(token) });
      if (!response.ok) throw Error('Subscription lookup failed');
      const body = await response.json();
      for (const row of body.data || [])
        if (
          row.type === 'channel.chat.message' &&
          row.condition?.broadcaster_user_id === channel &&
          row.condition?.user_id === channel &&
          row.transport?.method === 'webhook' &&
          row.transport.callback === origin + '/api/twitch/events/' + channel
        )
          ids.push(row.id);
      cursor = body.pagination?.cursor;
    } while (cursor);
    for (const id of ids) {
      if (await repository.getSecret(channel, 'twitch')) break;
      const response = await timedFetch(subscriptionEndpoint + '?id=' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: headers(token),
      });
      if (!response.ok && response.status !== 404) throw Error('Subscription deletion failed');
    }
    await repository.removeSecret(channel, 'eventsub-cleanup');
  } catch {
    await repository.putSecret(channel, 'eventsub-cleanup', { origin });
    throw Object.assign(
      Error('Disconnected. Twitch subscription cleanup is pending; it will be retried.'),
      { status: 503 },
    );
  }
}
