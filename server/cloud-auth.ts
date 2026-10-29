import './session-types.js';
import express from 'express';
import session from 'express-session';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {SupabaseRepository} from './supabase.js';
import {timedFetch} from './http.js';
import {subscribeCloudChat} from './cloud-twitch.js';
import type {Credentials} from './twitch.js';
class SupabaseSessions extends session.Store {
 private touched=new Map<string,number>();
 constructor(private repository:SupabaseRepository){super();}
 get(id:string,done:(error?:unknown,value?:session.SessionData|null)=>void){void this.repository.getSession<session.SessionData>(id).then(value=>done(null,value||null),done);}
 set(id:string,value:session.SessionData,done?:(error?:unknown)=>void){void this.repository.setSession(id,value,value.cookie.expires?new Date(value.cookie.expires).getTime():Date.now()+86400000).then(()=>done?.(),error=>done?.(error));}
 destroy(id:string,done?:(error?:unknown)=>void){void this.repository.destroySession(id).then(()=>done?.(),error=>done?.(error));}
 touch(id:string,value:session.SessionData,done?:(error?:unknown)=>void){const now=Date.now();if((this.touched.get(id)||0)>now-60000){done?.();return;}this.touched.set(id,now);if(this.touched.size>1000)for(const [key,at]of this.touched)if(at<now-60000)this.touched.delete(key);this.set(id,value,error=>{if(error)this.touched.delete(id);done?.(error);});}
}
export function cloudAuthentication(repository:SupabaseRepository,origin:string,secret:string){
 const router=express.Router();
 router.use(session({secret,store:new SupabaseSessions(repository),resave:false,saveUninitialized:false,name:'chatspin.sid',cookie:{httpOnly:true,secure:true,sameSite:'lax',maxAge:86400000}}));
 router.get('/auth/twitch',(req,res)=>{
  if(!process.env.TWITCH_CLIENT_ID||!process.env.TWITCH_CLIENT_SECRET)return res.status(503).send('Twitch OAuth is not configured.');
  const state=randomBytes(32).toString('hex');req.session.oauth={state,role:'streamer',at:Date.now()};
  const url=new URL('https://id.twitch.tv/oauth2/authorize');url.search=new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID,redirect_uri:origin+'/auth/callback',response_type:'code',scope:'user:read:chat user:write:chat user:bot channel:bot',state}).toString();
  req.session.save(error=>error?res.sendStatus(503):res.redirect(url.toString()));
 });
 router.get('/auth/callback',async(req,res)=>{
  const oauth=req.session.oauth;delete req.session.oauth;
  const state=typeof req.query.state==='string'?req.query.state:'';
  if(!oauth||state.length!==oauth.state.length||!timingSafeEqual(Buffer.from(state),Buffer.from(oauth.state))||Date.now()-oauth.at>600000||typeof req.query.code!=='string')return res.status(400).send('Invalid or expired authorization. Try connecting again.');
  const response=await timedFetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID!,client_secret:process.env.TWITCH_CLIENT_SECRET!,code:req.query.code,grant_type:'authorization_code',redirect_uri:origin+'/auth/callback'})});
  if(!response.ok)return res.status(401).send('Twitch authorization failed.');
  const credentials=await response.json() as Credentials;
  const validation=await timedFetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+credentials.access_token}});
  if(!validation.ok)return res.status(401).send('Twitch validation failed.');
  const identity=await validation.json() as {user_id:string;login:string;client_id:string;scopes:string[]};
  if(identity.client_id!==process.env.TWITCH_CLIENT_ID||!/^\d+$/.test(identity.user_id)||!['user:read:chat','user:write:chat','user:bot','channel:bot'].every(scope=>identity.scopes.includes(scope)))return res.status(403).send('Authorize the required Twitch permissions.');
  // Only the validated OAuth identity chooses its channel. No query/body channel selection.
  await repository.load(identity.user_id);
  await repository.putSecret(identity.user_id,'twitch',{...credentials,scope:identity.scopes,expires_at:Date.now()+credentials.expires_in*1000});
  await new Promise<void>((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
  req.session.user={id:identity.user_id,name:identity.login,login:identity.login};req.session.demo=false;
  await new Promise<void>((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
  try { await subscribeCloudChat(repository,identity.user_id,origin,secret); } catch { /* Stored status is shown in the dashboard; OAuth itself remains valid. */ }
  res.redirect('/');
 });
 router.post('/api/logout',(req,res)=>{if(req.headers.origin!==origin)return res.sendStatus(403);req.session.destroy(error=>error?res.sendStatus(503):res.clearCookie('chatspin.sid').json({ok:true}));});
 return router;
}
