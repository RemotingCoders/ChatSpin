import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spanish, translate } from '../src/catalog.ts';
import { german, russian } from '../src/locales.ts';
test('Every interface string has Spanish, German and Russian translations', () => {
  for (const key of Object.keys(spanish)) {
    assert.ok(german[key], `Missing German: ${key}`);
    assert.ok(russian[key], `Missing Russian: ${key}`);
  }
});
test('Language switching translates controls without changing English source keys', () => {
  assert.equal(translate('Mark answered', 'en'), 'Mark answered');
  assert.equal(translate('Mark answered', 'es'), 'Marcar como respondida');
  assert.notEqual(translate('Mark answered', 'de'), 'Mark answered');
  assert.match(translate('Mark answered', 'ru'), /[А-Яа-я]/u);
});
test('Interpolation, whitespace and plural forms remain valid in all four languages', () => {
  for (const lang of ['en', 'es', 'ru', 'de'] as const) {
    assert.ok(translate(' ELIGIBLE', lang).startsWith(' '));
    const value = translate('{v0} original{v1}', lang, { v0: 2, v1: 's' });
    assert.ok(value.includes('2'));
    assert.ok(!value.includes('{v'));
  }
  assert.equal(translate('{v0} original{v1}', 'es', { v0: 1, v1: '' }), '1 original');
  assert.equal(translate('{v0} original{v1}', 'es', { v0: 2, v1: 's' }), '2 originales');
});
test('Technical configuration names and public chat commands stay unchanged in every catalog', () => {
  for (const [key] of Object.entries(spanish)) {
    const tokens = key.match(/![a-z]+\b|\b[A-Z]+_[A-Z_]+\b/g) || [];
    for (const lang of ['es', 'de', 'ru'] as const) {
      const translated = translate(key, lang);
      for (const token of tokens) assert.ok(translated.includes(token), `${lang}: ${token}`);
    }
  }
});
