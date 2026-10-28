import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Repository,PersistentSessions,validateState} from '../server/storage.ts';
import {addQuestion,emptyState,answerIsActive} from '../server/domain.ts';
import {reserveAI,retain} from '../server/limits.ts';
import {ApprovedReplies} from '../server/replies.ts';
import {SerializedLoader} from '../src/api.ts';
import {cosine} from '../server/ai.ts';

test('SQLite imports legacy state, persists private tokens and sessions, and keeps the OBS link across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chatspin-store-'));const file=join(dir,'state.json');let repo:Repository|undefined;
 try {
  const s=emptyState();addQuestion(s,{id:'a',name:'A'},'Question?');writeFileSync(file,JSON.stringify(s));
  repo=new Repository(file);assert.equal(repo.load().groups.length,1);repo.save(s);repo.putSecret('twitch',{access_token:'test-secret'});repo.putSecret('obs',{real:'stable-link'});
  const store=new PersistentSessions(repo);await new Promise<void>((resolve,reject)=>store.set('session',{cookie:{expires:new Date(Date.now()+60000)},user:{id:'a',name:'A'}} as never,error=>error?reject(error):resolve()));
  assert.ok(!readFileSync(file+'.sqlite').includes(Buffer.from('test-secret')));repo.db.close();repo=new Repository(file);
  assert.deepEqual(repo.getSecret('obs'),{real:'stable-link'});assert.deepEqual(repo.getSecret('twitch'),{access_token:'test-secret'});
  const restored=await new Promise<any>((resolve,reject)=>new PersistentSessions(repo!).get('session',(error,value)=>error?reject(error):resolve(value)));assert.equal(restored.user.id,'a');
 }finally{repo?.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Invalid state fails validation and can recover from a valid backup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'chatspin-recover-'));let repo:Repository|undefined;
 try{const file=join(dir,'state.json');writeFileSync(file,'invalid');repo=new Repository(file,'test-key');assert.throws(()=>repo!.load(),/invalid/);mkdirSync(join(dir,'backups'));writeFileSync(join(dir,'backups','session-1.json'),JSON.stringify(emptyState()));assert.deepEqual(repo.load().groups,[]);assert.throws(()=>validateState({...emptyState(),aiJobs:'broken'}));
 const s=emptyState();repo.save(s);repo.snapshot(s);repo.db.prepare('UPDATE records SET value=? WHERE id=?').run('{}','state');assert.equal(repo.load().mode,'questions');
 }finally{repo?.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Session-only answers expire while permanent answers remain active',()=>{
 const s=emptyState();s.liveSession='one';const g=addQuestion(s,{id:'a',name:'A'},'Where do you live?');g.status='written';g.answer='Argentina';g.answerSession='one';assert.ok(answerIsActive(s,g));s.liveSession='two';assert.equal(answerIsActive(s,g),false);g.answerScope='permanent';assert.ok(answerIsActive(s,g));
});
test('AI reservations enforce hard ceilings even on failed calls and retention removes old groups',()=>{
 const s=emptyState();s.settings={aiCallLimit:2,aiTokenLimit:100,retentionDays:30,maxGroups:10};const settle=reserveAI(s,60);assert.throws(()=>reserveAI(s,50),/budget/);settle(10);reserveAI(s,50);assert.throws(()=>reserveAI(s,1),/budget/);
 addQuestion(s,{id:'a',name:'A'},'Old?',undefined,Date.now()-31*86400000);addQuestion(s,{id:'b',name:'B'},'New?');assert.equal(retain(s),true);assert.equal(s.groups.length,1);
});
test('Public replies can be paused and queued jobs and history survive queue recreation',async()=>{
 const s=emptyState(),g=addQuestion(s,{id:'a',name:'A'},'Question?');g.status='written';g.answer='Approved';let sent=0;
 const create=()=>new ApprovedReplies(()=>s,async()=>{sent++;},()=>true,()=>{});
 create().enqueue(g,{id:'b',name:'B'},'message');s.repliesPaused=true;await create().flush();assert.equal(sent,0);s.repliesPaused=false;await create().flush();assert.equal(sent,1);assert.equal(s.replyLog!.at(-1)!.status,'Sent');
});
test('Forced workspace reload waits for the old poll and reads again without overlap',async()=>{
 let active=0,max=0,calls=0;const releases:(()=>void)[]=[];
 const loader=new SerializedLoader(async()=>{calls++;max=Math.max(max,++active);await new Promise<void>(r=>releases.push(r));active--;});
 const poll=loader.load(),action=loader.load(true);releases.shift()!();await poll;await new Promise(r=>setImmediate(r));assert.equal(calls,2);releases.shift()!();await action;assert.equal(max,1);
});
test('Semantic ranking uses vector direction rather than shared wording',()=>{assert.ok(cosine([1,0],[0.9,0.1])>cosine([1,0],[0,1]));assert.equal(cosine([],[]),0);});

test('Twitch HTTP requests abort instead of holding the reply queue indefinitely',async()=>{
 const {timedFetch}=await import('../server/http.ts');const before=globalThis.fetch;
 globalThis.fetch=((_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason));})) as typeof fetch;
 const keepAlive=setInterval(()=>{},100);
 try{await assert.rejects(timedFetch('https://example.invalid',{},10),/timeout|aborted/i);}finally{clearInterval(keepAlive);globalThis.fetch=before;}
});

test('A second process cannot start against the same live database',async()=>{
 const {spawnSync}=await import('node:child_process');const dir=mkdtempSync(join(tmpdir(),'chatspin-lock-'));const file=join(dir,'state.json');const repo=new Repository(file,'test-key');
 try{const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {Repository} from './server/storage.ts';new Repository(${JSON.stringify(file)},'test-key');`],{encoding:'utf8'});assert.notEqual(child.status,0);assert.match(child.stderr,/Another ChatSpin process/);}finally{repo.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Rotating the encryption secret expires old browser sessions without blocking sign-in',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chatspin-key-'));const file=join(dir,'state.json');let repo=new Repository(file,'old-secret');
 try{await new Promise<void>((resolve,reject)=>new PersistentSessions(repo).set('old-session',{cookie:{expires:new Date(Date.now()+60000)},user:{id:'a',name:'A'}} as never,error=>error?reject(error):resolve()));repo.db.close();repo=new Repository(file,'new-secret');
 const value=await new Promise((resolve,reject)=>new PersistentSessions(repo).get('old-session',(error,value)=>error?reject(error):resolve(value)));assert.equal(value,null);
 }finally{repo.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Offline restore can recover an invalid legacy file from an explicitly chosen backup',async()=>{
 const {spawnSync}=await import('node:child_process');const dir=mkdtempSync(join(tmpdir(),'chatspin-restore-')),file=join(dir,'state.json'),backup=join(dir,'chosen.json');
 try{writeFileSync(file,'invalid original');const state=emptyState();addQuestion(state,{id:'a',name:'A'},'Restored question?');writeFileSync(backup,JSON.stringify(state));
 const result=spawnSync(process.execPath,['--import','tsx','server/restore.ts',backup],{encoding:'utf8',env:{...process.env,DATA_FILE:file,SESSION_SECRET:'restore-test'}});assert.equal(result.status,0,result.stderr);const repo=new Repository(file,'restore-test');try{assert.equal(repo.load().groups[0].text,'Restored question?');assert.equal(readFileSync(file,'utf8'),'invalid original');}finally{repo.db.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
