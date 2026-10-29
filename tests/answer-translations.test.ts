import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,addQuestion} from '../server/domain.ts';
import {ApprovedAnswerTranslations,approvedAnswerPresentation,type AnswerTranslationProvider} from '../server/answer-translations.ts';
function setup(provider:AnswerTranslationProvider){const state=emptyState(),group=addQuestion(state,{id:'1',name:'Owner'},'Where are you from?');group.status='written';group.answer='Argentina';group.answerSession=state.liveSession;group.answerScope='session';const worker=new ApprovedAnswerTranslations(state,()=>{},provider);return {state,group,worker};}
test('Only approved answer is translated; original and question remain unchanged; cached results are reused',async()=>{
 let detects=0,translates=0;const {state,group,worker}=setup({detect:async question=>{detects++;assert.equal(question,'¿De dónde sos?');return 'es';},translate:async(answer,language)=>{translates++;assert.equal(answer,'Argentina');assert.equal(language,'es');return 'Soy de Argentina.';}});
 const request={groupId:group.id,language:'detect' as const,questionText:'¿De dónde sos?'};
 assert.equal(worker.request(request,0).status,'pending');assert.deepEqual(approvedAnswerPresentation(state,group,'es'),{text:'',pending:true,failed:false});await worker.tick(0);
 assert.deepEqual(worker.request(request),{status:'ready',text:'Soy de Argentina.',language:'es'});assert.equal(group.answer,'Argentina');assert.equal(group.text,'Where are you from?');assert.equal(approvedAnswerPresentation(state,group,'es').text,'Soy de Argentina.');
 assert.equal(worker.request({groupId:group.id,language:'es'}).status,'ready');await worker.tick();assert.equal(detects,1);assert.equal(translates,1);
});
test('Unsupported or ambiguous question languages never send the original answer',async()=>{
 let translations=0;const {worker,group}=setup({detect:async()=> 'other',translate:async()=>{translations++;return 'Should not run';}});
 const request={groupId:group.id,language:'detect' as const,questionText:'???'};worker.request(request,0);await worker.tick(0);
 assert.equal(worker.request(request).status,'failed');assert.equal(translations,0);
 assert.equal(worker.request({groupId:group.id,language:'detect'}).status,'failed');
});
test('Transient failures use bounded persisted retries, survive restart, and expose failure without original fallback',async()=>{
 let calls=0;const provider:AnswerTranslationProvider={detect:async()=> 'en',translate:async()=>{calls++;throw Error('Provider secret error');}};
 const {state,group,worker}=setup(provider);const request={groupId:group.id,language:'de' as const};worker.request(request,0);await worker.tick(0);await worker.tick(1);assert.equal(calls,1);
 const restarted=new ApprovedAnswerTranslations(state,()=>{},provider);await restarted.tick(20000);await restarted.tick(60000);await restarted.tick(100000);assert.equal(calls,3);
 const result=restarted.request(request);assert.equal(result.status,'failed');assert.ok(!JSON.stringify(result).includes('secret'));
 assert.deepEqual(approvedAnswerPresentation(state,group,'de'),{text:'',pending:false,failed:true});restarted.retry(group.id);assert.equal(restarted.request(request).status,'pending');
});
test('Changed answers and expired live sessions reject stale translations in flight',async()=>{
 let release!:(text:string)=>void;const {state,group,worker}=setup({detect:async()=> 'en',translate:async()=>new Promise(r=>release=r)});
 worker.request({groupId:group.id,language:'en'},0);const tick=worker.tick(0);group.answer='Uruguay';release('Argentina translated');await tick;
 assert.deepEqual(approvedAnswerPresentation(state,group,'en'),{text:'',pending:true,failed:false});assert.equal(worker.request({groupId:group.id,language:'en'}).status,'pending');
 state.liveSession='later';assert.equal(worker.request({groupId:group.id,language:'en'}).status,'failed');assert.equal(approvedAnswerPresentation(state,group,'original').text,'');
});
test('Readonly projection never creates jobs or mutates state',()=>{
 const {state,group}=setup({detect:async()=> 'en',translate:async()=> 'Translated'});const before=JSON.stringify(state);
 assert.equal(approvedAnswerPresentation(state,group,'original').text,'Argentina');assert.equal(approvedAnswerPresentation(state,group,'ru').text,'');assert.equal(JSON.stringify(state),before);
});
