import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addQuestion as addRawQuestion,demoState,emptyState,eligibleEntries,spin} from '../server/domain.ts';
import {questionPresentation,presentedSpin,translationSource} from '../server/presentation.ts';
import {TranslationWork} from '../server/translation.ts';

test('Original mode preserves the actual question language instead of the English AI title',()=>{
 const s=emptyState(),g=addQuestion(s,{id:'a',name:'A'},'¿Cómo empezaste a transmitir?');g.title='Starting streaming';
 assert.equal(questionPresentation(s,g).title,g.text);assert.equal(eligibleEntries(s)[0].label,g.text);
});
test('Every forced language uses a separate cached translation without mutating originals',()=>{
 const s=emptyState(),g=addQuestion(s,{id:'a',name:'A'},'¿Qué estás construyendo?');
 for(const language of ['en','es','ru','de'] as const){s.questionLanguage=language;g.translations||={};g.translations[language]={source:translationSource(g),text:`${language} question`,title:`${language} title`};assert.equal(questionPresentation(s,g).text,`${language} question`);assert.equal(eligibleEntries(s)[0].label,`${language} title`);}
 assert.equal(g.questions[0].text,'¿Qué estás construyendo?');s.questionLanguage='original';assert.equal(questionPresentation(s,g).text,g.text);
});
test('Translations populate queue, spotlight and OBS-compatible snapshots but freeze active draws',()=>{
 const s=emptyState(),g=addQuestion(s,{id:'a',name:'A'},'Where are you from?');const draw=spin(s,g.id);s.questionLanguage='es';g.translations={es:{source:translationSource(g),text:'¿De dónde sos?',title:'Origen'}};
 const translated=presentedSpin(s)!;assert.equal(translated.text,'¿De dónde sos?');assert.equal(translated.candidates[0].label,'Origen');
 draw.end=Date.now()+6000;assert.equal(presentedSpin(s)!.text,'Where are you from?');
});
test('Edited sources invalidate cached translations and stale in-flight results are discarded',async()=>{
 const s=emptyState(),g=addQuestion(s,{id:'a',name:'A'},'A question?');s.questionLanguage='de';let release!:(value:{id:string;text:string;title:string}[])=>void;
 const worker=new TranslationWork(s,()=>{},async()=>new Promise(r=>release=r));const tick=worker.tick();g.customTitle='Edited title';release([{id:g.id,text:'Alte Frage?',title:'Alter Titel'}]);await tick;assert.equal(g.translations?.de,undefined);assert.equal(questionPresentation(s,g).pending,true);
});
test('Translation failures preserve originals and retry with a bounded persisted backoff',async()=>{
 const s=emptyState(),g=addQuestion(s,{id:'a',name:'A'},'A question?');s.questionLanguage='ru';let calls=0;
 const worker=new TranslationWork(s,()=>{},async()=>{calls++;throw Error('Offline');});await worker.tick(1000);await worker.tick(1001);assert.equal(calls,1);assert.equal(g.translationAttempts!.ru!.attempts,1);assert.equal(questionPresentation(s,g).text,g.text);
 worker.retry();assert.deepEqual(g.translationAttempts,{});
});

function addQuestion(...args: Parameters<typeof addRawQuestion>){const g=addRawQuestion(...args);g.aiProcessed=true;return g;}
