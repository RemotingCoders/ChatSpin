import type {State} from './domain.js';
import {bindProviderBudget} from './limits.js';
export type CloudQuotaPolicy={channelCalls:number;channelTokens:number;globalCalls:number;globalTokens:number;requireEntitlement:boolean};
export function cloudQuotaPolicy(env:NodeJS.ProcessEnv=process.env):CloudQuotaPolicy{
 const integer=(key:string,fallback:number)=>{const raw=env[key];if(raw===undefined||raw==='')return fallback;const value=Number(raw);if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid hosted AI quota configuration.');return value;};
 return {channelCalls:integer('CHATSPIN_AI_DAILY_CHANNEL_CALLS',200),channelTokens:integer('CHATSPIN_AI_DAILY_CHANNEL_TOKENS',200000),globalCalls:integer('CHATSPIN_AI_DAILY_GLOBAL_CALLS',2000),globalTokens:integer('CHATSPIN_AI_DAILY_GLOBAL_TOKENS',2000000),requireEntitlement:env.CHATSPIN_REQUIRE_ENTITLEMENT==='true'};
}
// Reservations are intentionally conservative: failed/unknown provider outcomes
// are charged, and unused estimated tokens are not refunded. They cannot be reset
// by starting a new live session or by changing channel state.
export function cloudQuotaReserver(channel:string,env:NodeJS.ProcessEnv=process.env,request:typeof fetch=fetch){
 if(!/^\d{1,30}$/.test(channel))throw Error('Invalid quota channel.');
 const policy=cloudQuotaPolicy(env);
 const origin=new URL(env.SUPABASE_URL||'');
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password||!env.SUPABASE_SECRET_KEY)throw Error('Hosted AI quotas are not configured.');
 return async(tokens:number)=>{
  if(!Number.isSafeInteger(tokens)||tokens<0)throw Error('Invalid AI reservation.');
  let response:Response;
  try{response=await request(origin.origin+'/rest/v1/rpc/chatspin_reserve_ai',{method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY!,'Content-Type':'application/json'},body:JSON.stringify({p_channel_id:channel,p_tokens:tokens,p_channel_calls:policy.channelCalls,p_channel_tokens:policy.channelTokens,p_global_calls:policy.globalCalls,p_global_tokens:policy.globalTokens,p_require_entitlement:policy.requireEntitlement}),signal:AbortSignal.timeout(15000)});}catch{throw Error('Hosted AI quota service unavailable. No AI request was sent.');}
  if(!response.ok){let code='';try{code=(await response.json()).code;}catch{}
   if(code==='PT429')throw Error('Hosted AI allowance exhausted. Contact the service operator or wait for the daily reset.');
   if(code==='PT403')throw Error('AI access is disabled for this channel. Contact the service operator.');
   throw Error('Hosted AI quota service unavailable. Check the quota migration; no AI request was sent.');
  }
 };
}
export function bindCloudQuota(state:State,channel:string,env:NodeJS.ProcessEnv=process.env,request:typeof fetch=fetch){bindProviderBudget(state,tokens=>cloudQuotaReserver(channel,env,request)(tokens));}
