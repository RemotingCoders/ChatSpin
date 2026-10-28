import 'dotenv/config';
import { settings, retain, bindBudget } from './limits.ts';
import {questionPresentation,presentedSpin} from './presentation.ts';
import {TranslationWork} from './translation.ts';
import { Repository, PersistentSessions } from './storage.ts';
import { timedFetch } from './http.ts';
import express from 'express';
import session from 'express-session';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { addQuestion, demoState, emptyState, merge, split, spin, support, eligibleEntries, type State, type User, rememberAnswer, answerIsActive } from './domain.ts';
import { QuestionWork } from './work.ts';
import { groupBatch, detectQuestions } from './ai.ts';
import { extractChatQuestion } from './chat.ts';
import { ApprovedReplies } from './replies.ts';
import { archiveSession, clearCollection } from './reset.ts';
import { TwitchConnection, type Credentials } from './twitch.ts';
declare module 'express-session' {
    interface SessionData {
        user: User;
        demo: boolean;
        demoController: boolean;
        oauth: {
            state: string;
            role: string;
            at: number;
        };
    }
}
const origin = process.env.APP_URL || 'http://localhost:3000';
const production = process.env.NODE_ENV === 'production';
if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET === 'replace-with-a-long-random-secret'))
    throw new Error('A strong SESSION_SECRET of at least 32 characters is required in production.');
process.umask(0o077);
const file = resolve(process.env.DATA_FILE || 'data/state.json');
const repository = new Repository(file, process.env.SESSION_SECRET);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
app.use(express.json({ limit: '8kb' }));
app.use(session({ secret: repository.secret, store: new PersistentSessions(repository), resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https:'), maxAge: 86400000 } }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.headers.origin !== origin)
        return res.status(403).json({ error: 'Request origin rejected.' });
    next();
});
let real: State = repository.load();
real.liveSession ||= randomBytes(12).toString('hex');
for (const group of real.groups)
    if (group.status === 'written' && !group.answerSession && group.answerScope !== 'permanent')
        group.answerSession = real.liveSession;
let demo = demoState();
let obsTokens = repository.getSecret<{
    real: string;
    demo: string;
}>('obs') || { real: randomBytes(32).toString('hex'), demo: randomBytes(32).toString('hex') };
repository.putSecret('obs', obsTokens);
const persist = () => repository.save(real);
bindBudget(real, persist);
let twitch: TwitchConnection | undefined;
const replies = new ApprovedReplies(() => real, async (message, parentId) => {
    if (!twitch)
        throw new Error('Twitch is disconnected.');
    await twitch.sendChatMessage(message, parentId);
}, () => twitch?.status === 'Connected' && twitch.canWriteChat, persist);
setInterval(() => { void replies.flush().catch(() => { replies.status = 'Reply persistence failed — inspect storage'; }); }, 2000);
const work = new QuestionWork(real, persist, messages => detectQuestions(messages, real), ids => groupBatch(real, ids), (group, user, messageId) => { replies.enqueue(group, user, messageId); });
persist();
const translator=new TranslationWork(real,persist);
const enqueue = (id: string) => work.enqueue(id);
const locked = (s: State) => !!s.spin && s.spin.end > Date.now();
setInterval(() => {
    if (!locked(real) && !work.busy && !translator.busy && process.env.OPENAI_API_KEY)
        void (async()=>{await work.tick();await translator.tick();})().catch(()=>{work.status='Processing failed; retained for retry';});
}, 2500);
function ingest(user: User, text: string, messageId?: string) {
    if (messageId&&(process.env.OPENAI_API_KEY||extractChatQuestion(text)))
        work.ingest(user, text, messageId);
    if (text.trim() === '!join' && real.registration && !real.participants.some(p => p.id === user.id)) {
        real.participants.push({ ...user, selected: false });
        persist();
    }
    if (text.trim() === '!leave') {
        real.participants = real.participants.filter(p => p.id !== user.id);
        persist();
    }
}
const saveCredentials = (credentials: Credentials | null) => {
    if (credentials)
        repository.putSecret('twitch', credentials);
    else
        repository.removeSecret('twitch');
};
const storedCredentials = repository.getSecret<Credentials>('twitch');
if (storedCredentials && process.env.TWITCH_BROADCASTER_ID) {
    twitch = new TwitchConnection(storedCredentials, process.env.TWITCH_BROADCASTER_ID, ingest, undefined, saveCredentials);
    void twitch.validate().then(() => {
        if (twitch?.status === 'Disconnected')
            void twitch.start();
    });
}
const isController = (req: express.Request) => !!req.session.user && (req.session.demo ? req.session.demoController === true : req.session.user.id === process.env.TWITCH_BROADCASTER_ID || (process.env.MODERATOR_IDS || '').split(',').includes(req.session.user.id));
const stateFor = (req: express.Request) => req.session.demo ? demo : real;
app.get('/api/session', (req, res) => res.json({ user: req.session.user || null, controller: isController(req), demo: !!req.session.demo, demoEnabled: process.env.ENABLE_DEMO !== 'false' && !production, configured: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET && process.env.TWITCH_BROADCASTER_ID), uiLanguage:(req.session.demo?demo:real).uiLanguage||'en',storageNotice: repository.warning, ai: process.env.OPENAI_API_KEY ? work.status : 'Not configured — explicit questions only', chatReplies: twitch?.canWriteChat ? replies.status : 'Reconnect Twitch to enable public approved-answer replies', connection: twitch?.status || 'Disconnected' }));
app.post('/api/demo', (req, res) => {
    if (production || process.env.ENABLE_DEMO === 'false')
        return res.sendStatus(404);
    req.session.regenerate(error => {
        if (error)
            return res.sendStatus(500);
        req.session.user = req.body.role === 'viewer' ? { id: 'demo-' + randomBytes(12).toString('hex'), name: 'Demo viewer' } : { id: 'demo-creator', name: 'Demo creator' };
        req.session.demo = true;
        req.session.demoController = req.body.role !== 'viewer';
        res.json({ ok: true });
    });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.clearCookie('connect.sid').json({ ok: true })));
app.get('/auth/twitch', (req, res) => {
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET || !process.env.TWITCH_BROADCASTER_ID)
        return res.status(503).send('Twitch is not configured. Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and TWITCH_BROADCASTER_ID in .env.');
    const role = req.query.role === 'streamer' ? 'streamer' : 'viewer';
    const state = randomBytes(32).toString('hex');
    req.session.oauth = { state, role, at: Date.now() };
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, redirect_uri: origin + '/auth/callback', response_type: 'code', scope: role === 'streamer' ? 'user:read:chat user:write:chat' : '', state }).toString();
    res.redirect(url.toString());
});
app.get('/auth/callback', async (req, res, next) => {
    try {
        const oauth = req.session.oauth;
        delete req.session.oauth;
        const state = String(req.query.state || '');
        if (!oauth || state.length !== oauth.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(oauth.state)) || Date.now() - oauth.at > 600000 || typeof req.query.code !== 'string')
            return res.status(400).send('Invalid or expired authorization. Try connecting again.');
        const tokenResponse = await timedFetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET!, code: req.query.code, grant_type: 'authorization_code', redirect_uri: origin + '/auth/callback' }) });
        if (!tokenResponse.ok)
            throw new Error('Twitch authorization failed.');
        const credentials = await tokenResponse.json() as Credentials;
        const validation = await timedFetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${credentials.access_token}` } });
        if (!validation.ok)
            throw new Error('Twitch token validation failed.');
        const identity = await validation.json() as {
            user_id: string;
            login: string;
            client_id: string;
            scopes: string[];
        };
        if (identity.client_id !== process.env.TWITCH_CLIENT_ID)
            throw new Error('Twitch client mismatch.');
        if (oauth.role === 'streamer' && (identity.user_id !== process.env.TWITCH_BROADCASTER_ID || (!identity.scopes.includes('user:read:chat') || !identity.scopes.includes('user:write:chat'))))
            return res.status(403).send('Connect with the configured broadcaster account.');
        credentials.scope = identity.scopes;
        await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
        req.session.user = { id: identity.user_id, name: identity.login };
        req.session.demo = false;
        if (oauth.role === 'streamer') {
            saveCredentials({ ...credentials, expires_at: Date.now() + credentials.expires_in * 1000 });
            twitch?.stop();
            twitch = new TwitchConnection(credentials, identity.user_id, ingest, undefined, saveCredentials);
            void twitch.start();
        }
        res.redirect(oauth.role === 'streamer' ? '/' : '/viewer');
    }
    catch (error) {
        next(error);
    }
});
app.use('/api', (req, res, next) => {
    if (req.path === '/overlay' && req.method === 'GET')
        return next();
    if (!req.session.user)
        return res.status(401).json({ error: 'Sign in with Twitch or enter the local demo.' });
    next();
});
app.get('/api/state', (req, res) => {
    const s = stateFor(req), controller = isController(req), id = req.session.user!.id;
    res.json({ ...s,spin:presentedSpin(s),translationStatus:translator.status, replyHistory: undefined, replyJobs: undefined, replyLog: controller ? s.replyLog : undefined, aiJobs: undefined, pendingMessages: undefined, settings: controller ? settings(s) : undefined, aiBudget: controller ? s.aiBudget : undefined, entries: controller ? eligibleEntries(s) : undefined, groups: s.groups.map(g => ({ ...g, text:questionPresentation(s,g).text,title:questionPresentation(s,g).title,displayLanguage:s.questionLanguage||'original',originalText:g.text,originalTitle:g.customTitle||g.text,translationPending:questionPresentation(s,g).pending,translations:undefined,translationAttempts:undefined,supporters: undefined, answerHistory: controller ? g.answerHistory : undefined, embedding: undefined, aiProcessed: controller ? g.aiProcessed : undefined, answerActive: answerIsActive(s, g), count: support(g), questions: controller ? g.questions : g.questions.filter(q => q.user.id === id), review: controller ? g.review : undefined, answer: (controller || (answerIsActive(s, g) && g.questions.some(q => q.user.id === id))) ? g.answer : '' })), participants: controller ? s.participants : s.participants.filter(p => p.id === id), obsUrl: controller ? `${origin}/obs?token=${req.session.demo ? obsTokens.demo : obsTokens.real}` : undefined, serverTime: Date.now() });
});
app.get('/api/overlay', (req, res) => {
    const token = req.query.token;
    const s = token === obsTokens.demo ? demo : token === obsTokens.real ? real : undefined;
    if (!s)
        return res.status(403).json({ error: 'Open the OBS link from the streamer dashboard.' });
    res.json({ spin:presentedSpin(s),questionLanguage:s.questionLanguage||'original',uiLanguage:s.uiLanguage||'en',translationPending:s.groups.some(g=>questionPresentation(s,g).pending),entries: eligibleEntries(s), demo: s.demo, mode: s.mode, serverTime: Date.now() });
});
setInterval(() => { try {
    repository.cleanup();
    if (!work.busy && !translator.busy && !locked(real)) {
        repository.snapshot(real);
        if (retain(real))
            persist();
    }
}
catch {
    work.status = 'Maintenance failed — inspect storage before continuing';
} }, 3600000).unref();
const rates = new Map<string, number[]>();
app.post('/api/action', (req, res) => {
    const action = z.object({ type: z.string().max(30), id: z.string().max(100).optional(), target: z.string().max(100).optional(), text: z.string().max(2000).optional(), title: z.string().max(60).optional(), value: z.union([z.boolean(), z.string().max(30)]).optional(), confirmed: z.boolean().optional() }).parse(req.body);
    const s = stateFor(req), user = req.session.user!;
    const publicActions = ['ask', 'support', 'join', 'leave'];
    if (!publicActions.includes(action.type) && !isController(req))
        return res.status(403).json({ error: 'Streamer or authorized moderator access required.' });
    for (const [key, times] of rates)
        if (!times.some(t => t > Date.now() - 60000))
            rates.delete(key);
    const recent = (rates.get(user.id) || []).filter(t => t > Date.now() - 60000);
    if (recent.length >= 30)
        return res.status(429).json({ error: 'Please wait before sending more actions.' });
    recent.push(Date.now());
    rates.set(user.id, recent);
    if (locked(s) && !publicActions.includes(action.type) && action.type!=='ui-language')
        return res.status(409).json({ error: 'Wait for the current spin to finish.' });
    if ((work.busy||translator.busy) && !req.session.demo && ['merge', 'split', 'answer', 'live', 'reopen', 'spin', 'edit', 'clear-questions', 'new-session', 'reprocess'].includes(action.type))
        return res.status(409).json({ error: 'Grouping is in progress. Please try again shortly.' });
    if(!s.demo&&replies.isSending&&['clear-questions','new-session'].includes(action.type))return res.status(409).json({error:'Wait for the current public reply to finish.'});
    const group = s.groups.find(g => g.id === action.id);
    switch (action.type) {
        case 'ask': {
            const text = z.string().trim().min(3).max(500).parse(action.text);
            const g = addQuestion(s, user, text);
            if (!s.demo && g.questions.length === 1)
                enqueue(g.id);
            break;
        }
        case 'support':
            if (!group || group.status !== 'pending')
                throw new Error('Choose a pending question.');
            if (!group.supporters.includes(user.id))
                group.supporters.push(user.id);
            break;
        case 'join':
            if (!s.registration)
                throw new Error('Registration is closed.');
            if (!s.participants.some(p => p.id === user.id))
                s.participants.push({ ...user, selected: false });
            break;
        case 'leave':
            s.participants = s.participants.filter(p => p.id !== user.id);
            break;
        case 'settings':
            if (['questions', 'participants'].includes(String(action.value)))
                s.mode = action.value as State['mode'];
            else if (['equal', 'support', 'manual'].includes(String(action.value)))
                s.odds = action.value as State['odds'];
            else
                throw new Error('Invalid setting.');
            break;
        case 'registration':
            s.registration = z.boolean().parse(action.value);
            break;
        case 'exclude':
            s.excludeSelected = z.boolean().parse(action.value);
            break;
        case 'spin':
            spin(s, action.id);
            break;
        case 'answer':
            if (!group)
                throw new Error('Question not found.');
            rememberAnswer(group);
            group.answer = z.string().trim().min(1).max(2000).parse(action.text);
            group.status = 'written';
            group.answerScope = action.value === 'permanent' ? 'permanent' : 'session';
            group.answerSession = s.liveSession;
            break;
        case 'live':
            if (!group)
                throw new Error('Question not found.');
            rememberAnswer(group);
            group.status = 'live';
            group.answer = '';
            break;
        case 'reopen':
            if (!group)
                throw new Error('Question not found.');
            rememberAnswer(group);
            group.status = 'pending';
            group.answer = '';
            group.aiProcessed = false;
            break;
        case 'edit': {
            if(!group)throw new Error('Question not found.');
            const language=s.questionLanguage||'original';
            if(action.value&&action.value!==language)throw new Error('Question language changed. Reopen the question before editing its title.');
            const title=z.string().trim().min(1).max(60).parse(action.title);
            if(language==='original'){group.title=title;group.customTitle=title;}
            else{const cached=group.translations?.[language];if(!cached||questionPresentation(s,group).pending)throw new Error('Wait for translation before editing this title.');cached.title=title;}
            break;
        }
        case 'merge': {
            const originals = s.groups.find(g => g.id === action.id)?.questions || [];
            merge(s, action.id!, action.target!, true, action.value === 'source' || action.value === 'target' ? action.value : undefined);
            if (!s.demo) {
                work.deliver();
                const target = s.groups.find(g => g.id === action.target);
                if (target)
                    for (const q of originals)
                        if (q.messageId && Date.now() - q.at <= 300000)
                            replies.enqueue(target, q.user, q.messageId);
            }
            break;
        }
        case 'split':
            split(s, action.id!, action.target!);
            break;
        case 'dismiss':
            if (group)
                delete group.review;
            break;
        case 'clear-questions':
        case 'clear-participants': {
            if (action.confirmed !== true)
                throw new Error('Confirm before clearing this collection.');
            const target = action.type === 'clear-questions' ? 'questions' : 'participants';
            clearCollection(s, target, () => {
                archiveSession(s, file);
                if (!s.demo)
                    repository.snapshot(real);
            });
            if (!s.demo && target === 'questions') {
                real.aiJobs = [];
                real.pendingMessages = [];
            }
            break;
        }
        case 'pause-replies':
            s.repliesPaused = z.boolean().parse(action.value);
            break;
        case 'limits':
            if ((work.busy||translator.busy) && !s.demo)
                throw new Error('Wait for AI processing before changing limits.');
            s.settings = z.object({ aiCallLimit: z.number().int().min(0).max(10000), aiTokenLimit: z.number().int().min(0).max(10000000), retentionDays: z.number().int().min(1).max(365), maxGroups: z.number().int().min(10).max(10000) }).parse(JSON.parse(action.text || '{}'));
            break;
        case 'new-session':
            if (action.confirmed !== true)
                throw new Error('Confirm starting a new live session.');
            if (!s.demo)
                repository.snapshot(real);
            s.liveSession = randomBytes(12).toString('hex');
            s.usage = { calls: 0, input: 0, output: 0 };
            s.aiBudget = { calls: 0, tokens: 0 };
            if (!s.demo)
                work.retry();
            break;
        case 'rotate-obs': {
            if (action.confirmed !== true)
                throw new Error('Confirm regenerating the OBS link.');
            obsTokens[s.demo ? 'demo' : 'real'] = randomBytes(32).toString('hex');
            repository.putSecret('obs', obsTokens);
            break;
        }
        case 'ui-language': s.uiLanguage=z.enum(['en','es','ru','de']).parse(action.value);break;
        case 'question-language': if(!s.demo&&!process.env.OPENAI_API_KEY&&action.value!=='original')throw new Error('Configure OpenAI to translate questions.');s.questionLanguage=z.enum(['original','en','es','ru','de']).parse(action.value);if(!s.demo)translator.retry();break;
        case 'reprocess':
            if(!s.demo){work.retry();translator.retry();}
            break;
        case 'disconnect':
            if (user.id !== process.env.TWITCH_BROADCASTER_ID && !s.demo)
                return res.sendStatus(403);
            if (!s.demo) {
                twitch?.stop();
                saveCredentials(null);
            }
            break;
        default: throw new Error('Unknown action.');
    }
    if (!s.demo)
        persist();
    res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
if (production) {
    app.use(express.static('dist'));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
}
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error instanceof z.ZodError ? 'Please check the supplied values.' : error.message || 'Request failed.' }); });
app.listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => console.log(`ChatSpin is running at ${origin}`));
