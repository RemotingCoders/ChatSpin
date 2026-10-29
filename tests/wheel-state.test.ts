import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuestion as addRawQuestion, emptyState, eligibleEntries, spin } from '../server/domain.ts';
import { wheelPresentation } from '../src/wheelState.ts';

test('Pending questions appear before the first spin', () => {
  const state = emptyState(); const question = addQuestion(state, { id: 'one', name: 'One' }, 'Who are you?');
  const view = wheelPresentation(eligibleEntries(state), state.spin, state.mode, Date.now());
  assert.equal(view.entries[0].id, question.id); assert.equal(view.spin, null);
});

test('New questions update both wheel views after a finished draw without losing its result', () => {
  const state = emptyState(); const first = addQuestion(state, { id: 'one', name: 'One' }, 'First question?');
  const draw = spin(state, first.id); addQuestion(state, { id: 'two', name: 'Two' }, 'Second question?');
  const dashboard = wheelPresentation(eligibleEntries(state), state.spin, state.mode, Date.now());
  const overlay = wheelPresentation(eligibleEntries(state), structuredClone(state.spin), state.mode, Date.now());
  assert.deepEqual(dashboard, overlay); assert.equal(dashboard.entries.length, 2); assert.equal(dashboard.spin, null); assert.equal(state.spin!.winner, first.id);
});

test('Active draws retain frozen candidates and probabilities in both views', () => {
  const state = emptyState(); addQuestion(state, { id: 'one', name: 'One' }, 'First?');
  const draw = spin(state); addQuestion(state, { id: 'two', name: 'Two' }, 'Second?');
  const view = wheelPresentation(eligibleEntries(state), draw, state.mode, draw.start + 2000);
  assert.equal(view.entries.length, 1); assert.equal(view.spin!.id, draw.id);
  assert.equal(wheelPresentation(eligibleEntries(state), draw, state.mode, draw.end + 1).entries.length, 2);
});

test('Reopened, answered, weighted, and participant entries follow current eligibility', () => {
  const state = emptyState(); const question = addQuestion(state, { id: 'one', name: 'One' }, 'First?');
  const draw = spin(state, question.id); question.status = 'live';
  assert.equal(wheelPresentation(eligibleEntries(state), draw, state.mode, Date.now()).entries.length, 0);
  question.status = 'pending'; assert.equal(eligibleEntries(state).length, 1);
  state.odds = 'support'; question.supporters.push('two');
  assert.equal(wheelPresentation(eligibleEntries(state), draw, state.mode, Date.now()).spin, null); assert.equal(eligibleEntries(state)[0].weight, 2);
  state.mode = 'participants'; state.participants = [{id:'guest',name:'Guest',selected:false}];
  const view = wheelPresentation(eligibleEntries(state), draw, state.mode, Date.now());
  assert.equal(view.entries[0].id, 'guest'); assert.equal(view.spin, null);
});

function addQuestion(...args: Parameters<typeof addRawQuestion>){const g=addRawQuestion(...args);g.aiProcessed=true;return g;}
