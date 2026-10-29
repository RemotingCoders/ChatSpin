import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuestion, emptyState, eligibleEntries, merge, spin } from '../server/domain.ts';
import { QuestionWork } from '../server/work.ts';
import { TranslationWork } from '../server/translation.ts';
import { extensionState } from '../extension/server/service.ts';
const user = { id: 'viewer', name: 'Viewer' };
test('A repeated answered question never enters the wheel while its match is being checked', async () => {
  const s = emptyState(),
    answered = addQuestion(s, user, 'Where are you from?');
  answered.status = 'written';
  answered.answer = 'Argentina';
  answered.aiProcessed = true;
  const fresh = addQuestion(s, user, '¿De qué país sos?');
  let release!: () => void;
  let replies = 0;
  const work = new QuestionWork(
    s,
    () => {},
    async () => [],
    async () => {
      await new Promise<void>((r) => (release = r));
      merge(s, fresh.id, answered.id, true);
    },
    () => {
      replies++;
    },
  );
  const tick = work.tick();
  assert.deepEqual(eligibleEntries(s), []);
  assert.throws(() => spin(s, fresh.id), /No eligible/);
  release();
  await tick;
  assert.deepEqual(eligibleEntries(s), []);
  assert.equal(s.groups.length, 1);
  assert.equal(answered.questions.length, 2);
});
test('Only checked questions with current translations enter a localized wheel', async () => {
  const s = emptyState(),
    g = addQuestion(s, user, '¿Cómo empezaste?');
  s.questionLanguage = 'en';
  const work = new QuestionWork(
    s,
    () => {},
    async () => [],
    async () => {},
    () => {},
  );
  await work.tick();
  assert.equal(g.aiProcessed, true);
  assert.deepEqual(eligibleEntries(s), []);
  const translation = new TranslationWork(
    s,
    () => {},
    async (items) =>
      items.map((i) => ({ id: i.id, text: 'How did you start?', title: 'How did you start?' })),
  );
  await translation.tick();
  assert.equal(eligibleEntries(s)[0].label, 'How did you start?');
  assert.equal(extensionState(s, { controller: false, anonymous: true }, 'de').entries.length, 0);
  g.customTitle = 'Changed question';
  assert.equal(eligibleEntries(s).length, 0);
  s.questionLanguage = 'original';
  assert.equal(eligibleEntries(s)[0].label, 'Changed question');
});
test('Failed grouping retains the question for retry but never exposes it as a candidate', async () => {
  const s = emptyState();
  addQuestion(s, user, 'Which country?');
  const work = new QuestionWork(
    s,
    () => {},
    async () => [],
    async () => {
      throw Error('Unavailable');
    },
    () => {},
  );
  await work.tick();
  assert.equal(s.groups.length, 1);
  assert.equal(s.aiJobs![0].attempts, 1);
  assert.equal(eligibleEntries(s).length, 0);
});
