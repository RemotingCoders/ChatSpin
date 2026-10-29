import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../server/domain.ts';
import {bindBudget,reserveAI,flushBudget} from '../server/limits.ts';
import {bindCloudQuota,cloudQuotaPolicy,cloudQuotaReserver} from '../server/cloud-quotas.ts';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'private-test-secret'};
test('Hosted quota policy is operator-controlled and malformed limits fail closed',()=>{
 assert.deepEqual(cloudQuotaPolicy({}),{channelCalls:200,channelTokens:200000,globalCalls:2000,globalTokens:2000000,requireEntitlement:false});
 assert.equal(cloudQuotaPolicy({CHATSPIN_AI_DAILY_GLOBAL_TOKENS:'0'}).globalTokens,0);
 for(const value of ['-1','NaN','1.2','Infinity'])assert.throws(()=>cloudQuotaPolicy({CHATSPIN_AI_DAILY_CHANNEL_CALLS:value}),/Invalid/);
 assert.throws(()=>cloudQuotaReserver('bad',env));
});
test('Cloud reservations reach durable quota service before model work despite editable session budgets',async()=>{
 const s=emptyState();s.settings={aiCallLimit:0,aiTokenLimit:0,retentionDays:30,maxGroups:2000};const events:string[]=[];const requests:any[]=[];
 bindBudget(s,()=>events.push('state queued'),async()=>{events.push('state durable');});
 bindCloudQuota(s,'101',env,(async(input,init)=>{assert.equal(String(input),'https://project.supabase.co/rest/v1/rpc/chatspin_reserve_ai');assert.equal(new Headers(init?.headers).get('apikey'),env.SUPABASE_SECRET_KEY);requests.push(JSON.parse(String(init?.body)));events.push('quota durable');return new Response(null,{status:204});}) as typeof fetch);
 reserveAI(s,50);assert.equal(requests.length,0);await flushBudget(s);events.push('model');
 assert.deepEqual(events,['state queued','state durable','quota durable','model']);
 assert.equal(requests[0].p_channel_calls,200);assert.equal(requests[0].p_channel_id,'101');assert.equal(requests[0].p_tokens,50);
 s.aiBudget={calls:0,tokens:0};s.liveSession='new-session';reserveAI(s,25);await flushBudget(s);assert.equal(requests.length,2);assert.equal(requests[1].p_channel_id,'101');
});
test('Quota denial, entitlement denial, missing migration, and network failures prevent provider calls without leaking bodies',async()=>{
 for(const code of ['PT429','PT403','PGRST202']){
  const s=emptyState();let called=false;bindBudget(s,()=>{});
  bindCloudQuota(s,'101',env,(async()=>Response.json({code,message:'sensitive-body'},{status:code==='PT429'?429:403})) as typeof fetch);
  reserveAI(s,50);await assert.rejects((async()=>{await flushBudget(s);called=true;})(),error=>error instanceof Error&&!error.message.includes('sensitive-body'));
  assert.equal(called,false);
 }
 const reserve=cloudQuotaReserver('101',env,(async()=>{throw Error('private networking payload');}) as typeof fetch);
 await assert.rejects(reserve(10),/service unavailable/);
});
test('Local installations retain editable per-session limits with no cloud service',async()=>{
 const s=emptyState();s.settings={aiCallLimit:1,aiTokenLimit:100,retentionDays:30,maxGroups:2000};reserveAI(s,50);await flushBudget(s);assert.throws(()=>reserveAI(s,10),/budget reached/);
});
