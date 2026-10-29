import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ApprovedAnswer,
  answerForEditing,
  type AnswerView,
} from '../extension/src/ApprovedAnswer.tsx';
const render = (group: AnswerView) =>
  renderToStaticMarkup(createElement(ApprovedAnswer, { group }));
test('Approved answers render translated text, never original fallback while translation is pending or failed', () => {
  assert.match(render({ answer: 'Soy de Argentina.' }), /Soy de Argentina\./);
  const pending = render({ answer: 'Original must stay hidden', answerTranslationPending: true });
  assert.match(pending, /Translating/);
  assert.doesNotMatch(pending, /Original must stay hidden/);
  const failed = render({ answer: 'Original must stay hidden', answerTranslationFailed: true });
  assert.match(failed, /failed/);
  assert.doesNotMatch(failed, /Original must stay hidden/);
  assert.equal(render({ answer: '' }), '');
});
test('Answer editing always uses the original supplied to controllers, including deliberately empty drafts', () => {
  assert.equal(answerForEditing({ answer: 'Translated', originalAnswer: 'Original' }), 'Original');
  assert.equal(answerForEditing({ answer: 'Translated', originalAnswer: '' }), '');
  assert.equal(answerForEditing({ answer: 'Legacy original' }), 'Legacy original');
  assert.equal(answerForEditing(undefined), '');
});
