import express from 'express';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {z} from 'zod';
import {SupabaseRepository,StateConflict,ChannelBusy,type CloudState} from './supabase.js';
import {cloudExtensionRouter} from '../extension/server/cloud.js';
import {cloudAuthentication} from './cloud-auth.js';
import {cloudDashboardAction} from './cloud-actions.js';
import {cloudWebhooks} from './cloud-twitch.js';
import {processCloudChannel} from './cloud-work.js';
import {questionPresentation,presentedSpin} from './presentation.js';
import {answerIsActive,eligibleEntries,support} from './domain.js';
import {settings} from './limits.js';

export function createCloudApp(repository:SupabaseRepository,origin:string,secret:string,background:(promise:Promise<unknown>)=>void=waitUntil){
 const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
 const schedule=(channel:string)=>background(processCloudChannel(repository,channel).catch(()=>{console.error('ChatSpin background processing failed; work remains persisted for retry.');}));
 app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');next();});
 app.get('/api/cron',async(req,res)=>{
  const cron=process.env.CRON_SECRET;if(!cron||req.get('authorization')!=='Bearer '+cron)return res.sendStatus(403);
  await repository.cleanupSessions();
  const channels=await repository.listChannels();
  background(Promise.allSettled(channels.map(async channel=>{await processCloudChannel(repository,channel);try{await repository.mutate(channel,()=>{});}catch(error){if(!(error instanceof ChannelBusy)&&!(error instanceof StateConflict))throw error;}})).then(results=>{if(results.some(r=>r.status==='rejected'))console.error('ChatSpin scheduled processing failed for one or more channels.');}));
  res.json({ok:true});
 });
 app.get('/api/health',(_req,res)=>res.json({ok:true,service:'ChatSpin cloud',storage:'Supabase',multiChannel:true}));
 app.use(cloudWebhooks(repository,secret,schedule));
 app.use('/extension-api',cloudExtensionRouter({repository,clientId:process.env.EXTENSION_CLIENT_ID||'',secrets:[process.env.EXTENSION_SECRET||'',process.env.EXTENSION_PREVIOUS_SECRET||''],origins:(process.env.EXTENSION_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean),schedule}));
 app.use(express.json({limit:'8kb'}));
 app.use(cloudAuthentication(repository,origin,secret));
 app.use((req,res,next)=>{if(req.method!=='GET'&&req.headers.origin!==origin)return res.status(403).json({error:'Request origin rejected.'});next();});
 app.get('/api/session',async(req,res)=>{
  const user=req.session.user;
  const status=user?await repository.getSecret<{status:string}>(user.id,'chat-status'):undefined;
  res.json({user:user||null,controller:!!user,demo:false,demoEnabled:false,configured:!!(process.env.TWITCH_CLIENT_ID&&process.env.TWITCH_CLIENT_SECRET),uiLanguage:user?(await repository.load(user.id)).state.uiLanguage||'en':'en',storageNotice:'',ai:process.env.OPENAI_API_KEY?'Ready':'Not configured — explicit questions only',chatReplies:status?.status==='Connected'?'Ready':'Connect Twitch to enable public replies',connection:status?.status||'Disconnected'});
 });
 const token=(s:CloudState,channel:string)=>{const version=(s as CloudState&{cloudObsVersion?:string}).cloudObsVersion||'0';const content=channel+':'+version;return content+':'+createHmac('sha256',secret).update('chatspin.obs:'+content).digest('hex');};
 app.get('/api/overlay',async(req,res)=>{
  const supplied=typeof req.query.token==='string'?req.query.token:'';
  if(!/^\d{1,30}:[a-f0-9]{1,64}:[a-f0-9]{64}$/.test(supplied))return res.sendStatus(403);
  const channel=supplied.split(':')[0],{state}=await repository.load(channel),expected=token(state,channel);
  if(supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return res.sendStatus(403);
  res.json({spin:presentedSpin(state),questionLanguage:state.questionLanguage||'original',uiLanguage:state.uiLanguage||'en',translationPending:state.groups.some(g=>questionPresentation(state,g).pending),entries:eligibleEntries(state),demo:false,mode:state.mode,serverTime:Date.now()});
 });
 app.use('/api',(req,res,next)=>req.session.user?next():res.status(401).json({error:'Sign in with Twitch.'}));
 app.get('/api/state',async(req,res)=>{
  const channel=req.session.user!.id,{state:s}=await repository.load(channel);
  // Explicitly omit server coordination metadata, inbox, tokens, budgets of other channels.
  const {cloudLease,cloudRates,cloudTranslations,cloudMaintenance,...safe}=s;
  delete (safe as Record<string,unknown>).cloudEvents;delete (safe as Record<string,unknown>).cloudObsVersion;
  res.json({...safe,replyJobs:undefined,replyHistory:undefined,pendingMessages:undefined,aiJobs:undefined,settings:settings(s),spin:presentedSpin(s),translationStatus:'Ready',entries:eligibleEntries(s),groups:s.groups.map(g=>({...g,text:questionPresentation(s,g).text,title:questionPresentation(s,g).title,originalText:g.text,originalTitle:g.customTitle||g.text,translationPending:questionPresentation(s,g).pending,translations:undefined,translationAttempts:undefined,embedding:undefined,supporters:undefined,count:support(g),answerActive:answerIsActive(s,g)})),obsUrl:origin+'/obs?token='+encodeURIComponent(token(s,channel)),serverTime:Date.now()});schedule(channel);
 });
 app.post('/api/action',async(req,res)=>{
  const user=req.session.user!,channel=user.id;
  await repository.rate(channel,user.id);
  if(req.body?.type==='disconnect'){
   await repository.removeSecret(channel,'twitch');await repository.putSecret(channel,'chat-status',{status:'Disconnected'});
  }else{
   const backup=['clear-questions','clear-participants','new-session'].includes(req.body?.type);
   await repository.mutate(channel,s=>{
    if(req.body?.type==='rotate-obs'){
     if(req.body.confirmed!==true)throw Error('Confirm regenerating the OBS link.');(s as CloudState&{cloudObsVersion?:string}).cloudObsVersion=randomBytes(16).toString('hex');return;
    }
    cloudDashboardAction(s,user,req.body);
   },backup);
   schedule(channel);
  }
  res.json({ok:true});
 });
 app.use((_req,res)=>res.status(404).json({error:'Endpoint not found.'}));
 app.use((error:Error&{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const status=error instanceof StateConflict||error instanceof ChannelBusy?409:error instanceof z.ZodError?400:error.status||500;
  res.status(status).json({error:status===500?'Cloud request failed. Please retry.':error instanceof z.ZodError?'Please check the supplied values.':error.message});
 });
 return app;
}
