import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiFailure } from '../server/ai-status.ts';
import { emptyState, addQuestion } from '../server/domain.ts';
import { QuestionWork } from '../server/work.ts';
test('AI diagnostics expose only allowlisted internal quota failures', () => {
  const safe =
    'Hosted AI allowance exhausted. Contact the service operator or wait for the daily reset.';
  assert.equal(aiFailure(new Error(safe), 'Retry'), safe);
  assert.equal(aiFailure(new Error('private provider payload'), 'Retry'), 'Retry');
});
test('Restarted workers retain failed grouping status rather than reporting Ready', async () => {
  const state = emptyState();
  const group = addQuestion(state, { id: 'a', name: 'A' }, 'Question?');
  state.aiJobs = [
    {
      id: group.id,
      attempts: 3,
      next: 0,
      failed: true,
      error: 'Grouping failed — retry queued; use Reprocess if exhausted',
    },
  ];
  const work = new QuestionWork(
    state,
    () => {},
    async () => [],
    async () => {},
    () => {},
  );
  await work.tick();
  assert.equal(work.status, state.aiJobs[0].error);
});
