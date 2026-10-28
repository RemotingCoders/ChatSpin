import { DatabaseSync } from 'node:sqlite';
import { existsSync, chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import session from 'express-session';
import { z } from 'zod';
import { emptyState, type State } from './domain.ts';
const user = z.object({ id: z.string(), name: z.string(), login: z.string().optional() });
const question = z.object({ id: z.string(), user, text: z.string(), at: z.number().finite(), messageId: z.string().optional() });
const translation=z.object({source:z.string(),text:z.string(),title:z.string()});
const attempt=z.object({source:z.string(),attempts:z.number().int().nonnegative(),next:z.number().finite()});
const group = z.looseObject({customTitle:z.string().optional(),translations:z.object({en:translation.optional(),es:translation.optional(),ru:translation.optional(),de:translation.optional()}).optional(),translationAttempts:z.object({en:attempt.optional(),es:attempt.optional(),ru:attempt.optional(),de:attempt.optional()}).optional(), id: z.string(), title: z.string(), text: z.string(), questions: z.array(question).min(1), supporters: z.array(z.string()), status: z.enum(['pending', 'live', 'written']), answer: z.string(), aiProcessed: z.boolean().optional(), contextual: z.boolean().optional(), answerScope: z.enum(['session', 'permanent']).optional(), answerSession: z.string().optional(), answerHistory: z.array(z.object({ text: z.string(), at: z.number().finite() })).optional(), embedding: z.object({ model: z.string(), vector: z.array(z.number().finite()).length(256) }).optional() });
const entry = z.object({ id: z.string(), label: z.string(), weight: z.number().positive() });
const schema = z.looseObject({questionLanguage:z.enum(['original','en','es','ru','de']).optional(),uiLanguage:z.enum(['en','es','ru','de']).optional(), groups: z.array(group), participants: z.array(z.object({ id: z.string(), name: z.string(), selected: z.boolean(), login: z.string().optional() })), registration: z.boolean(), excludeSelected: z.boolean(), mode: z.enum(['questions', 'participants']), odds: z.enum(['equal', 'support', 'manual']), demo: z.boolean(), usage: z.object({ calls: z.number().nonnegative(), input: z.number().nonnegative(), output: z.number().nonnegative() }), liveSession: z.string().optional(), repliesPaused: z.boolean().optional(), settings: z.object({ aiCallLimit: z.number().nonnegative(), aiTokenLimit: z.number().nonnegative(), retentionDays: z.number().positive(), maxGroups: z.number().positive() }).optional(), aiBudget: z.object({ calls: z.number().nonnegative(), tokens: z.number().nonnegative() }).optional(), aiJobs: z.array(z.object({ id: z.string(), attempts: z.number().nonnegative(), next: z.number().finite(), failed: z.boolean().optional() })).optional(), pendingMessages: z.array(z.object({ user, text: z.string(), messageId: z.string(), at: z.number().finite(), attempts: z.number().nonnegative(), next: z.number().finite(), detected: z.boolean().optional(), originalId: z.string().optional() })).optional(), replyHistory: z.record(z.string(), z.number().finite()).optional(), replyJobs: z.array(z.object({ groupId: z.string(), userId: z.string(), messageId: z.string(), answer: z.string(), parts: z.array(z.string()).min(1), next: z.number().int().nonnegative(), created: z.number().finite(), sending: z.boolean().optional() }).refine(j => j.next < j.parts.length)).optional(), replyLog: z.array(z.object({ at: z.number().finite(), messageId: z.string(), groupId: z.string(), user: z.string(), answer: z.string(), status: z.string() })).optional(), spin: z.object({ id: z.string(), mode: z.enum(['questions', 'participants']), candidates: z.array(entry), winner: z.string(), label: z.string(), text: z.string(), start: z.number(), end: z.number() }).nullable() });
export function validateState(value: unknown): State { return schema.parse(value) as unknown as State; }
export class Repository {
    warning = '';
    db: DatabaseSync;
    readonly secret: string;
    private key: Buffer;
    constructor(readonly file: string, secret?: string) {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const keyFile = file + '.key';
        if (!secret && !existsSync(keyFile))
            writeFileSync(keyFile, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
        this.secret = secret || readFileSync(keyFile, 'utf8');
        this.key = createHash('sha256').update(this.secret).digest();
        this.db = new DatabaseSync(file + '.sqlite');
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)');
        for (const path of [file + '.sqlite', file + '.sqlite-wal', file + '.sqlite-shm'])
            if (existsSync(path))
                chmodSync(path, 0o600);
        this.db.exec('BEGIN IMMEDIATE');
        const owner = this.db.prepare('SELECT value FROM records WHERE id=?').get('process-owner') as {
            value: string;
        } | undefined;
        if (owner) {
            const pid = Number(owner.value);
            if (pid !== process.pid) {
                let alive = false;
                try {
                    process.kill(pid, 0);
                    alive = true;
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
                        alive = true;
                }
                if (alive) {
                    this.db.exec('ROLLBACK');
                    this.db.close();
                    throw new Error('Another ChatSpin process is using this data file. Stop it before starting another instance.');
                }
            }
        }
        this.db.prepare('INSERT INTO records(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('process-owner', String(process.pid));
        this.db.exec('COMMIT');
    }
    load(): State {
        const row = this.db.prepare('SELECT value FROM records WHERE id=?').get('state') as {
            value: string;
        } | undefined;
        if (row) {
            try {
                return validateState(JSON.parse(row.value));
            }
            catch {
                const snapshots = this.db.prepare('SELECT value FROM snapshots ORDER BY id DESC').all() as {
                    value: string;
                }[];
                for (const old of snapshots)
                    try {
                        const restored = validateState(JSON.parse(old.value));
                        this.warning = 'Recovered state from a validated snapshot. Review recent changes.';
                        this.db.prepare('INSERT INTO records(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('invalid-state-preserved', row.value);
                        return restored;
                    }
                    catch { }
                throw new Error('Saved state is invalid. Restore a validated backup before starting.');
            }
        }
        if (!existsSync(this.file))
            return emptyState();
        try {
            return validateState(JSON.parse(readFileSync(this.file, 'utf8')));
        }
        catch {
            const folder = join(dirname(this.file), 'backups');
            const backups = existsSync(folder) ? readdirSync(folder).filter(f => f.startsWith('session-') && f.endsWith('.json')).sort().reverse() : [];
            for (const name of backups)
                try {
                    const restored = validateState(JSON.parse(readFileSync(join(folder, name), 'utf8')));
                    this.warning = 'Recovered state from a validated JSON backup. Original file was preserved.';
                    return restored;
                }
                catch { }
            throw new Error('State file is invalid and no valid backup was found. Original data was preserved.');
        }
    }
    save(state: State) {
        const value = JSON.stringify(state);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare('INSERT INTO records(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('state', value);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    snapshot(state: State) { this.db.prepare('INSERT INTO snapshots(value) VALUES (?)').run(JSON.stringify(state)); this.db.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 20)'); }
    seal(value: unknown) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv); return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64'); }
    unseal(value: string) { const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString()); }
    putSecret(id: string, value: unknown) { this.db.prepare('INSERT INTO records(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, this.seal(value)); }
    getSecret<T>(id: string): T | undefined {
        const row = this.db.prepare('SELECT value FROM records WHERE id=?').get(id) as {
            value: string;
        } | undefined;
        if (!row)
            return;
        try {
            return this.unseal(row.value) as T;
        }
        catch {
            return;
        }
    }
    removeSecret(id: string) { this.db.prepare('DELETE FROM records WHERE id=?').run(id); }
    cleanup() { this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()); }
}
export class PersistentSessions extends session.Store {
    constructor(private repository: Repository) { super(); }
    get(id: string, callback: (error?: unknown, value?: session.SessionData | null) => void) {
        try {
            const row = this.repository.db.prepare('SELECT value FROM sessions WHERE id=? AND expires>?').get(id, Date.now()) as {
                value: string;
            } | undefined;
            if (!row) {
                callback(null, null);
                return;
            }
            try {
                callback(null, this.repository.unseal(row.value));
            }
            catch {
                this.repository.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
                callback(null, null);
            }
        }
        catch (error) {
            callback(error);
        }
    }
    set(id: string, value: session.SessionData, callback?: (error?: unknown) => void) {
        try {
            const expires = value.cookie.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
            this.repository.db.prepare('INSERT INTO sessions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,expires=excluded.expires').run(id, this.repository.seal(value), expires);
            callback?.();
        }
        catch (error) {
            callback?.(error);
        }
    }
    destroy(id: string, callback?: (error?: unknown) => void) {
        try {
            this.repository.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
            callback?.();
        }
        catch (error) {
            callback?.(error);
        }
    }
    touch(id: string, value: session.SessionData, callback?: (error?: unknown) => void) { this.set(id, value, callback); }
}
