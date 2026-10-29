import express from 'express';
import {z} from 'zod';
import {verifyExtensionJWT,extensionController,linkedViewer,type ExtensionClaims} from './auth.js';
import {extensionState,applyExtensionAction,languageSchema,type ExtensionActor} from './service.js';
import {SupabaseRepository,StateConflict,ChannelBusy} from '../../server/supabase.js';
import type {State,User} from '../../server/domain.js';

export type CloudExtensionOptions={repository:SupabaseRepository;clientId:string;secrets:string[];origins?:string[];schedule?:(channel:string)=>void;background?:(promise:Promise<unknown>)=>void};
export function cloudExtensionRouter(options:CloudExtensionOptions){
 const router=express.Router(),origins=[`https://${options.clientId}.ext-twitch.tv`,...(options.origins||[])];
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  const origin=req.headers.origin;if(origin&&!origins.includes(origin))return res.status(403).json({error:'Extension origin rejected.'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  if(req.method==='OPTIONS')return origin?res.sendStatus(204):res.sendStatus(403);
  if(!options.clientId)return res.status(503).json({error:'Twitch extension is not configured.'});
  if(req.method!=='GET'&&!origin)return res.status(403).json({error:'Extension origin required.'});
  try{
   const header=req.headers.authorization;if(!header?.startsWith('Bearer '))throw Error();
   const claims=verifyExtensionJWT(header.slice(7),options.secrets,undefined);
   if(claims.role==='broadcaster'&&!extensionController(claims,[]))throw Error();
   res.locals.claims=claims;next();
  }catch{return res.status(401).json({error:'Invalid or expired extension authorization.'});}
 });
 router.use(express.json({limit:'8kb'}));
 function actor(s:State,c:ExtensionClaims):ExtensionActor{
  // No global moderator list: only the owner controls a new cloud channel.
  const controller=extensionController(c,[]),id=linkedViewer(c)||(controller?c.channel_id:undefined);
  const known:User|undefined=id?s.groups.flatMap(g=>g.questions).find(q=>q.user.id===id)?.user||s.participants.find(p=>p.id===id):undefined;
  return {controller,user:id?(known||{id,name:'Viewer '+id}):undefined,anonymous:c.opaque_user_id.startsWith('A')};
 }
 router.get('/state',async(req,res)=>{
  const c=res.locals.claims as ExtensionClaims;
  const [{state},configured]=await Promise.all([options.repository.load(c.channel_id),options.repository.getSecret<State['questionLanguage']>(c.channel_id,'question-language')]);if(configured)state.questionLanguage=configured;
  const language=languageSchema.parse(req.query.language||state.questionLanguage||'original');
  res.json(extensionState(state,actor(state,c),language));
  // Reading the wheel must not wait for a translation-demand write or an AI lease.
  if(language!=='original'&&(state.cloudTranslations?.[language]||0)<Date.now()-30000){
   const demand=options.repository.mutate(c.channel_id,s=>{s.cloudTranslations||={};s.cloudTranslations[language]=Date.now();}).catch(error=>{if(!(error instanceof ChannelBusy)&&!(error instanceof StateConflict))console.error('ChatSpin translation demand could not be saved.');}).finally(()=>options.schedule?.(c.channel_id));
   options.background?.(demand);
  }else options.schedule?.(c.channel_id);
 });
 router.post('/action',async(req,res)=>{
  const c=res.locals.claims as ExtensionClaims;
  await options.repository.rate(c.channel_id,c.user_id||c.opaque_user_id);
  await options.repository.mutate(c.channel_id,s=>applyExtensionAction(s,actor(s,c),req.body,id=>{
   s.aiJobs||=[];if(!s.aiJobs.some(job=>job.id===id))s.aiJobs.push({id,attempts:0,next:0});
  }));
  options.schedule?.(c.channel_id);res.json({ok:true});
 });
 router.use((_req,res)=>res.status(404).json({error:'Endpoint not found.'}));
 router.use((error:Error&{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error instanceof StateConflict||error instanceof ChannelBusy?409:error.status||(error instanceof z.ZodError?400:500)).json({error:error instanceof StateConflict||error instanceof ChannelBusy?error.message:error instanceof z.ZodError?'Please check the supplied values.':error.status?error.message:'Cloud request failed. Please retry.'}));
 return router;
}
