import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {addQuestion,emptyState,reviewVersion} from '../server/domain.ts';
import {cloudDashboardAction} from '../server/cloud-actions.ts';
import {applyExtensionAction} from '../extension/server/service.ts';
import {ApprovedAnswerTranslations} from '../server/answer-translations.ts';
import {processCloudChannel} from '../server/cloud-work.ts';
import {database} from './fixtures/cloud-db.ts';
import {ApprovedReplies} from '../server/replies.ts';
import {TwitchConnection} from '../server/twitch.ts';
import {unsubscribeCloudChat,webhookSecret} from '../server/cloud-twitch.ts';
import {createCloudApp} from '../server/cloud.ts';
import {createHmac} from 'node:crypto';
import {translationSource} from '../server/presentation.ts';
import {OBSView} from '../src/OBSView.tsx';
const user={id:'101',name:'Owner'};

test('Cloud replies without an AI key send the approved original instead of waiting for translation',async()=>{
 const oldKey=process.env.OPENAI_API_KEY,oldFetch=globalThis.fetch;delete process.env.OPENAI_API_KEY;
 const {repository}=database();let sent=0;
 globalThis.fetch=(async(input,init)=>{
  if(String(input).includes('/validate'))return Response.json({user_id:'101',client_id:process.env.TWITCH_CLIENT_ID});
  assert.ok(String(input).includes('/chat/messages'));assert.match(String(init?.body),/Approved original/);sent++;return Response.json({data:[{is_sent:true}]});
 }) as typeof fetch;
 try{
  await repository.putSecret('101','twitch',{access_token:'test',refresh_token:'test',expires_in:3600,scope:['user:write:chat']});
  await repository.mutate('101',s=>{const g=addQuestion(s,user,'Question?');g.answer='Approved original';g.status='written';g.answerScope='permanent';s.cloudMaintenance=Date.now();new ApprovedReplies(()=>s,async()=>{},()=>true,()=>{}).enqueue(g,user,'message',Date.now(),'Question?');});
  await processCloudChannel(repository,'101');assert.equal(sent,1);assert.equal((await repository.load('101')).state.replyJobs?.length,0);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});

test('One inference resolves language and answer; same-language replies preserve text and reuse cache',async()=>{
 const s=emptyState(),g=addQuestion(s,user,'Where?');g.answer='From Argentina.';g.status='written';g.answerScope='permanent';let calls=0;
 const worker=new ApprovedAnswerTranslations(s,()=>{},{resolve:async(q,a)=>{calls++;assert.equal(q,'Where?');return {language:'en',text:a};},detect:async()=>{throw Error('Second inference');},translate:async()=>{throw Error('Second inference');}});
 const request={groupId:g.id,language:'detect' as const,questionText:'Where?'};worker.request(request,0);await worker.tick(0);
 assert.deepEqual(worker.request(request),{status:'ready',language:'en',text:g.answer});assert.equal(calls,1);
 assert.equal(worker.request({groupId:g.id,language:'en'}).status,'ready');
});

test('Dashboard and extension reject stale moderator edits without changing the saved answer',()=>{
 const s=emptyState(),g=addQuestion(s,user,'Question?'),expected=reviewVersion(g);g.answer='Moderator answer';g.status='written';
 for(const run of [()=>cloudDashboardAction(s,user,{type:'answer',id:g.id,text:'Old draft',expected}),()=>applyExtensionAction(s,{controller:true,anonymous:false,user},{type:'answer',id:g.id,text:'Old draft',expected},()=>{})])assert.throws(run,(e:any)=>e.status===409);
 assert.equal(g.answer,'Moderator answer');
 cloudDashboardAction(s,user,{type:'answer',id:g.id,text:'Fresh edit',expected:reviewVersion(g)});assert.equal(g.answer,'Fresh edit');
});

test('Validation failures are client errors with actionable messages',()=>{
 const s=emptyState();for(const body of [{type:'spin'},{type:'clear-questions'},{type:'new-session'},{type:'answer',id:'missing',text:'answer'}])assert.throws(()=>cloudDashboardAction(s,user,body),(e:any)=>e.status===400);
 assert.throws(()=>applyExtensionAction(s,{controller:true,anonymous:false,user},{type:'spin'},()=>{}),(e:any)=>e.status===400);
});

test('Failed token refresh stops permanently on revoked credentials and bounds transient retries',async()=>{
 const previous=globalThis.fetch;
 try{for(const status of [400,503]){let removed=false;const client=new TwitchConnection({access_token:'old',refresh_token:'bad',expires_in:0},'101',()=>{},undefined,c=>{removed=c===null;});globalThis.fetch=(async()=>new Response('{}',{status})) as typeof fetch;
  for(let i=0;i<(status===400?1:5);i++)await assert.rejects(client.token());
  assert.match(client.status,/Connect again/);assert.equal(removed,status===400);client.stop();
 }}finally{globalThis.fetch=previous;}
});

test('OBS does not repeat identical result title and description',()=>{
 const s=emptyState();const result={id:'s',mode:'questions' as const,start:0,end:1,winner:'g',label:'Where are you from?',text:'Where are you from?',candidates:[]};
 const html=renderToStaticMarkup(createElement(OBSView,{state:null,error:'',presentation:{entries:[],spin:null},clock:0,inSpin:false,result}));assert.equal(html.split('Where are you from?').length-1,1);
});

test('Invalid overlay signatures never create channel rows; translated title edits use the configured language',async()=>{
 const {repository,channels}=database(),origin='https://chatspin.example',secret='a'.repeat(40);
 const id='session';await repository.setSession(id,{cookie:{expires:new Date(Date.now()+3600000).toISOString()},user},Date.now()+3600000);
 const signature=createHmac('sha256',secret).update(id).digest('base64').replace(/=+$/,'');const cookie='chatspin.sid='+encodeURIComponent('s:'+id+'.'+signature);
 const server=createCloudApp(repository,origin,secret,()=>{}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 try{
  const response=await fetch(base+'/api/overlay?token=999:0:'+ 'a'.repeat(64));assert.equal(response.status,403);assert.equal(channels.size,0);
  let groupId='';await repository.mutate('101',s=>{const g=addQuestion(s,user,'¿De dónde?');groupId=g.id;g.translations={en:{source:translationSource(g),text:'Where from?',title:'Origin'}};});
  await repository.putSecret('101','question-language','en');
  const edit=await fetch(base+'/api/action',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Forwarded-Proto':'https','Content-Type':'application/json'},body:JSON.stringify({type:'edit',id:groupId,value:'en',title:'Country'})});assert.equal(edit.status,200,await edit.text());assert.equal((await repository.load('101')).state.groups[0].translations?.en?.title,'Country');
  const raw=' { "challenge" : "exact bytes", "subscription": {"type":"channel.chat.message","condition":{"broadcaster_user_id":"101"}} }\n';const timestamp=new Date().toISOString(),message='bytes';const sig='sha256='+createHmac('sha256',webhookSecret(secret,'101')).update(message+timestamp+raw).digest('hex');
  const event=await fetch(base+'/api/twitch/events/101',{method:'POST',headers:{'Content-Type':'application/json','twitch-eventsub-message-id':message,'twitch-eventsub-message-timestamp':timestamp,'twitch-eventsub-message-signature':sig,'twitch-eventsub-message-type':'webhook_callback_verification'},body:raw});assert.equal(event.status,200);assert.equal(await event.text(),'exact bytes');
 }finally{server.close();server.closeAllConnections();}
});

test('Disconnect deletes only owned EventSub subscriptions and persists cleanup failures for retry',async()=>{
 const {repository}=database(),previous=globalThis.fetch;const removed:string[]=[];
 const owned={id:'owned',type:'channel.chat.message',condition:{broadcaster_user_id:'101',user_id:'101'},transport:{method:'webhook',callback:'https://chatspin.example/api/twitch/events/101'}};
 globalThis.fetch=(async(input,init)=>{const url=String(input);if(url.includes('oauth2'))return Response.json({access_token:'test'});if(init?.method==='DELETE'){removed.push(url);return new Response(null,{status:204});}return Response.json({data:[owned,{...owned,id:'another-app',transport:{method:'webhook',callback:'https://another.example'}}]});}) as typeof fetch;
 try{await unsubscribeCloudChat(repository,'101','https://chatspin.example');assert.equal(removed.length,1);assert.match(removed[0],/id=owned/);
 globalThis.fetch=(async()=>new Response('{}',{status:503})) as typeof fetch;await assert.rejects(unsubscribeCloudChat(repository,'101','https://chatspin.example'));assert.ok(await repository.getSecret('101','eventsub-cleanup'));
 }finally{globalThis.fetch=previous;}
});

test('Startup validation retries after a transient outage and actually starts the connection',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const previous=globalThis.fetch;let calls=0,starts=0;
 const client=new TwitchConnection({access_token:'test',refresh_token:'test',expires_in:3600},'101',()=>{});
 client.start=async()=>{starts++;client.status='Connected';};
 globalThis.fetch=(async()=>{if(++calls===1)throw Error('Network down');return Response.json({user_id:'101',client_id:process.env.TWITCH_CLIENT_ID});}) as typeof fetch;
 try{await client.connect();assert.equal(starts,0);assert.match(client.status,/retrying/);t.mock.timers.tick(5000);await new Promise<void>(r=>setImmediate(r));assert.equal(starts,1);assert.equal(client.status,'Connected');}finally{client.stop();t.mock.timers.reset();globalThis.fetch=previous;}
});
