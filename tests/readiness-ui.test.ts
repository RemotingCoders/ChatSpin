import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addQuestion,
  approveQuestion,
  eligibleEntries,
  emptyState,
  spin,
} from '../server/domain.ts';
import { questionReadiness, translationSource } from '../server/presentation.ts';
import { extensionState, applyExtensionAction } from '../extension/server/service.ts';
import { FrozenSpin } from '../extension/src/frozenSpin.ts';
const user = { id: '1', name: 'A' };
test('Readiness distinguishes failed grouping, approved waiting translation, and current translated candidates', () => {
  const s = emptyState(),
    g = addQuestion(s, user, '¿De dónde sos?');
  assert.equal(questionReadiness(s, g), 'grouping');
  s.aiJobs = [{ id: g.id, attempts: 3, next: 0, failed: true }];
  assert.equal(questionReadiness(s, g), 'grouping_failed');
  s.questionLanguage = 'en';
  approveQuestion(s, g.id);
  assert.equal(s.aiJobs.length, 0);
  assert.equal(questionReadiness(s, g), 'translation');
  assert.equal(eligibleEntries(s).length, 0);
  g.translationAttempts = { en: { source: translationSource(g), attempts: 3, next: 0 } };
  assert.equal(questionReadiness(s, g), 'translation_failed');
  g.translations = {
    en: { source: translationSource(g), title: 'Where from?', text: 'Where are you from?' },
  };
  assert.equal(questionReadiness(s, g), 'ready');
  assert.equal(eligibleEntries(s).length, 1);
  g.status = 'live';
  assert.equal(questionReadiness(s, g), 'answered');
  assert.throws(() => approveQuestion(s, g.id), /pending/);
});
test('Only verified extension controllers can manually approve questions', () => {
  const s = emptyState(),
    g = addQuestion(s, user, 'Question?');
  const body = { type: 'approve-question', id: g.id };
  assert.throws(
    () => applyExtensionAction(s, { controller: false, anonymous: false, user }, body, () => {}),
    /access required/,
  );
  applyExtensionAction(s, { controller: true, anonymous: false, user }, body, () => {});
  assert.equal(g.aiProcessed, true);
});
test('A personal draw never falls back to original labels while waiting and freezes its first visible projection', () => {
  const s = emptyState(),
    g = addQuestion(s, user, '¿De dónde sos?');
  g.aiProcessed = true;
  const draw = spin(s);
  const actor = { controller: false, anonymous: true };
  const first = extensionState(s, actor, 'en');
  assert.equal(first.spin!.candidates[0].label, '…');
  assert.equal(first.spin!.text, '');
  const cache = new FrozenSpin();
  const frozen = cache.read(first.spin, 'en', draw.start + 1);
  g.translations = {
    en: { source: translationSource(g), title: 'Where from?', text: 'Where are you from?' },
  };
  const translated = extensionState(s, actor, 'en');
  assert.equal(cache.read(translated.spin, 'en', draw.start + 2000), frozen);
  assert.equal(frozen!.candidates[0].label, '…');
  assert.equal(cache.read(translated.spin, 'en', draw.end + 1)!.candidates[0].label, 'Where from?');
});
test('Frozen personal draws release after finishing and isolate language changes', () => {
  const s = emptyState(),
    g = addQuestion(s, user, 'Question?');
  g.aiProcessed = true;
  const draw = spin(s);
  const cache = new FrozenSpin();
  const en = cache.read(draw, 'en', draw.start);
  draw.candidates[0].label = 'Changed';
  assert.equal(en!.candidates[0].label, 'Question?');
  assert.equal(cache.read(draw, 'de', draw.start + 1)!.candidates[0].label, 'Changed');
  assert.equal(cache.read(null, 'de', draw.end), null);
});
