import { randomInt, randomUUID } from 'node:crypto';
export type User = { id: string; name: string };
export type Question = { id: string; user: User; text: string; at: number };
export type Group = { id: string; title: string; text: string; questions: Question[]; supporters: string[]; status: 'pending' | 'live' | 'written'; answer: string; review?: string };
export type Spin = { id: string; mode: 'questions' | 'participants'; candidates: { id: string; label: string; weight: number }[]; winner: string; label: string; text: string; start: number; end: number };
export type State = { groups: Group[]; participants: (User & { selected: boolean })[]; registration: boolean; excludeSelected: boolean; mode: 'questions' | 'participants'; odds: 'equal' | 'support' | 'manual'; spin: Spin | null; usage: { calls: number; input: number; output: number }; demo: boolean };
export const emptyState = (demo = false): State => ({ groups: [], participants: [], registration: true, excludeSelected: true, mode: 'questions', odds: 'equal', spin: null, usage: { calls: 0, input: 0, output: 0 }, demo });
export const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export const support = (g: Group) => new Set([...g.questions.map(q => q.user.id), ...g.supporters]).size;
export function addQuestion(s: State, user: User, text: string) {
  const exact = s.groups.find(g => g.questions.some(q => normalize(q.text) === normalize(text)));
  if (exact?.questions.some(q => q.user.id === user.id && normalize(q.text) === normalize(text))) return exact;
  const q: Question = { id: randomUUID(), user, text, at: Date.now() };
  if (exact) { exact.questions.push(q); return exact; }
  const group: Group = { id: randomUUID(), title: text.slice(0, 48), text, questions: [q], supporters: [], status: 'pending', answer: '' };
  s.groups.push(group); return group;
}
export function merge(s: State, from: string, to: string, approved = false) {
  const source = s.groups.find(g => g.id === from), target = s.groups.find(g => g.id === to);
  if (!source || !target || source === target) throw new Error('Choose two different groups.');
  if (target.status !== 'pending' && !approved) { source.review = target.id; return; }
  target.questions.push(...source.questions); target.supporters = [...new Set([...target.supporters, ...source.supporters])];
  s.groups = s.groups.filter(g => g !== source);
}
export function split(s: State, groupId: string, questionId: string) {
  const group = s.groups.find(g => g.id === groupId);
  const q = group?.questions.find(q => q.id === questionId);
  if (!group || !q || group.questions.length < 2) throw new Error('A group must retain at least one original.');
  group.questions = group.questions.filter(x => x.id !== questionId);
  const fresh: Group = { id: randomUUID(), title: q.text.slice(0, 48), text: q.text, questions: [q], supporters: [], status: 'pending', answer: '' };
  s.groups.push(fresh); return fresh;
}
export function spin(s: State, manualId?: string, now = Date.now()): Spin {
  if (s.spin && s.spin.end > now) throw new Error('A spin is already in progress.');
  const candidates = s.mode === 'questions' ? s.groups.filter(g => g.status === 'pending').map(g => ({ id: g.id, label: g.title, weight: s.odds === 'support' ? support(g) : 1 })) : s.participants.filter(p => !s.excludeSelected || !p.selected).map(p => ({ id: p.id, label: p.name, weight: 1 }));
  if (!candidates.length) throw new Error('No eligible entries yet.');
  let winner;
  if (s.mode === 'questions' && (s.odds === 'manual' || manualId)) {
    winner = candidates.find(c => c.id === manualId);
    if (!winner) throw new Error('Choose an eligible question.');
  } else {
    let ticket = randomInt(candidates.reduce((sum, c) => sum + c.weight, 0));
    winner = candidates.find(c => (ticket -= c.weight) < 0)!;
  }
  const question = s.groups.find(g => g.id === winner.id);
  s.spin = { id: randomUUID(), mode: s.mode, candidates, winner: winner.id, label: winner.label, text: question?.text || winner.label, start: now, end: now + (manualId ? 0 : 6000) };
  if (s.mode === 'participants') s.participants.find(p => p.id === winner.id)!.selected = true;
  return s.spin;
}
export function demoState() {
  const s = emptyState(true);
  const entries = [
    ['Finding your first community', 'What would you focus on to grow a small Twitch community?', 12],
    ['Your streaming setup', 'What equipment would you recommend for someone starting out?', 8],
    ['Avoiding creator burnout', 'How do you keep streaming without burning out?', 6],
    ['The next chapter', 'What is one thing you want to try on stream this year?', 4],
    ['A little advice', '¿Qué consejo le darías a tu yo de hace cinco años?', 1],
    ['Behind the scenes', 'How do you plan a stream before going live?', 3],
  ] as const;
  for (const [title, text, count] of entries) { const g = addQuestion(s, { id: `sample-${title}`, name: ['pixelpilot','mintbyte','lunarose','cozycat','mateo','orbit'][s.groups.length] }, text); g.title = title; g.supporters = Array.from({ length: count - 1 }, (_, i) => `${title}-${i}`); }
  s.participants = ['pixelpilot', 'lunarose', 'cozycat', 'mintbyte', 'orbit'].map(name => ({ id: `sample-${name}`, name, selected: false }));
  return s;
}
