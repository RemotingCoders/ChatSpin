import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoState, spin } from '../server/domain.ts';
import { archiveSession, clearCollection } from '../server/reset.ts';

test('Clearing questions preserves participants and archives answers and the previous draw', () => {
  const state = demoState(), directory = mkdtempSync(join(tmpdir(), 'chatspin-backup-'));
  const participants = structuredClone(state.participants);
  const group = state.groups[0];
  spin(state, group.id); group.status = 'written'; group.answer = 'Approved response';
  const original = structuredClone(state);
  let backup = '';
  try {
    clearCollection(state, 'questions', () => { backup = archiveSession(state, join(directory, 'state.json')); });
    assert.deepEqual(state.groups, []); assert.deepEqual(state.participants, participants); assert.equal(state.spin, null);
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), original);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Clearing participants preserves questions, settings, and a question draw', () => {
  const state = demoState(); spin(state, state.groups[0].id);
  const questions = structuredClone(state.groups), draw = structuredClone(state.spin);
  state.registration = false;
  clearCollection(state, 'participants', () => {});
  assert.deepEqual(state.participants, []); assert.deepEqual(state.groups, questions); assert.deepEqual(state.spin, draw); assert.equal(state.registration, false);
});

test('Clearing participants resets their draw and backup failure leaves the session intact', () => {
  const state = demoState(); state.mode = 'participants'; spin(state, undefined, Date.now() - 7000);
  const original = structuredClone(state);
  assert.throws(() => clearCollection(state, 'participants', () => { throw new Error('Disk full'); }), /Disk full/);
  assert.deepEqual(state, original);
  clearCollection(state, 'participants', () => {}); assert.equal(state.spin, null); assert.deepEqual(state.groups, original.groups);
});

test('No collection can be cleared during an active spin', () => {
  const state = demoState(); spin(state); const original = structuredClone(state);
  for (const target of ['questions', 'participants'] as const) assert.throws(() => clearCollection(state, target, () => { throw new Error('Should not archive'); }), /current spin/);
  assert.deepEqual(state, original);
});
