import test from 'node:test';
import assert from 'node:assert/strict';
import { groupingResponseSchema } from '../server/ai.ts';

test('grouping requires decisions for unmatched questions as well as matches', () => {
  const schema = groupingResponseSchema(2);
  const unmatched = {
    target: null,
    confidence: 'different',
    timeSensitive: false,
    title: 'Origin',
  };
  const matched = { ...unmatched, target: 'approved', confidence: 'equivalent' };
  assert.equal(schema.safeParse({ decision_1: matched }).success, false);
  assert.equal(schema.safeParse({ decision_0: unmatched, decision_1: matched }).success, true);
});
