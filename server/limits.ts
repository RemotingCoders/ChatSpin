import type { State } from './domain.ts';
export const defaults = { aiCallLimit: 200, aiTokenLimit: 200000, retentionDays: 30, maxGroups: 2000 };
export function settings(s: State) { return { ...defaults, ...s.settings }; }
const budgetFlushers = new WeakMap<State, () => Promise<void>>();
export async function flushBudget(state: State) { await budgetFlushers.get(state)?.(); }
const budgetWriters = new WeakMap<State, () => void>();
export function bindBudget(state: State, persist: () => void, flush?: () => Promise<void>) { budgetWriters.set(state, persist); if (flush) budgetFlushers.set(state, flush); }
export function reserveAI(s: State, tokens: number) {
    const limits = settings(s);
    s.aiBudget ||= { calls: 0, tokens: 0 };
    if (s.aiBudget.calls >= limits.aiCallLimit || s.aiBudget.tokens + tokens > limits.aiTokenLimit)
        throw new Error('AI budget reached. Increase limits or start a new live session.');
    s.aiBudget.calls++;
    s.aiBudget.tokens += tokens;
    budgetWriters.get(s)?.();
    return (actual: number) => { s.aiBudget!.tokens += Math.max(0, actual) - tokens; budgetWriters.get(s)?.(); };
}
export function retain(s: State, now = Date.now()) {
    const days = settings(s).retentionDays;
    const cutoff = now - days * 86400000;
    const old = s.groups.filter(g => g.questions.every(q => q.at < cutoff));
    if (!old.length)
        return false;
    s.groups = s.groups.filter(g => !old.includes(g));
    if (s.spin?.mode === 'questions' && old.some(g => g.id === s.spin?.winner))
        s.spin = null;
    const ids = new Set(s.groups.map(g => g.id));
    s.aiJobs = s.aiJobs?.filter(j => ids.has(j.id));
    return true;
}
