import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuestion, emptyState, support } from '../server/domain.ts';
import { applyDecisions } from '../server/ai.ts';
test('A batch groups paraphrases from the same batch and resolves earlier merged IDs', () => {
  const s=emptyState(); const a=addQuestion(s,{id:'a',name:'A'},'How do I grow?'), b=addQuestion(s,{id:'b',name:'B'},'How to find viewers?'), c=addQuestion(s,{id:'c',name:'C'},'How to attract a community?');
  applyDecisions(s,[a,b,c],[],[{source:a.id,target:null,confidence:'different',title:'Growth'}, {source:b.id,target:a.id,confidence:'equivalent',title:'First viewers'},{source:c.id,target:b.id,confidence:'equivalent',title:'Community'}]);
  assert.equal(s.groups.length,1); assert.equal(support(s.groups[0]),3);
});
test('AI uncertain matches stay separate; invalid IDs and forward links cannot merge', () => {
  const s=emptyState(); const a=addQuestion(s,{id:'a',name:'A'},'Camera choice'), b=addQuestion(s,{id:'b',name:'B'},'Camera lighting');
  applyDecisions(s,[a,b],[],[{source:a.id,target:b.id,confidence:'equivalent',title:'Camera choice'}, {source:b.id,target:a.id,confidence:'uncertain',title:'Camera lighting'}]);
  assert.equal(s.groups.length,2); assert.equal(b.review,a.id);
  applyDecisions(s,[b],[a],[{source:b.id,target:'unknown',confidence:'equivalent',title:'Lighting'}]); assert.equal(s.groups.length,2);
});

test('Strong equivalent matches reuse approved written answers, while uncertain and live-only matches stay separate', () => {
  for (const status of ['written','live'] as const) {
    const state=emptyState();
    const target=addQuestion(state,{id:'one',name:'One'},'Where do you live?'); target.status=status; target.answer=status==='written'?'I live in Argentina.':'';
    const source=addQuestion(state,{id:'two',name:'Two'},'Where are you currently living?');
    applyDecisions(state,[source],[target],[{source:source.id,target:target.id,confidence:'equivalent',title:'Current residence'}]);
    assert.equal(state.groups.length,status==='written'?1:2);
    if(status==='written') assert.equal(target.questions.length,2);
    else assert.equal(source.review,target.id);
  }
  const state=emptyState(), target=addQuestion(state,{id:'one',name:'One'},'Where are you from?');target.status='written';target.answer='Argentina';
  const source=addQuestion(state,{id:'two',name:'Two'},'Where do you live?');
  applyDecisions(state,[source],[target],[{source:source.id,target:target.id,confidence:'uncertain',title:'Residence'}]);
  assert.equal(state.groups.length,2);assert.equal(source.review,target.id);assert.equal(source.answer,'');
});
