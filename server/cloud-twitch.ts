import express from 'express';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {SupabaseRepository} from './supabase.ts';
import {timedFetch} from './http.ts';
export const webhookSecret=(secret:string,channel:string)=>createHmac('sha256',secret).update('chatspin.eventsub:'+channel).digest('hex');
export function verifyWebhook(raw:Buffer,headers:Record<string,string|undefined>,secret:string,now=Date.now()){
 const id=headers['twitch-eventsub-message-id'],timestamp=headers['twitch-eventsub-message-timestamp'],supplied=headers['twitch-eventsub-message-signature'];
 if(!id||id.length>256||!timestamp||!supplied||!Number.isFinite(Date.parse(timestamp))||Math.abs(now-Date.parse(timestamp))>600000)return false;
 const expected='sha256='+createHmac('sha256',secret).update(id).update(timestamp).update(raw).digest('hex');
 const a=Buffer.from(supplied),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
async function appToken(){
 const response=await timedFetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID!,client_secret:process.env.TWITCH_CLIENT_SECRET!,grant_type:'client_credentials'})});
 if(!response.ok)throw Error('Twitch application authorization failed.');return (await response.json()).access_token as string;
}
export async function subscribeCloudChat(repository:SupabaseRepository,channel:string,origin:string,secret:string){
 const response=await timedFetch('https://api.twitch.tv/helix/eventsub/subscriptions',{method:'POST',headers:{Authorization:'Bearer '+await appToken(),'Client-Id':process.env.TWITCH_CLIENT_ID!,'Content-Type':'application/json'},body:JSON.stringify({type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:channel,user_id:channel},transport:{method:'webhook',callback:origin+'/api/twitch/events/'+channel,secret:webhookSecret(secret,channel)}})});
 if(!response.ok&&response.status!==409){await repository.putSecret(channel,'chat-status',{status:'Chat subscription failed. Reconnect Twitch.'});throw Error('Twitch chat subscription failed.');}
 await repository.putSecret(channel,'chat-status',{status:response.status===409?'Connected':'Awaiting webhook verification'});
}
export function cloudWebhooks(repository:SupabaseRepository,secret:string,schedule:(channel:string)=>void){
 const router=express.Router();
 router.post('/api/twitch/events/:channel',express.raw({type:'application/json',limit:'64kb'}),async(req,res)=>{
  const channel=String(req.params.channel);if(!/^\d{1,30}$/.test(channel)||!Buffer.isBuffer(req.body))return res.sendStatus(400);
  const headers=Object.fromEntries(['twitch-eventsub-message-id','twitch-eventsub-message-timestamp','twitch-eventsub-message-signature'].map(key=>[key,req.get(key)]));
  if(!verifyWebhook(req.body,headers,webhookSecret(secret,channel)))return res.sendStatus(403);
  let body;try{body=JSON.parse(req.body.toString());}catch{return res.sendStatus(400);}
  if(body.subscription?.type!=='channel.chat.message'||body.subscription?.condition?.broadcaster_user_id!==channel)return res.sendStatus(403);
  const type=req.get('twitch-eventsub-message-type');
  if(type==='webhook_callback_verification'){
   if(typeof body.challenge!=='string')return res.sendStatus(400);
   await repository.putSecret(channel,'chat-status',{status:'Connected'});return res.type('text/plain').send(body.challenge);
  }
  if(type==='revocation'){await repository.putSecret(channel,'chat-status',{status:'Chat permission revoked. Connect again.'});return res.sendStatus(204);}
  if(type!=='notification')return res.sendStatus(400);
  const chatStatus=await repository.getSecret<{status:string}>(channel,'chat-status');if(chatStatus?.status!=='Connected')return res.sendStatus(204);
  const event=body.event;if(event?.broadcaster_user_id!==channel||typeof event.chatter_user_id!=='string'||!/^\d+$/.test(event.chatter_user_id)||typeof event.message?.text!=='string'||typeof event.message_id!=='string')return res.sendStatus(400);
  if(event.reply&&event.chatter_user_id===channel)return res.sendStatus(204);
  // Durable inbox is independent of the channel's AI lease, so chat delivery never waits for a model call.
  await repository.putSecret(channel,'inbox:'+event.message_id,{user:{id:event.chatter_user_id,name:String(event.chatter_user_name||event.chatter_user_id),login:String(event.chatter_user_login||'')},text:event.message.text,messageId:event.message_id,at:Date.now()});
  schedule(channel);res.sendStatus(204);
 });return router;
}
