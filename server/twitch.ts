import WebSocket from 'ws';
import type { User } from './domain.ts';
export type Credentials = { access_token: string; refresh_token: string; expires_in: number };
export class TwitchConnection {
  status = 'Disconnected';
  private socket?: WebSocket;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private validation?: ReturnType<typeof setInterval>;
  private seen = new Set<string>();
  private expires = 0;
  constructor(private credentials: Credentials, private broadcaster: string, private onMessage: (user: User, text: string) => void, private endpoint = 'wss://eventsub.wss.twitch.tv/ws') {
    this.expires = Date.now() + credentials.expires_in * 1000;
  }
  async token() {
    if (Date.now() > this.expires - 60000) {
      const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.credentials.refresh_token, client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET! }) });
      if (!response.ok) throw new Error('Twitch authorization expired. Connect again.');
      this.credentials = await response.json() as Credentials; this.expires = Date.now() + this.credentials.expires_in * 1000;
    }
    return this.credentials.access_token;
  }
  async start(url = this.endpoint, migrating = false) {
    if (this.stopped) return;
    this.status = migrating ? 'Reconnecting' : 'Connecting';
    const old = this.socket;
    const socket = new WebSocket(url); this.socket = socket;
    const watchdog = () => { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => socket.terminate(), 45000); };
    socket.on('message', async raw => {
      try {
        const data = JSON.parse(raw.toString()); watchdog();
        if (data.metadata.message_type === 'session_welcome') {
          if (!migrating) {
            const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { Authorization: `Bearer ${await this.token()}`, 'Client-Id': process.env.TWITCH_CLIENT_ID!, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.broadcaster, user_id: this.broadcaster }, transport: { method: 'websocket', session_id: data.payload.session.id } }) });
            if (!response.ok) throw new Error('Chat subscription failed. Check Twitch permissions.');
          }
          this.status = 'Connected'; if (migrating) old?.close();
        }
        if (data.metadata.message_type === 'session_reconnect') {
          const next = new URL(data.payload.session.reconnect_url);
          if (next.protocol !== 'wss:' || next.hostname !== 'eventsub.wss.twitch.tv') throw new Error('Invalid reconnect address.');
          void this.start(next.toString(), true);
        }
        if (data.metadata.message_type === 'revocation') { this.stop(); this.status = 'Authorization revoked. Connect again.'; }
        if (data.metadata.message_type === 'notification' && !this.seen.has(data.metadata.message_id)) {
          this.seen.add(data.metadata.message_id); if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value!);
          const event = data.payload.event;
          this.onMessage({ id: event.chatter_user_id, name: event.chatter_user_name }, event.message.text);
        }
      } catch (error) { this.status = error instanceof Error ? error.message : 'Twitch connection error'; }
    });
    socket.on('error', () => { this.status = 'Connection error'; });
    socket.on('close', () => {
      if (this.stopped || socket !== this.socket) return;
      if (this.timer) clearTimeout(this.timer);
      this.status = 'Reconnecting'; this.timer = setTimeout(() => void this.start(), 5000);
    });
    if (!this.validation) this.validation = setInterval(async () => {
      try {
        const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${await this.token()}` } });
        if (!response.ok) { this.stop(); this.status = 'Authorization expired. Connect again.'; }
      } catch { this.status = 'Token validation failed'; }
    }, 60 * 60 * 1000);
  }
  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.validation); this.socket?.close(); this.status = 'Disconnected'; }
}
