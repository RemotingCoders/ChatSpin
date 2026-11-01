import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuestion, emptyState, merge } from '../server/domain.ts';
import { applyDecisions } from '../server/ai.ts';
import { QuestionWork } from '../server/work.ts';
const user = { id: 'a', name: 'A' };
test('Exact and model-equivalent pending questions cannot cross the time window', () => {
  const s = emptyState(),
    old = addQuestion(s, user, 'What are you doing?', undefined, Date.now() - 1800000);
  const fresh = addQuestion(s, user, 'What are you doing?');
  assert.notEqual(fresh.id, old.id);
  applyDecisions(
    s,
    [fresh],
    [old],
    [{ source: fresh.id, target: old.id, confidence: 'equivalent', title: 'Activity' }],
  );
  assert.equal(s.groups.length, 2);
});
test('Merging preserves saved answers and refuses unresolved conflicts', () => {
  const s = emptyState(),
    a = addQuestion(s, user, 'Camera?'),
    b = addQuestion(s, user, 'Which camera?');
  a.status = 'written';
  a.answer = 'Camera A';
  merge(s, a.id, b.id, true);
  assert.equal(b.answer, 'Camera A');
  assert.equal(b.status, 'written');
  const c = addQuestion(s, user, 'Another camera?');
  c.answer = 'Camera B';
  c.status = 'written';
  assert.throws(() => merge(s, c.id, b.id, true), /Choose/);
  merge(s, c.id, b.id, true, 'source');
  assert.equal(b.answer, 'Camera B');
  assert.ok(b.answerHistory!.some((h) => h.text === 'Camera A'));
});
test('Grouping jobs survive restarts and retry after failure', async () => {
  const s = emptyState();
  const g = addQuestion(s, user, 'Camera?');
  let fail = true;
  let work = new QuestionWork(
    s,
    () => {},
    async () => [],
    async () => {
      if (fail) throw Error('Offline');
    },
    () => {},
  );
  await work.tick();
  assert.equal(s.aiJobs![0].attempts, 1);
  fail = false;
  work = new QuestionWork(
    s,
    () => {},
    async () => [],
    async () => {},
    () => {},
  );
  await work.tick(Date.now() + 60000);
  assert.equal(s.aiJobs!.length, 0);
  assert.equal(g.aiProcessed, true);
});
test('Indirect questions are detected and messages arriving during AI all receive saved answers', async () => {
  const s = emptyState();
  const target = addQuestion(s, user, 'What is your project?');
  target.status = 'written';
  target.answer = 'ChatSpin';
  let release!: () => void;
  const sent: string[] = [];
  const work = new QuestionWork(
    s,
    () => {},
    async (rows) => rows.map((r) => r.id),
    async (ids) => {
      await new Promise<void>((r) => (release = r));
      for (const id of ids)
        if (id !== target.id && s.groups.some((g) => g.id === id)) merge(s, id, target.id, true);
    },
    (_g, _u, id) => sent.push(id),
  );
  work.ingest(user, 'Me gustaría saber qué estás construyendo', 'one');
  const tick = work.tick();
  await new Promise((r) => setImmediate(r));
  work.ingest({ id: 'b', name: 'B' }, 'Me gustaría saber qué estás construyendo', 'two');
  release();
  await tick;
  await work.tick();
  assert.deepEqual(sent.sort(), ['one', 'two']);
});

test('A fresh Spanish message reuses a scoped English answer and retains its text for reply translation', async () => {
  const { retrieveCandidates } = await import('../server/ai.ts');
  const { cloudDashboardAction } = await import('../server/cloud-actions.ts');
  const state = emptyState();
  const target = addQuestion(
    state,
    user,
    'What gear are you using for the stream right now?',
    'old-message',
    Date.now() - 1800000,
  );
  cloudDashboardAction(state, user, {
    type: 'answer',
    id: target.id,
    text: 'I use a MacBook Pro with OBS',
    value: 'session',
  });
  const delivered: { answer: string; question: string | undefined; message: string }[] = [];
  const work = new QuestionWork(
    state,
    () => {},
    async (rows) => rows.map((r) => r.id),
    async (ids) => {
      const incoming = state.groups.filter((g) => ids.includes(g.id));
      const candidates = await retrieveCandidates(state, incoming, ids);
      assert.ok(candidates.includes(target));
      applyDecisions(
        state,
        incoming,
        candidates,
        incoming.map((g) => ({
          source: g.id,
          target: target.id,
          confidence: 'equivalent' as const,
          timeSensitive: true,
          title: 'Streaming equipment',
        })),
      );
    },
    (group, _viewer, message, question) =>
      delivered.push({ answer: group.answer, question, message }),
  );
  work.ingest({ id: 'sol', name: 'Sol' }, '¿Qué equipo usás para transmitir?', 'spanish-message');
  await work.tick();
  assert.deepEqual(delivered, [
    {
      answer: 'I use a MacBook Pro with OBS',
      question: '¿Qué equipo usás para transmitir?',
      message: 'spanish-message',
    },
  ]);
  work.deliver();
  assert.equal(delivered.length, 1);
});
