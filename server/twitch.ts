import WebSocket from 'ws';
import type { User } from './domain.js';
import { timedFetch } from './http.js';
export type Credentials = {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
    scope?: string[];
};
export class TwitchConnection {
    status = 'Disconnected';
    private socket?: WebSocket;
    private sockets = new Set<WebSocket>();
    private stopped = false;
    private retry?: ReturnType<typeof setTimeout>;
    private validation?: ReturnType<typeof setInterval>;
    private seen = new Set<string>();
    private expires: number;
    private refreshing?: Promise<string>;
    private validating = false;
    constructor(private credentials: Credentials, private broadcaster: string, private onMessage: (user: User, text: string, messageId?: string) => void, private endpoint = 'wss://eventsub.wss.twitch.tv/ws', private save: (credentials: Credentials | null) => void = () => { }) { this.expires = credentials.expires_at || Date.now() + credentials.expires_in * 1000; }
    get canWriteChat() { return this.credentials.scope?.includes('user:write:chat') === true; }
    async sendChatMessage(message: string, parentId: string) {
        if (!this.canWriteChat || this.status !== 'Connected')
            throw new Error('Reconnect Twitch with chat write permission.');
        const response = await timedFetch('https://api.twitch.tv/helix/chat/messages', { method: 'POST', headers: { Authorization: `Bearer ${await this.token()}`, 'Client-Id': process.env.TWITCH_CLIENT_ID!, 'Content-Type': 'application/json' }, body: JSON.stringify({ broadcaster_id: this.broadcaster, sender_id: this.broadcaster, message, reply_parent_message_id: parentId }) });
        if(response.status===401||response.status===403){this.stop();this.save(null);this.status='Authorization expired. Connect again.';}
        if (!response.ok)
            throw new Error('Twitch rejected the chat reply.');
        const result = await response.json() as {
            data?: {
                is_sent: boolean;
            }[];
        };
        if (!result.data?.[0]?.is_sent)
            throw new Error('Twitch did not send the chat reply.');
    }
    async token(): Promise<string> {
        if (Date.now() <= this.expires - 60000)
            return this.credentials.access_token;
        if (this.refreshing)
            return this.refreshing;
        this.refreshing = (async () => {
            const response = await timedFetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.credentials.refresh_token, client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET! }) });
            if (!response.ok)
                throw new Error('Twitch authorization expired. Connect again.');
            this.credentials = { ...this.credentials, ...await response.json() as Credentials };
            this.expires = Date.now() + this.credentials.expires_in * 1000;
            this.save({ ...this.credentials, expires_at: this.expires });
            return this.credentials.access_token;
        })();
        try {
            return await this.refreshing;
        }
        finally {
            this.refreshing = undefined;
        }
    }
    async validate() {
        if (this.validating || this.stopped)
            return;
        this.validating = true;
        try {
            const response = await timedFetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${await this.token()}` } });
            if (!response.ok) {
                this.stop();
                this.save(null);
                this.status = 'Authorization expired. Connect again.';
                return;
            }
            const identity = await response.json() as {
                user_id: string;
                client_id: string;
                scopes: string[];
            };
            if (identity.user_id !== this.broadcaster || identity.client_id !== process.env.TWITCH_CLIENT_ID) {
                this.stop();
                this.save(null);
                this.status = 'Authorization identity mismatch. Connect again.';
            }
        }
        catch {
            this.status = 'Token validation failed — retrying';
        }
        finally {
            this.validating = false;
        }
    }
    async start(url = this.endpoint, migrating = false) {
        if (this.stopped)
            return;
        clearTimeout(this.retry);
        this.status = migrating ? 'Reconnecting' : 'Connecting';
        const old = this.socket, socket = new WebSocket(url, { handshakeTimeout: 10000 });
        this.socket = socket;
        this.sockets.add(socket);
        let heartbeat: ReturnType<typeof setTimeout>;
        let keepalive = 10000;
        const watchdog = () => { clearTimeout(heartbeat); heartbeat = setTimeout(() => socket.terminate(), keepalive + 2000); };
        watchdog();
        socket.on('message', async (raw) => {
            if (this.stopped)
                return;
            try {
                const data = JSON.parse(raw.toString());
                watchdog();
                if (data.metadata.message_type === 'session_welcome') {
                    keepalive = Math.max(1000, Number(data.payload.session.keepalive_timeout_seconds || 10) * 1000);
                    watchdog();
                    if (!migrating) {
                        const response = await timedFetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { Authorization: `Bearer ${await this.token()}`, 'Client-Id': process.env.TWITCH_CLIENT_ID!, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.broadcaster, user_id: this.broadcaster }, transport: { method: 'websocket', session_id: data.payload.session.id } }) });
                        if(response.status===401||response.status===403){this.stop();this.save(null);this.status='Chat permission expired. Connect again.';return;}
                        if (!response.ok)
                            throw new Error('Chat subscription failed. Check Twitch permissions.');
                    }
                    if (this.stopped || socket !== this.socket)
                        return;
                    this.status = 'Connected';
                    if (migrating)
                        old?.close();
                }
                if (data.metadata.message_type === 'session_reconnect' && socket === this.socket) {
                    const next = new URL(data.payload.session.reconnect_url), expected = new URL(this.endpoint);
                    if (next.protocol !== expected.protocol || next.hostname !== expected.hostname)
                        throw new Error('Invalid reconnect address.');
                    void this.start(next.toString(), true);
                }
                if (data.metadata.message_type === 'revocation') {
                    this.stop();
                    this.save(null);
                    this.status = 'Authorization revoked. Connect again.';
                }
                if (data.metadata.message_type === 'notification' && !this.seen.has(data.metadata.message_id)) {
                    this.seen.add(data.metadata.message_id);
                    if (this.seen.size > 5000)
                        this.seen.delete(this.seen.values().next().value!);
                    const event = data.payload.event;
                    if (event.reply && event.chatter_user_id === this.broadcaster)
                        return;
                    this.onMessage({ id: event.chatter_user_id, name: event.chatter_user_name, ...(event.chatter_user_login ? { login: event.chatter_user_login } : {}) }, event.message.text, event.message_id);
                }
            }
            catch {
                if (!this.stopped) {
                    this.status = 'Twitch event processing failed — reconnecting';
                    socket.terminate();
                }
            }
        });
        socket.on('error', () => { if (socket === this.socket && !this.stopped)
            this.status = 'Connection error'; });
        socket.on('close', () => {
            clearTimeout(heartbeat);
            this.sockets.delete(socket);
            if (this.stopped || socket !== this.socket)
                return;
            // A failed migration must close the orphaned old connection before a fresh subscription.
            for (const other of this.sockets)
                other.terminate();
            this.status = 'Reconnecting';
            this.retry = setTimeout(() => void this.start(), 5000);
        });
        if (!this.validation)
            this.validation = setInterval(() => void this.validate(), 60 * 60 * 1000);
    }
    stop() { this.stopped = true; clearTimeout(this.retry); clearInterval(this.validation); for (const socket of this.sockets)
        socket.close(); this.status = 'Disconnected'; }
}
