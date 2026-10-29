import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {emptyState,type State} from './domain.js';
import {validateState} from './storage.js';

export class StateConflict extends Error {constructor(){super('Channel changed. Please try again.');}}
export type CloudLease={id:string;until:number};
export type CloudState=State&{cloudLease?:CloudLease;cloudRates?:Record<string,number[]>;cloudMaintenance?:number;cloudTranslations?:Record<string,number>};
export class ChannelBusy extends Error {status=409;constructor(){super('Channel is processing. Please try again shortly.');}}
export type ChannelState={channelId:string;revision:number;state:CloudState};
export class SupabaseRepository {
 private key:Buffer;
 private origin:string;
 constructor(url:string,private secret:string,sessionSecret:string,private request:typeof fetch=fetch){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw Error('SUPABASE_URL must be an HTTPS project origin.');
  if(!secret||sessionSecret.length<32||sessionSecret==='replace-with-a-long-random-secret')throw Error('Configure SUPABASE_SECRET_KEY and a strong SESSION_SECRET.');
  this.origin=parsed.origin;this.key=createHash('sha256').update(sessionSecret).digest();
 }
 private channel(value:string){if(!/^\d{1,30}$/.test(value))throw Error('Invalid Twitch channel.');return value;}
 private async api(path:string,init:RequestInit={}){
  const response=await this.request(this.origin+'/rest/v1/'+path,{...init,headers:{apikey:this.secret,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)});
  if(!response.ok){let code='';try{code=(await response.json()).code;}catch{}
   if(code==='40001')throw new StateConflict();
   // Never surface provider bodies: they may contain submitted data or configuration.
   throw Error('ChatSpin database request failed. Check server configuration and migration.');
  }
  return response.status===204?undefined:response.json();
 }
 async load(channelId:string):Promise<ChannelState>{
  const id=this.channel(channelId),filter='channel_id=eq.'+id;
  let rows=await this.api('chatspin_channels?'+filter+'&select=channel_id,state,revision');
  if(!rows.length){const state=emptyState();state.liveSession=randomBytes(12).toString('hex');
   await this.api('chatspin_channels?on_conflict=channel_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({channel_id:id,state})});
   rows=await this.api('chatspin_channels?'+filter+'&select=channel_id,state,revision');
  }
  if(rows.length!==1||!Number.isSafeInteger(rows[0].revision))throw Error('Invalid channel storage.');
  return {channelId:id,revision:rows[0].revision,state:validateState(rows[0].state)};
 }
 async commit(record:ChannelState,snapshot=false){
  this.channel(record.channelId);validateState(record.state);
  const revision=await this.api('rpc/chatspin_commit',{method:'POST',body:JSON.stringify({p_channel_id:record.channelId,p_revision:record.revision,p_state:record.state,p_snapshot:snapshot})});
  if(!Number.isSafeInteger(revision))throw Error('Invalid channel revision.');record.revision=revision;
 }
 async mutate<T>(channelId:string,change:(s:CloudState)=>T,snapshot=false):Promise<T>{
  for(let attempt=0;attempt<4;attempt++){
   const record=await this.load(channelId);if(record.state.cloudLease&&record.state.cloudLease.until>Date.now())throw new ChannelBusy();delete record.state.cloudLease;const result=change(record.state);
   try{await this.commit(record,snapshot);return result;}catch(error){if(!(error instanceof StateConflict)||attempt===3)throw error;}
  }
  throw new StateConflict();
 }
 async acquire(channelId:string):Promise<ChannelState>{
  const record=await this.load(channelId);
  if(record.state.cloudLease&&record.state.cloudLease.until>Date.now())throw new ChannelBusy();
  record.state.cloudLease={id:randomBytes(16).toString('hex'),until:Date.now()+180000};
  await this.commit(record);return record;
 }
 async rate(channelId:string,userId:string){
  await this.mutate(channelId,s=>{const now=Date.now();s.cloudRates||={};for(const [id,times]of Object.entries(s.cloudRates))if(!times.some(t=>t>now-60000))delete s.cloudRates[id];const recent=(s.cloudRates[userId]||[]).filter(t=>t>now-60000);if(recent.length>=30)throw Object.assign(Error('Please wait before sending more actions.'),{status:429});recent.push(now);s.cloudRates[userId]=recent;});
 }
 seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');}
 unseal<T>(value:string):T{const bytes=Buffer.from(value,'base64');if(bytes.length<29)throw Error('Invalid encrypted record.');const cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString());}
 async putSecret(channelId:string,name:string,value:unknown){await this.api('chatspin_secrets?on_conflict=channel_id,name',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({channel_id:this.channel(channelId),name,ciphertext:this.seal(value)})});}
 async getSecret<T>(channelId:string,name:string):Promise<T|undefined>{const rows=await this.api('chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=eq.'+encodeURIComponent(name)+'&select=ciphertext');return rows.length?this.unseal<T>(rows[0].ciphertext):undefined;}
 async removeSecret(channelId:string,name:string){await this.api('chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=eq.'+encodeURIComponent(name),{method:'DELETE'});}
 async inbox(channelId:string):Promise<{name:string;value:unknown}[]>{const rows=await this.api('chatspin_secrets?channel_id=eq.'+this.channel(channelId)+'&name=like.inbox:*&select=name,ciphertext&limit=100');return rows.map((row:{name:string;ciphertext:string})=>({name:row.name,value:this.unseal(row.ciphertext)}));}
 async listChannels():Promise<string[]>{const rows=await this.api('chatspin_channels?select=channel_id&order=updated_at.asc&limit=20');return rows.map((row:{channel_id:string})=>this.channel(row.channel_id));}
 async cleanupSessions(){await this.api('chatspin_sessions?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE'});}
 async setSession(id:string,value:unknown,expires:number){await this.api('chatspin_sessions?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id,ciphertext:this.seal(value),expires_at:new Date(expires).toISOString()})});}
 async getSession<T>(id:string):Promise<T|undefined>{const rows=await this.api('chatspin_sessions?id=eq.'+encodeURIComponent(id)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=ciphertext');return rows.length?this.unseal<T>(rows[0].ciphertext):undefined;}
 async destroySession(id:string){await this.api('chatspin_sessions?id=eq.'+encodeURIComponent(id),{method:'DELETE'});}
}
