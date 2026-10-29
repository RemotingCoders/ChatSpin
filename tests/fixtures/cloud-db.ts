import assert from 'node:assert/strict';
import {SupabaseRepository} from '../../server/supabase.ts';
export function database(){
 const channels=new Map<string,any>(),secrets=new Map<string,string>(),sessions=new Map<string,any>();
 const request=(async(input,init)=>{
  const url=new URL(String(input)),path=url.pathname.replace('/rest/v1/',''),body=init?.body?JSON.parse(String(init.body)):undefined;
  assert.equal(new Headers(init?.headers).get('apikey'),'server-only');
  const response=(value:unknown,status=200)=>new Response(status===204||value===undefined?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const channel=url.searchParams.get('channel_id')?.slice(3);
  if(path==='chatspin_channels'){
   if(init?.method==='POST'){if(!channels.has(body.channel_id))channels.set(body.channel_id,{...body,revision:0});return response(undefined,201);}
   return response(channels.has(channel!)?[channels.get(channel!)]:[]);
  }
  if(path==='rpc/chatspin_commit'){
   const record=channels.get(body.p_channel_id);
   if(record.revision!==body.p_revision)return response({code:'PT409'},409);
   record.state=body.p_state;record.revision++;return response(record.revision);
  }
  if(path==='chatspin_secrets'){
   if(init?.method==='POST'){secrets.set(body.channel_id+':'+body.name,body.ciphertext);return response(undefined,201);}
   if(url.searchParams.get('name')==='like.inbox:*')return response([...secrets].filter(([key])=>key.startsWith(channel+':inbox:')).map(([key,ciphertext])=>({name:key.slice(channel!.length+1),ciphertext})));
   const key=channel+':'+url.searchParams.get('name')?.slice(3);
   if(init?.method==='DELETE'){secrets.delete(key);return response(null,204);}
   return response(secrets.has(key)?[{ciphertext:secrets.get(key)}]:[]);
  }
  if(path==='chatspin_sessions'){
   if(init?.method==='POST'){sessions.set(body.id,body);return response(undefined,201);}
   const id=url.searchParams.get('id')?.slice(3);
   if(init?.method==='DELETE'){if(id)sessions.delete(id);return response(null,204);}
   const row=sessions.get(id!);return response(row&&Date.parse(row.expires_at)>Date.now()?[row]:[]);
  }
  throw Error('Unexpected database request '+path);
 }) as typeof fetch;
 return {repository:new SupabaseRepository('https://project.supabase.co','server-only','a'.repeat(40),request),channels,secrets};
}
