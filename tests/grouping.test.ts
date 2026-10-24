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
