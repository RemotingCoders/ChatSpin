import { RequestError } from './request-error.js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanupAnswerTranslations, type State } from './domain.js';

export type ClearTarget = 'questions' | 'participants';

export function archiveSession(state: State, stateFile: string) {
  const directory = join(dirname(stateFile), 'backups');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = `${state.demo ? 'demo' : 'session'}-${Date.now()}-${randomBytes(6).toString('hex')}.json`;
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  return path;
}

export function clearCollection(state: State, target: ClearTarget, archive: () => void) {
  if (state.spin && state.spin.end > Date.now())
    throw new RequestError('Wait for the current spin to finish.');
  archive();
  if (target === 'questions') {
    cleanupAnswerTranslations(state, 'clear');
    state.groups = [];
    state.replyJobs = [];
    state.replyLog = [];
    state.replyHistory = {};
    state.aiJobs = [];
    state.pendingMessages = [];
  } else state.participants = [];
  if (state.spin?.mode === target) state.spin = null;
}
