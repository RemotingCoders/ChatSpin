import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './fixtures/cloud-db.ts';
import { StateConflict } from '../server/supabase.ts';
import { addQuestion, emptyState } from '../server/domain.ts';
import { QuestionWork } from '../server/work.ts';

test('Interactive updates and incoming questions survive an AI worker commit', async () => {
  const { repository } = database();
  await repository.mutate('101', (s) => {
    addQuestion(s, { id: '1', name: 'A' }, 'First?');
  });
  const worker = await repository.acquire('101'),
    first = worker.state.groups[0];
  await repository.mutate('101', (s) => {
    s.groups[0].supporters.push('2');
    s.registration = false;
    addQuestion(s, { id: '2', name: 'B' }, 'Second?');
  });
  first.aiProcessed = true;
  await repository.commit(worker);
  await repository.release(worker);
  const result = (await repository.load('101')).state;
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0].supporters, ['2']);
  assert.equal(result.groups[0].aiProcessed, true);
  assert.equal(result.registration, false);
  assert.equal(result.cloudLease, undefined);
});
test('Conflicting answer edits abort the worker without replacing the streamer answer', async () => {
  const { repository } = database();
  await repository.mutate('101', (s) => {
    addQuestion(s, { id: '1', name: 'A' }, 'First?');
  });
  const worker = await repository.acquire('101');
  worker.state.groups[0].answer = 'AI old answer';
  await repository.mutate('101', (s) => {
    s.groups[0].answer = 'Streamer answer';
    s.groups[0].status = 'written';
  });
  await assert.rejects(repository.commit(worker), StateConflict);
  await repository.release(worker);
  assert.equal((await repository.load('101')).state.groups[0].answer, 'Streamer answer');
});
test('A disconnected credential cannot be restored by an old refresh', async () => {
  const { repository } = database();
  await repository.load('101');
  await repository.putSecret('101', 'twitch', { access_token: 'old' });
  const old = (await repository.secretRecord('101', 'twitch'))!;
  await repository.removeSecret('101', 'twitch');
  assert.equal(
    await repository.replaceSecret('101', 'twitch', old.version, { access_token: 'renewed' }),
    undefined,
  );
  assert.equal(await repository.getSecret('101', 'twitch'), undefined);
});
test('A burst of 100 viewers shares one read and every view is independently mutable', async () => {
  const { repository } = database();
  await repository.load('101');
  let calls = 0;
  const load = repository.load.bind(repository);
  repository.load = async (id) => {
    calls++;
    return load(id);
  };
  const reads = await Promise.all(Array.from({ length: 100 }, () => repository.view('101')));
  assert.equal(calls, 1);
  reads[0].state.registration = false;
  assert.equal(reads[1].state.registration, true);
  await repository.mutate('101', (s) => {
    s.registration = false;
  });
  assert.equal((await repository.view('101')).state.registration, false);
});
test('Question rate limits survive worker recreation and saturated ingestion requests retry', () => {
  const s = emptyState(),
    user = { id: '1', name: 'A' };
  for (let i = 0; i < 10; i++) {
    const worker = new QuestionWork(
      s,
      () => {},
      async () => [],
      async () => {},
      () => {},
    );
    assert.equal(worker.ingest(user, `Question ${i}?`, String(i)), true);
  }
  const next = new QuestionWork(
    s,
    () => {},
    async () => [],
    async () => {},
    () => {},
  );
  assert.equal(next.ingest(user, 'One more?', 'extra'), false);
  assert.equal(s.groups.length, 10);
  s.pendingMessages = Array.from({ length: 100 }, (_, i) => ({
    user,
    text: 'Waiting',
    messageId: String(i),
    at: Date.now(),
    attempts: 0,
    next: 0,
  }));
  assert.equal(next.ingest({ id: '2', name: 'B' }, 'Overflow?', 'overflow'), false);
  assert.equal(s.groups.length, 10);
});

test('Disconnect fencing rejects an existing worker and cancels queued public sends', async () => {
  const { repository } = database();
  const worker = await repository.acquire('101');
  await repository.mutate('101', (s) => {
    delete s.cloudLease;
    s.replyJobs = [];
  });
  worker.state.registration = false;
  await assert.rejects(repository.commit(worker), StateConflict);
  assert.equal((await repository.load('101')).state.registration, true);
});
