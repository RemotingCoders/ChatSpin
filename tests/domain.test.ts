import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addQuestion as addRawQuestion,
  emptyState,
  merge,
  split,
  spin,
  support,
} from '../server/domain.ts';
const alice = { id: '1', name: 'alice' },
  bob = { id: '2', name: 'bob' };
test('Duplicate messages and self-support count once using stable IDs', () => {
  const s = emptyState(),
    g = addQuestion(s, alice, 'How do you start?');
  addQuestion(s, { ...alice, name: 'renamed' }, '  HOW do you start? ');
  g.supporters.push(alice.id, alice.id);
  assert.equal(s.groups.length, 1);
  assert.equal(g.questions.length, 1);
  assert.equal(support(g), 1);
  addQuestion(s, bob, 'How do you start?');
  assert.equal(support(g), 2);
});
test('Minority questions stay eligible and answered questions reopen', () => {
  const s = emptyState();
  const a = addQuestion(s, alice, 'A minority question');
  const b = addQuestion(s, bob, 'Another question');
  b.status = 'live';
  assert.equal(spin(s).winner, a.id);
  assert.equal(s.spin!.candidates.length, 1);
  assert.throws(() => spin(s), /already/);
  b.status = 'pending';
  assert.equal(spin(s, undefined, Date.now() + 7000).candidates.length, 2);
});
test('Weights use distinct users and spin candidates are immutable snapshots', () => {
  const s = emptyState();
  const a = addQuestion(s, alice, 'First');
  a.supporters.push('1', '2', '2');
  addQuestion(s, bob, 'Second');
  s.odds = 'support';
  const result = spin(s);
  assert.deepEqual(
    result.candidates.map((c) => c.weight),
    [2, 1],
  );
  a.supporters.push('3');
  assert.equal(result.candidates[0].weight, 2);
  assert.ok(result.candidates.some((c) => c.id === result.winner));
});
test('Merge unions support and split derives author support without copying explicit support', () => {
  const s = emptyState();
  const a = addQuestion(s, alice, 'First wording'),
    b = addQuestion(s, bob, 'Second wording');
  a.supporters.push('2', '3');
  b.supporters.push('1', '3');
  const qid = b.questions[0].id;
  merge(s, b.id, a.id, true);
  assert.equal(support(a), 3);
  assert.equal(s.groups.length, 1);
  const fresh = split(s, a.id, qid)!;
  assert.equal(support(fresh), 1);
  assert.equal(fresh.status, 'pending');
  assert.equal(fresh.answer, '');
  assert.equal(support(a), 3);
});
test('Written or live answers are never reused by AI without approval', () => {
  const s = emptyState();
  const a = addQuestion(s, alice, 'Existing question');
  a.status = 'written';
  a.answer = 'Approved answer';
  const b = addQuestion(s, bob, 'Equivalent wording');
  merge(s, b.id, a.id);
  assert.equal(s.groups.length, 2);
  assert.equal(b.review, a.id);
  assert.equal(b.answer, '');
  merge(s, b.id, a.id, true);
  assert.equal(s.groups.length, 1);
  assert.equal(a.answer, 'Approved answer');
});
test('Same topic questions stay separate without a verified match', () => {
  const s = emptyState();
  addQuestion(s, alice, 'What camera should I buy?');
  addQuestion(s, bob, 'How should I light my camera shot?');
  assert.equal(s.groups.length, 2);
});
test('Manual selection rejects missing or ineligible candidates', () => {
  const s = emptyState();
  const g = addQuestion(s, alice, 'Choose me');
  s.odds = 'manual';
  assert.throws(() => spin(s), /Choose/);
  assert.equal(spin(s, g.id).winner, g.id);
});
test('Participant draw is uniform and selected people are excluded', () => {
  const s = emptyState();
  s.mode = 'participants';
  s.participants = [
    { ...alice, selected: false },
    { ...bob, selected: true },
  ];
  const result = spin(s);
  assert.equal(result.winner, alice.id);
  assert.deepEqual(
    result.candidates.map((c) => c.weight),
    [1],
  );
  assert.throws(() => spin(s, undefined, Date.now() + 7000), /No eligible/);
  s.excludeSelected = false;
  assert.equal(spin(s, undefined, Date.now() + 7000).candidates.length, 2);
});

function addQuestion(...args: Parameters<typeof addRawQuestion>) {
  const g = addRawQuestion(...args);
  g.aiProcessed = true;
  return g;
}
