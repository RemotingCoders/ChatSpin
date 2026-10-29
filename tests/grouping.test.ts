import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuestion, emptyState, support } from '../server/domain.ts';
import { applyDecisions, retrieveCandidates } from '../server/ai.ts';
test('A batch groups paraphrases from the same batch and resolves earlier merged IDs', () => {
  const s = emptyState();
  const a = addQuestion(s, { id: 'a', name: 'A' }, 'How do I grow?'),
    b = addQuestion(s, { id: 'b', name: 'B' }, 'How to find viewers?'),
    c = addQuestion(s, { id: 'c', name: 'C' }, 'How to attract a community?');
  applyDecisions(
    s,
    [a, b, c],
    [],
    [
      { source: a.id, target: null, confidence: 'different', title: 'Growth' },
      { source: b.id, target: a.id, confidence: 'equivalent', title: 'First viewers' },
      { source: c.id, target: b.id, confidence: 'equivalent', title: 'Community' },
    ],
  );
  assert.equal(s.groups.length, 1);
  assert.equal(support(s.groups[0]), 3);
});
test('AI uncertain matches stay separate; invalid IDs and forward links cannot merge', () => {
  const s = emptyState();
  const a = addQuestion(s, { id: 'a', name: 'A' }, 'Camera choice'),
    b = addQuestion(s, { id: 'b', name: 'B' }, 'Camera lighting');
  applyDecisions(
    s,
    [a, b],
    [],
    [
      { source: a.id, target: b.id, confidence: 'equivalent', title: 'Camera choice' },
      { source: b.id, target: a.id, confidence: 'uncertain', title: 'Camera lighting' },
    ],
  );
  assert.equal(s.groups.length, 2);
  assert.equal(b.review, a.id);
  applyDecisions(
    s,
    [b],
    [a],
    [{ source: b.id, target: 'unknown', confidence: 'equivalent', title: 'Lighting' }],
  );
  assert.equal(s.groups.length, 2);
});

test('Strong equivalent matches reuse approved written answers, while uncertain and live-only matches stay separate', () => {
  for (const status of ['written', 'live'] as const) {
    const state = emptyState();
    const target = addQuestion(state, { id: 'one', name: 'One' }, 'Where do you live?');
    target.status = status;
    target.answer = status === 'written' ? 'I live in Argentina.' : '';
    const source = addQuestion(
      state,
      { id: 'two', name: 'Two' },
      'Where are you currently living?',
    );
    applyDecisions(
      state,
      [source],
      [target],
      [
        {
          source: source.id,
          target: target.id,
          confidence: 'equivalent',
          title: 'Current residence',
        },
      ],
    );
    assert.equal(state.groups.length, status === 'written' ? 1 : 2);
    if (status === 'written') assert.equal(target.questions.length, 2);
    else assert.equal(source.review, target.id);
  }
  const state = emptyState(),
    target = addQuestion(state, { id: 'one', name: 'One' }, 'Where are you from?');
  target.status = 'written';
  target.answer = 'Argentina';
  const source = addQuestion(state, { id: 'two', name: 'Two' }, 'Where do you live?');
  applyDecisions(
    state,
    [source],
    [target],
    [{ source: source.id, target: target.id, confidence: 'uncertain', title: 'Residence' }],
  );
  assert.equal(state.groups.length, 2);
  assert.equal(source.review, target.id);
  assert.equal(source.answer, '');
});

test('Contextual activity and goal questions merge only within one five-minute pending window', () => {
  for (const [gap, status, expected] of [
    [60000, 'pending', 1],
    [1800000, 'pending', 2],
    [60000, 'written', 2],
  ] as const) {
    const state = emptyState();
    const target = addQuestion(state, { id: 'one', name: 'One' }, 'What are you doing?');
    const source = addQuestion(state, { id: 'two', name: 'Two' }, 'What are you trying to do?');
    target.questions[0].at = 1000000;
    source.questions[0].at = 1000000 + gap;
    target.status = status;
    if (status === 'written') target.answer = 'An earlier activity';
    applyDecisions(
      state,
      [source],
      [target],
      [
        {
          source: source.id,
          target: target.id,
          confidence: 'contextual',
          title: 'Current project',
        },
      ],
    );
    assert.equal(state.groups.length, expected);
  }
});

test('Contextual groups cannot extend the time window through chained arrivals', () => {
  const state = emptyState();
  const a = addQuestion(state, { id: 'a', name: 'A' }, 'What are you doing?');
  const b = addQuestion(state, { id: 'b', name: 'B' }, 'What are you trying to do?');
  const c = addQuestion(state, { id: 'c', name: 'C' }, 'What are you working on?');
  a.questions[0].at = 1000000;
  b.questions[0].at = 1240000;
  c.questions[0].at = 1480000;
  applyDecisions(
    state,
    [b, c],
    [a],
    [
      { source: b.id, target: a.id, confidence: 'contextual', title: 'Project' },
      { source: c.id, target: b.id, confidence: 'contextual', title: 'Project' },
    ],
  );
  assert.equal(state.groups.length, 2);
  assert.equal(a.questions.length, 2);
});

test('Model-detected temporary questions cannot reuse an old written answer', () => {
  const state = emptyState();
  const old = addQuestion(
    state,
    { id: 'a', name: 'A' },
    'Describe the project on your screen',
    undefined,
    Date.now() - 1800000,
  );
  old.status = 'written';
  old.answer = 'The earlier project';
  const fresh = addQuestion(state, { id: 'b', name: 'B' }, 'Which project are you showing?');
  applyDecisions(
    state,
    [fresh],
    [old],
    [
      {
        source: fresh.id,
        target: old.id,
        confidence: 'equivalent',
        timeSensitive: true,
        title: 'Current screen project',
      },
    ],
  );
  assert.equal(state.groups.length, 2);
});

test('Stable multilingual equivalents remain candidates and merge after five minutes', async () => {
  const state = emptyState(),
    now = Date.now();
  const old = addQuestion(
    state,
    { id: 'a', name: 'A' },
    'Where are you from?',
    undefined,
    now - 1800000,
  );
  const fresh = addQuestion(state, { id: 'b', name: 'B' }, '¿De qué país sos?', undefined, now);
  const candidates = await retrieveCandidates(state, [fresh], [fresh.id]);
  assert.ok(candidates.some((g) => g.id === old.id));
  applyDecisions(state, [fresh], candidates, [
    {
      source: fresh.id,
      target: old.id,
      confidence: 'equivalent',
      timeSensitive: false,
      title: 'Country of origin',
    },
  ]);
  assert.equal(state.groups.length, 1);
  assert.deepEqual(
    old.questions.map((q) => q.text),
    ['Where are you from?', '¿De qué país sos?'],
  );
});

test('Retrieval retains time boundaries for changing context, including written answers', async () => {
  for (const status of ['pending', 'written'] as const) {
    const state = emptyState(),
      now = Date.now();
    const old = addQuestion(
      state,
      { id: 'a', name: 'A' },
      'What are you doing?',
      undefined,
      now - 1800000,
    );
    old.status = status;
    if (status === 'written') old.answer = 'The earlier project';
    const fresh = addQuestion(
      state,
      { id: 'b', name: 'B' },
      'What are you trying to do?',
      undefined,
      now,
    );
    assert.deepEqual(await retrieveCandidates(state, [fresh], [fresh.id]), []);
  }
});
