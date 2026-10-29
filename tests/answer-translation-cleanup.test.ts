import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  addQuestion,
  emptyState,
  cleanupAnswerTranslations,
  type State,
} from '../server/domain.ts';
import { clearCollection } from '../server/reset.ts';
import { retain } from '../server/limits.ts';
import { cloudDashboardAction } from '../server/cloud-actions.ts';
import { restoreCloudBackup } from '../server/cloud-backups.ts';
import { database } from './fixtures/cloud-db.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function addDerived(s: State, text: string, answer: string, at = Date.now(), permanent = false) {
  const group = addQuestion(s, { id: '1', name: 'Owner' }, text, undefined, at);
  group.status = 'written';
  group.answer = answer;
  group.answerSession = s.liveSession;
  group.answerScope = permanent ? 'permanent' : 'session';
  const data = s as any,
    source = hash(answer);
  data.answerTranslationJobs ||= [];
  data.answerTranslationJobs.push({
    id: group.id,
    key: group.id,
    groupId: group.id,
    source,
    language: 'es',
    attempts: 3,
    next: 9999999999999,
    failed: true,
    questionText: text,
  });
  data.approvedAnswerTranslations ||= {};
  data.approvedAnswerTranslations[source + ':es'] = {
    source,
    language: 'es',
    text: 'Translated ' + answer,
    at,
  };
  data.answerLanguageCache ||= {};
  data.answerLanguageCache[hash(text)] = { language: 'es', at };
  return group;
}
test('Clearing questions removes derived answer data but leaves the backup and clearing participants intact', () => {
  const s = emptyState();
  addDerived(s, 'A question?', 'Approved');
  const before = JSON.stringify(s);
  clearCollection(s, 'participants', () => {});
  assert.equal(JSON.stringify(s), before);
  let backup: any;
  clearCollection(s, 'questions', () => {
    backup = structuredClone(s);
  });
  for (const key of ['answerTranslationJobs', 'approvedAnswerTranslations', 'answerLanguageCache'])
    assert.equal((s as any)[key], undefined);
  assert.equal(backup.answerTranslationJobs.length, 1);
  assert.equal(backup.groups[0].answer, 'Approved');
});
test('A new session cancels old translation work, drops session answers, and retains reusable permanent cache', () => {
  const s = emptyState();
  addDerived(s, 'Temporary?', 'Current answer');
  const permanent = addDerived(s, 'Stable?', 'Permanent answer', Date.now(), true);
  cloudDashboardAction(s, { id: '1', name: 'Owner' }, { type: 'new-session', confirmed: true });
  const data = s as any;
  assert.deepEqual(data.answerTranslationJobs, []);
  assert.deepEqual(data.answerLanguageCache, {});
  assert.deepEqual(Object.keys(data.approvedAnswerTranslations), [hash(permanent.answer) + ':es']);
  assert.equal(s.groups.length, 2);
});
test('Retention prunes translations belonging only to expired questions without removing current caches', () => {
  const s = emptyState(),
    old = Date.now() - 31 * 86400000;
  addDerived(s, 'Old?', 'Old answer', old);
  const fresh = addDerived(s, 'Recent?', 'Recent answer');
  assert.equal(retain(s), true);
  const data = s as any;
  assert.equal(s.groups.length, 1);
  assert.equal(data.answerTranslationJobs.length, 1);
  assert.equal(data.answerTranslationJobs[0].groupId, fresh.id);
  assert.deepEqual(Object.keys(data.approvedAnswerTranslations), [hash(fresh.answer) + ':es']);
  assert.deepEqual(Object.keys(data.answerLanguageCache), [hash(fresh.text)]);
  fresh.answer = 'Updated';
  assert.equal(cleanupAnswerTranslations(s), true);
  assert.deepEqual(data.approvedAnswerTranslations, {});
  assert.deepEqual(data.answerTranslationJobs, []);
});
test('Cloud restore does not reactivate historical translation jobs or caches', async () => {
  const { repository } = database();
  await repository.mutate('101', (s) => {
    addDerived(s, 'Saved?', 'Answer');
  });
  await repository.mutate(
    '101',
    (s) => {
      s.groups = [];
    },
    true,
  );
  await restoreCloudBackup(repository, '101', '1');
  const s = (await repository.load('101')).state as any;
  assert.equal(s.groups[0].answer, 'Answer');
  for (const key of ['answerTranslationJobs', 'approvedAnswerTranslations', 'answerLanguageCache'])
    assert.equal(s[key], undefined);
});
test('Cloud reprocess resets bounded answer translation failures', () => {
  const s = emptyState();
  addDerived(s, 'Retry?', 'Answer');
  cloudDashboardAction(s, { id: '1', name: 'Owner' }, { type: 'reprocess' });
  const job = (s as any).answerTranslationJobs[0];
  assert.equal(job.attempts, 0);
  assert.equal(job.next, 0);
  assert.equal(job.failed, false);
});
