import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {emptyState,type State} from './domain.js';
import {rebase,RebaseConflict} from './rebase.js';
import {validateState} from './storage.js';

export class StateConflict extends Error {constructor(){super('Channel changed. Please try again.');}}
export type CloudLease={id:string;until:number};
export type CloudState=State&{moderatorIds?:string[];cloudLease?:CloudLease;cloudRates?:Record<string,number[]>;cloudMaintenance?:number;cloudStatus?:{ai:string;translation:string};cloudTranslations?:Record<string,number>};
export class ChannelBusy extends Error {status=409;constructor(){super('Channel is processing. Please try again shortly.');}}
export type ChannelState={channelId:string;revision:number;state:CloudState};
export class SupabaseRepository {
 private bases=new WeakMap<ChannelState,CloudState>();
 private workers=new WeakMap<ChannelState,string>();
 private views=new Map<string,{until:number;promise:Promise<ChannelState>}>();
 private settingsCache=new Map<string,{until:number;promise:Promise<unknown>}>();
 private key:Buffer;
 private origin:string;
 constructor(url:string,private secret:string,sessionSecret:string,private request:typeof fetch=fetch){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw Error('SUPABASE_URL must be an HTTPS project origin.');
  if(!secret)throw Error('SUPABASE_SECRET_KEY is missing.');
  if(sessionSecret.length<32||sessionSecret==='replace-with-a-long-random-secret')throw Error('SESSION_SECRET must be a random production secret of at least 32 characters.');
  this.origin=parsed.origin;this.key=createHash('sha256').update(sessionSecret).digest();
 }
 private channel(value:string){if(!/^\d{1,30}$/.test(value))throw Error('Invalid Twitch channel.');return value;}
 private async api(path:string,init:RequestInit={}){
  const response=await this.request(this.origin+'/rest/v1/'+path,{...init,headers:{apikey:this.secret,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)});
  if(!response.ok){let code='';try{code=(await response.json()).code;}catch{}
   if(code==='PT409'||code==='40001')throw new StateConflict();
   // Never surface provider bodies: they may contain submitted data or configuration.
   throw Error('ChatSpin database request failed. Check server configuration and migration.');
  }
  const text=await response.text();return text?JSON.parse(text):undefined;
 }
 async load(channelId:string):Promise<ChannelState>{
  const id=this.channel(channelId),filter='channel_id=eq.'+id;
  let rows=await this.api('chatspin_channels?'+filter+'&select=channel_id,state,revision');
  if(!rows.length){const state=emptyState();state.liveSession=randomBytes(12).toString('hex');
   await this.api('chatspin_channels?on_conflict=channel_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({channel_id:id,state})});
   rows=await this.api('chatspin_channels?'+filter+'&select=channel_id,state,revision');
  }
  if(rows.length!==1||!Number.isSafeInteger(rows[0].revision))throw Error('Invalid channel storage.');
  const record={channelId:id,revision:rows[0].revision,state:validateState(rows[0].state)};this.bases.set(record,structuredClone(record.state));return record;
 }
 async view(channelId:string){
  const now=Date.now(),cached=this.views.get(channelId);if(cached&&cached.until>now)return structuredClone(await cached.promise);
  if(this.views.size>500)for(const [id,item]of this.views)if(item.until<=now)this.views.delete(id);
  const promise=this.load(channelId);this.views.set(channelId,{until:now+2000,promise});
  try{return structuredClone(await promise);}catch(error){this.views.delete(channelId);throw error;}
 }
 async commit(record:ChannelState,snapshot=false){
  this.channel(record.channelId);validateState(record.state);
  const owner=this.workers.get(record),base=this.bases.get(record);
  for(let attempt=0;attempt<4;attempt++){
   let state=record.state,revision=record.revision;
   if(owner){
    const fresh=await this.load(record.channelId);
    if(fresh.state.cloudLease?.id!==owner||fresh.state.cloudLease.until<=Date.now())throw new StateConflict();
    try{state=rebase(base,record.state,fresh.state);}catch(error){if(error instanceof RebaseConflict)throw new StateConflict();throw error;}
    revision=fresh.revision;
   }
   try{
    const next=await this.api('rpc/chatspin_commit',{method:'POST',body:JSON.stringify({p_channel_id:record.channelId,p_revision:revision,p_state:state,p_snapshot:snapshot})});
    if(!Number.isSafeInteger(next))throw Error('Invalid channel revision.');
    record.revision=next;
    // Preserve the state object's identity: processors hold a reference to it.
    if(state!==record.state){for(const key of Object.keys(record.state))delete (record.state as any)[key];Object.assign(record.state,state);}
    this.bases.set(record,structuredClone(record.state));this.views.delete(record.channelId);return;
   }catch(error){if(!owner||!(error instanceof StateConflict)||attempt===3)throw error;}
  }
 }
 async mutate<T>(channelId:string,change:(s:CloudState)=>T,snapshot=false):Promise<T>{
  for(let attempt=0;attempt<4;attempt++){
   const record=await this.load(channelId);if(record.state.cloudLease&&record.state.cloudLease.until<=Date.now())delete record.state.cloudLease;const result=change(record.state);
   try{await this.commit(record,snapshot);return result;}catch(error){if(!(error instanceof StateConflict)||attempt===3)throw error;}
  }
  throw new StateConflict();
 }
 async acquire(channelId:string):Promise<ChannelState>{
  const record=await this.load(channelId);
  if(record.state.cloudLease&&record.state.cloudLease.until>Date.now())throw new ChannelBusy();
  record.state.cloudLease={id:randomBytes(16).toString('hex'),until:Date.now()+180000};
  await this.commit(record);this.workers.set(record,record.state.cloudLease!.id);return record;
 }
 async release(record:ChannelState){
  const owner=this.workers.get(record);if(!owner)return;
  await this.mutate(record.channelId,s=>{if(s.cloudLease?.id===owner)delete s.cloudLease;});this.workers.delete(record);
 }
 async secretRecord<T>(channelId:string,name:string):Promise<{value:T;version:string}|undefined>{
  const rows=await this.api('chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=eq.'+encodeURIComponent(name)+'&select=ciphertext');
  return rows.length?{value:this.unseal<T>(rows[0].ciphertext),version:rows[0].ciphertext}:undefined;
 }
 async replaceSecret(channelId:string,name:string,version:string,value:unknown){
  const ciphertext=this.seal(value),path='chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=eq.'+encodeURIComponent(name)+'&ciphertext=eq.'+encodeURIComponent(version);
  const rows=await this.api(path,{method:value===null?'DELETE':'PATCH',headers:{Prefer:'return=representation'},...(value===null?{}:{body:JSON.stringify({ciphertext})})});
  return rows?.length===1?ciphertext:undefined;
 }
 async rate(channelId:string,userId:string){
  await this.mutate(channelId,s=>{const now=Date.now();s.cloudRates||={};for(const [id,times]of Object.entries(s.cloudRates))if(!times.some(t=>t>now-60000))delete s.cloudRates[id];const recent=(s.cloudRates[userId]||[]).filter(t=>t>now-60000);if(recent.length>=30)throw Object.assign(Error('Please wait before sending more actions.'),{status:429});recent.push(now);s.cloudRates[userId]=recent;});
 }
 seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');}
 unseal<T>(value:string):T{const bytes=Buffer.from(value,'base64');if(bytes.length<29)throw Error('Invalid encrypted record.');const cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString());}
 async publicSetting<T>(channel:string,name:'question-language'|'chat-status'){
  const key=channel+':'+name,now=Date.now(),cached=this.settingsCache.get(key);if(cached&&cached.until>now)return structuredClone(await cached.promise) as T|undefined;
  if(this.settingsCache.size>1000)for(const [id,row]of this.settingsCache)if(row.until<=now)this.settingsCache.delete(id);
  const promise=this.getSecret<T>(channel,name);this.settingsCache.set(key,{until:now+5000,promise});
  try{return structuredClone(await promise);}catch(error){this.settingsCache.delete(key);throw error;}
 }
 async putSecret(channelId:string,name:string,value:unknown){this.settingsCache.delete(channelId+':'+name);await this.api('chatspin_secrets?on_conflict=channel_id,name',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({channel_id:this.channel(channelId),name,ciphertext:this.seal(value)})});}
 async getSecret<T>(channelId:string,name:string):Promise<T|undefined>{const rows=await this.api('chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=eq.'+encodeURIComponent(name)+'&select=ciphertext');return rows.length?this.unseal<T>(rows[0].ciphertext):undefined;}
 async removeSecret(channelId:string,name:string){await this.api('chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=eq.'+encodeURIComponent(name),{method:'DELETE'});}
 async inbox(channelId:string):Promise<{name:string;value:unknown}[]>{const rows=await this.api('chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=like.inbox:*&select=name,ciphertext&limit=100');return rows.map((row:{name:string;ciphertext:string})=>({name:row.name,value:this.unseal(row.ciphertext)}));}
 async listChannels():Promise<string[]>{const rows=await this.api('chatspin_channels?select=channel_id&order=updated_at.asc&limit=20');return rows.map((row:{channel_id:string})=>this.channel(row.channel_id));}
 async backups(channel:string){
  const rows=await this.api('chatspin_snapshots?channel_id=eq.'+this.channel(channel)+'&select=id,created_at,state&order=id.desc&limit=20');
  return rows.map((row:any)=>({id:String(row.id),createdAt:row.created_at,groups:row.state.groups.length,participants:row.state.participants.length}));
 }
 async backup(channel:string,id:string){
  if(!/^\d{1,20}$/.test(id))throw Error('Invalid backup.');
  const rows=await this.api('chatspin_snapshots?channel_id=eq.'+this.channel(channel)+'&id=eq.'+id+'&select=id,created_at,state');
  if(rows.length!==1)throw Object.assign(Error('Backup not found.'),{status:404});return {id:String(rows[0].id),createdAt:rows[0].created_at,state:validateState(rows[0].state)};
 }
 async cleanupSessions(){await this.api('chatspin_sessions?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE'});}
 async setSession(id:string,value:unknown,expires:number){await this.api('chatspin_sessions?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id,ciphertext:this.seal(value),expires_at:new Date(expires).toISOString()})});}
 async getSession<T>(id:string):Promise<T|undefined>{const rows=await this.api('chatspin_sessions?id=eq.'+encodeURIComponent(id)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=ciphertext');return rows.length?this.unseal<T>(rows[0].ciphertext):undefined;}
 async destroySession(id:string){await this.api('chatspin_sessions?id=eq.'+encodeURIComponent(id),{method:'DELETE'});}
}
