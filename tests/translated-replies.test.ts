import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addQuestion,emptyState} from '../server/domain.ts';
import {ApprovedReplies} from '../server/replies.ts';
import {ApprovedAnswerTranslations,type AnswerTranslationProvider} from '../server/answer-translations.ts';
const viewer={id:'42',name:'Sol',login:'solebarrientos'};
function fixture(provider:AnswerTranslationProvider){
 const state=emptyState(),group=addQuestion(state,{id:'1',name:'Owner'},'Where are you from?');
 group.status='written';group.answer='I am from Argentina.';group.answerScope='session';group.answerSession=state.liveSession;
 const sent:{text:string;parent:string}[]=[];
 const translator=new ApprovedAnswerTranslations(state,()=>{},provider);
 const replies=new ApprovedReplies(()=>state,async(text,parent)=>{sent.push({text,parent});},()=>true,()=>{},(g,questionText)=>translator.request({groupId:g.id,language:'detect',questionText}));
 return {state,group,sent,translator,replies};
}
test('Spanish viewer questions receive only the translated approved answer with the original reply target',async()=>{
 let detects=0,translations=0;
 const {state,group,sent,translator,replies}=fixture({
  detect:async question=>{detects++;assert.equal(question,'¿De qué país sos?');return 'es';},
  translate:async(answer,language)=>{translations++;assert.equal(answer,'I am from Argentina.');assert.equal(language,'es');return 'Soy de Argentina.';}
 });
 assert.equal(replies.enqueue(group,viewer,'spanish-message',Date.now(),'¿De qué país sos?'),true);
 await replies.flush();assert.deepEqual([...sent],[]);assert.equal(state.replyJobs!.length,1);
 await translator.tick(Date.now()+100);await replies.flush();
 assert.deepEqual([...sent],[{text:'@solebarrientos Soy de Argentina.',parent:'spanish-message'}]);
 assert.equal(state.replyJobs!.length,0);assert.equal(group.answer,'I am from Argentina.');assert.equal(state.replyLog!.at(-1)!.status,'Sent');
 // The same language/question/source reuses the cache for another viewer.
 replies.enqueue(group,{id:'43',name:'Other',login:'other'},'second-message',Date.now(),'¿De qué país sos?');await replies.flush();
 assert.equal(sent[1].text,'@other Soy de Argentina.');assert.equal(detects,1);assert.equal(translations,1);
});
test('Repeated flushes while translation is in flight never send the original approved text',async()=>{
 let release!:(text:string)=>void;let translationStarted!:()=>void;
 const started=new Promise<void>(resolve=>translationStarted=resolve);
 const {state,group,sent,translator,replies}=fixture({detect:async()=> 'es',translate:async()=>{translationStarted();return new Promise(resolve=>release=resolve);}});
 replies.enqueue(group,viewer,'pending-message',Date.now(),'¿De dónde sos?');await replies.flush();
 const processing=translator.tick(Date.now()+100);await started;
 await replies.flush();await replies.flush();assert.deepEqual([...sent],[]);assert.equal(state.replyJobs!.length,1);assert.equal(replies.status,'Translating approved reply');
 release('Soy de Argentina.');await processing;await replies.flush();
 assert.deepEqual([...sent],[{text:'@solebarrientos Soy de Argentina.',parent:'pending-message'}]);
});
test('Editing the approved source before public delivery cancels both cached and in-flight reply variants',async()=>{
 for(const inFlight of [false,true]){
  let release!:(text:string)=>void;let translationStarted!:()=>void;
  const started=new Promise<void>(resolve=>translationStarted=resolve);
  const {state,group,sent,translator,replies}=fixture({detect:async()=> 'es',translate:async()=>{translationStarted();return inFlight?new Promise(resolve=>release=resolve):'Soy de Argentina.';}});
  replies.enqueue(group,viewer,'edited-message',Date.now(),'¿De dónde sos?');await replies.flush();
  const processing=translator.tick(Date.now()+100);await started;
  if(!inFlight)await processing;
  group.answer='I am from Uruguay.';
  if(inFlight){release('Soy de Argentina.');await processing;}
  await replies.flush();assert.deepEqual([...sent],[]);assert.equal(state.replyJobs!.length,0);assert.equal(group.answer,'I am from Uruguay.');assert.equal(state.replyLog!.at(-1)!.status,'Cancelled or expired');
 }
});
test('Unsupported question languages withhold the reply, preserve the approved answer, and record why',async()=>{
 let translated=0;
 const {state,group,sent,translator,replies}=fixture({detect:async()=> 'other',translate:async()=>{translated++;return 'Must not be sent';}});
 replies.enqueue(group,viewer,'unsupported-message',Date.now(),'どちらの国の出身ですか？');await replies.flush();await translator.tick(Date.now()+100);await replies.flush();
 assert.deepEqual([...sent],[]);assert.equal(translated,0);assert.equal(state.replyJobs!.length,0);assert.equal(group.answer,'I am from Argentina.');
 assert.match(state.replyLog!.at(-1)!.status,/Reply withheld.*unsupported/);
});
