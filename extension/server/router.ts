import express from 'express';
import { z } from 'zod';
import type { State, User } from '../../server/domain.js';
import { verifyExtensionJWT, extensionController, linkedViewer } from './auth.js';
import {
  applyExtensionAction,
  extensionState,
  languageSchema,
  type ExtensionActor,
} from './service.js';
export type ExtensionDependencies = {
  state: () => State;
  persist: () => void;
  enqueue: (id: string) => void;
  busy: () => boolean;
  demand: (language: 'en' | 'es' | 'ru' | 'de') => void;
  clientId: string;
  secrets: string[];
  channel: string;
  origins: string[];
  moderators: string[];
};
const actorUser = (s: State, id: string): User =>
  s.groups.flatMap((g) => g.questions).find((q) => q.user.id === id)?.user ||
  s.participants.find((p) => p.id === id) || { id, name: 'Twitch viewer' };
export function extensionRouter(deps: ExtensionDependencies) {
  const router = express.Router();
  const rates = new Map<string, number[]>();
  router.use(express.json({ limit: '8kb' }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin && !deps.origins.includes(origin))
      return res.status(403).json({ error: 'Extension origin rejected.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return origin ? res.sendStatus(204) : res.sendStatus(403);
    if (
      !deps.clientId ||
      !deps.channel ||
      !deps.secrets.some((s) => Buffer.from(s, 'base64').length >= 32)
    )
      return res.status(503).json({ error: 'Twitch extension is not configured.' });
    if (req.method !== 'GET' && !origin)
      return res.status(403).json({ error: 'Extension origin required.' });
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw Error('Missing token');
      const claims = verifyExtensionJWT(header.slice(7), deps.secrets, deps.channel);
      const controller = extensionController(claims, deps.moderators);
      if (claims.role === 'broadcaster' && !controller) throw Error('Invalid broadcaster');
      const id = linkedViewer(claims) || (controller ? deps.channel : undefined);
      res.locals.actor = {
        controller,
        user: id ? actorUser(deps.state(), id) : undefined,
        anonymous: !claims.opaque_user_id.startsWith('U'),
      } satisfies ExtensionActor;
      res.locals.rateKey = claims.user_id || claims.opaque_user_id;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired extension authorization.' });
    }
  });
  router.get('/state', (req, res) => {
    const s = deps.state(),
      language = languageSchema.parse(req.query.language || s.questionLanguage || 'original');
    if (language !== 'original') deps.demand(language);
    res.json(extensionState(s, res.locals.actor, language));
  });
  router.post('/action', (req, res) => {
    const now = Date.now();
    for (const [key, times] of rates) if (!times.some((t) => t > now - 60000)) rates.delete(key);
    const key = res.locals.rateKey as string,
      previous = (rates.get(key) || []).filter((t) => t > now - 60000);
    if (previous.length >= 30)
      return res.status(429).json({ error: 'Please wait before sending more actions.' });
    previous.push(now);
    rates.set(key, previous);
    applyExtensionAction(deps.state(), res.locals.actor, req.body, deps.enqueue, deps.busy());
    deps.persist();
    res.json({ ok: true });
  });
  router.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  router.use(
    (
      error: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res.status(error.status || 400).json({
        error: error instanceof z.ZodError ? 'Please check the supplied values.' : error.message,
      }),
  );
  return router;
}
export function extensionPreviewRouter(state: () => State, enqueue: (id: string) => void) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' || !req.session.demo) return res.sendStatus(404);
    res.locals.actor = {
      user: req.session.user,
      controller: req.session.demoController === true,
      anonymous: false,
    } satisfies ExtensionActor;
    next();
  });
  router.get('/state', (req, res) => {
    const s = state();
    res.json(
      extensionState(
        s,
        res.locals.actor,
        languageSchema.parse(req.query.language || s.questionLanguage || 'original'),
      ),
    );
  });
  router.post('/action', (req, res) => {
    applyExtensionAction(state(), res.locals.actor, req.body, enqueue);
    res.json({ ok: true });
  });
  return router;
}
