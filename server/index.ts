import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { addQuestion, demoState, emptyState, merge, split, spin, support, type State, type User } from './domain.ts';
import { groupBatch } from './ai.ts';
import { archiveSession, clearCollection } from './reset.ts';
import { TwitchConnection, type Credentials } from './twitch.ts';
declare module 'express-session' { interface SessionData { user: User; demo: boolean; demoController: boolean; oauth: { state: string; role: string; at: number } } }
const app = express();
const origin = process.env.APP_URL || 'http://localhost:3000';
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production.');
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));
app.use(session({ secret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'), resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https:'), maxAge: 86400000 } }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.headers.origin !== origin) return res.status(403).json({ error: 'Request origin rejected.' });
  next();
});
const file = resolve(process.env.DATA_FILE || 'data/state.json');
let real: State = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : emptyState();
let demo = demoState();
const obsTokens = { real: randomBytes(32).toString('hex'), demo: randomBytes(32).toString('hex') };
const persist = () => { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file + '.tmp', JSON.stringify(real), { mode: 0o600 }); renameSync(file + '.tmp', file); };
let twitch: TwitchConnection | undefined;
let aiStatus = process.env.OPENAI_API_KEY ? 'Ready' : 'Not configured — exact duplicates only';
let queued: string[] = []; let grouping = false;
const scheduled = new Set<string>();
const enqueue = (id: string) => { if (!scheduled.has(id) && queued.length < 100) { scheduled.add(id); queued.push(id); } };
const locked = (s: State) => !!s.spin && s.spin.end > Date.now();
setInterval(async () => {
  if (grouping || locked(real) || !queued.length || !process.env.OPENAI_API_KEY) return;
  grouping = true; const ids = queued.splice(0, 5);
  try { await groupBatch(real, ids); aiStatus = 'Ready'; persist(); } catch { aiStatus = 'Grouping failed — questions preserved separately'; } finally { grouping = false; }
}, 2500);
function ingest(user: User, text: string) {
  if (text.startsWith('!ask ')) { const body = text.slice(5).trim(); if (body && body.length <= 500) { const g = addQuestion(real, user, body); if (g.questions.length === 1) enqueue(g.id); persist(); } }
  if (text.trim() === '!join' && real.registration && !real.participants.some(p => p.id === user.id)) { real.participants.push({ ...user, selected: false }); persist(); }
  if (text.trim() === '!leave') { real.participants = real.participants.filter(p => p.id !== user.id); persist(); }
}
const isController = (req: express.Request) => !!req.session.user && (req.session.demo ? req.session.demoController === true : req.session.user.id === process.env.TWITCH_BROADCASTER_ID || (process.env.MODERATOR_IDS || '').split(',').includes(req.session.user.id));
const stateFor = (req: express.Request) => req.session.demo ? demo : real;
app.get('/api/session', (req, res) => res.json({ user: req.session.user || null, controller: isController(req), demo: !!req.session.demo, demoEnabled: process.env.ENABLE_DEMO !== 'false' && !production, configured: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET && process.env.TWITCH_BROADCASTER_ID), ai: aiStatus, connection: twitch?.status || 'Disconnected' }));
app.post('/api/demo', (req, res) => { if (production || process.env.ENABLE_DEMO === 'false') return res.sendStatus(404); req.session.regenerate(error => { if (error) return res.sendStatus(500); req.session.user = req.body.role === 'viewer' ? { id: 'demo-' + randomBytes(12).toString('hex'), name: 'Demo viewer' } : { id: 'demo-creator', name: 'Demo creator' }; req.session.demo = true; req.session.demoController = req.body.role !== 'viewer'; res.json({ ok: true }); }); });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.clearCookie('connect.sid').json({ ok: true })));
app.get('/auth/twitch', (req, res) => {
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET || !process.env.TWITCH_BROADCASTER_ID) return res.status(503).send('Twitch is not configured. Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and TWITCH_BROADCASTER_ID in .env.');
  const role = req.query.role === 'streamer' ? 'streamer' : 'viewer';
  const state = randomBytes(32).toString('hex'); req.session.oauth = { state, role, at: Date.now() };
  const url = new URL('https://id.twitch.tv/oauth2/authorize'); url.search = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, redirect_uri: origin + '/auth/callback', response_type: 'code', scope: role === 'streamer' ? 'user:read:chat' : '', state }).toString();
  res.redirect(url.toString());
});
app.get('/auth/callback', async (req, res, next) => {
  try {
    const oauth = req.session.oauth; delete req.session.oauth;
    const state = String(req.query.state || '');
    if (!oauth || state.length !== oauth.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(oauth.state)) || Date.now() - oauth.at > 600000 || typeof req.query.code !== 'string') return res.status(400).send('Invalid or expired authorization. Try connecting again.');
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET!, code: req.query.code, grant_type: 'authorization_code', redirect_uri: origin + '/auth/callback' }) });
    if (!tokenResponse.ok) throw new Error('Twitch authorization failed.');
    const credentials = await tokenResponse.json() as Credentials;
    const validation = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${credentials.access_token}` } });
    if (!validation.ok) throw new Error('Twitch token validation failed.');
    const identity = await validation.json() as { user_id: string; login: string; client_id: string; scopes: string[] };
    if (identity.client_id !== process.env.TWITCH_CLIENT_ID) throw new Error('Twitch client mismatch.');
    if (oauth.role === 'streamer' && (identity.user_id !== process.env.TWITCH_BROADCASTER_ID || !identity.scopes.includes('user:read:chat'))) return res.status(403).send('Connect with the configured broadcaster account.');
    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.user = { id: identity.user_id, name: identity.login }; req.session.demo = false;
    if (oauth.role === 'streamer') { twitch?.stop(); twitch = new TwitchConnection(credentials, identity.user_id, ingest); void twitch.start(); }
    res.redirect(oauth.role === 'streamer' ? '/' : '/viewer');
  } catch (error) { next(error); }
});
app.use('/api', (req, res, next) => {
  if (req.path === '/overlay' && req.method === 'GET') return next();
  if (!req.session.user) return res.status(401).json({ error: 'Sign in with Twitch or enter the local demo.' });
  next();
});
app.get('/api/state', (req, res) => {
  const s = stateFor(req), controller = isController(req), id = req.session.user!.id;
  res.json({ ...s, groups: s.groups.map(g => ({ ...g, supporters: undefined, count: support(g), questions: controller ? g.questions : g.questions.filter(q => q.user.id === id), review: controller ? g.review : undefined, answer: g.status === 'written' && (controller || g.questions.some(q => q.user.id === id)) ? g.answer : '' })), participants: controller ? s.participants : s.participants.filter(p => p.id === id), obsUrl: controller ? `${origin}/obs?token=${req.session.demo ? obsTokens.demo : obsTokens.real}` : undefined, serverTime: Date.now() });
});
app.get('/api/overlay', (req, res) => {
  const token = req.query.token;
  const s = token === obsTokens.demo ? demo : token === obsTokens.real ? real : undefined;
  if (!s) return res.status(403).json({ error: 'Open the OBS link from the streamer dashboard.' });
  res.json({ spin: s.spin, demo: s.demo, mode: s.mode, serverTime: Date.now() });
});
const rates = new Map<string, number[]>();
app.post('/api/action', (req, res) => {
  const action = z.object({ type: z.string().max(30), id: z.string().max(100).optional(), target: z.string().max(100).optional(), text: z.string().max(2000).optional(), title: z.string().max(60).optional(), value: z.union([z.boolean(), z.string().max(30)]).optional(), confirmed: z.boolean().optional() }).parse(req.body);
  const s = stateFor(req), user = req.session.user!;
  const publicActions = ['ask', 'support', 'join', 'leave'];
  if (!publicActions.includes(action.type) && !isController(req)) return res.status(403).json({ error: 'Streamer or authorized moderator access required.' });
  const recent = (rates.get(user.id) || []).filter(t => t > Date.now() - 60000); if (recent.length >= 30) return res.status(429).json({ error: 'Please wait before sending more actions.' }); recent.push(Date.now()); rates.set(user.id, recent);
  if (locked(s) && !publicActions.includes(action.type)) return res.status(409).json({ error: 'Wait for the current spin to finish.' });
  if (grouping && !req.session.demo && ['merge', 'split', 'answer', 'live', 'reopen', 'spin', 'edit', 'clear-questions'].includes(action.type)) return res.status(409).json({ error: 'Grouping is in progress. Please try again shortly.' });
  const group = s.groups.find(g => g.id === action.id);
  switch (action.type) {
    case 'ask': { const text = z.string().trim().min(3).max(500).parse(action.text); const g = addQuestion(s, user, text); if (!s.demo && g.questions.length === 1) enqueue(g.id); break; }
    case 'support': if (!group || group.status !== 'pending') throw new Error('Choose a pending question.'); if (!group.supporters.includes(user.id)) group.supporters.push(user.id); break;
    case 'join': if (!s.registration) throw new Error('Registration is closed.'); if (!s.participants.some(p => p.id === user.id)) s.participants.push({ ...user, selected: false }); break;
    case 'leave': s.participants = s.participants.filter(p => p.id !== user.id); break;
    case 'settings': if (['questions', 'participants'].includes(String(action.value))) s.mode = action.value as State['mode']; else if (['equal', 'support', 'manual'].includes(String(action.value))) s.odds = action.value as State['odds']; else throw new Error('Invalid setting.'); break;
    case 'registration': s.registration = z.boolean().parse(action.value); break;
    case 'exclude': s.excludeSelected = z.boolean().parse(action.value); break;
    case 'spin': spin(s, action.id); break;
    case 'answer': if (!group) throw new Error('Question not found.'); group.answer = z.string().trim().min(1).max(2000).parse(action.text); group.status = 'written'; break;
    case 'live': if (!group) throw new Error('Question not found.'); group.status = 'live'; group.answer = ''; break;
    case 'reopen': if (!group) throw new Error('Question not found.'); group.status = 'pending'; group.answer = ''; break;
    case 'edit': if (!group) throw new Error('Question not found.'); group.title = z.string().trim().min(1).max(60).parse(action.title); break;
    case 'merge': merge(s, action.id!, action.target!, true); break;
    case 'split': split(s, action.id!, action.target!); break;
    case 'dismiss': if (group) delete group.review; break;
    case 'clear-questions':
    case 'clear-participants': {
      if (action.confirmed !== true) throw new Error('Confirm before clearing this collection.');
      const target = action.type === 'clear-questions' ? 'questions' : 'participants';
      clearCollection(s, target, () => { archiveSession(s, file); });
      if (!s.demo && target === 'questions') { queued = []; scheduled.clear(); }
      break;
    }
    case 'disconnect': if (user.id !== process.env.TWITCH_BROADCASTER_ID && !s.demo) return res.sendStatus(403); if (!s.demo) twitch?.stop(); break;
    default: throw new Error('Unknown action.');
  }
  if (!s.demo) persist(); res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
if (production) { app.use(express.static('dist')); app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html'))); }
else { const { createServer } = await import('vite'); const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error instanceof z.ZodError ? 'Please check the supplied values.' : error.message || 'Request failed.' }); });
app.listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => console.log(`ChatSpin is running at ${origin}`));
