import {SupabaseRepository,ChannelBusy,StateConflict} from './supabase.js';
import {bindCloudQuota} from './cloud-quotas.js';
import {bindBudget,bindProviderBudget,retain} from './limits.js';
import {QuestionWork} from './work.js';
import {groupBatch,detectQuestions} from './ai.js';
import {TranslationWork,type translateQuestions} from './translation.js';
import {z} from 'zod';
import {translationSource} from './presentation.js';
import {answerIsActive} from './domain.js';
import {extractChatQuestion} from './chat.js';
import {ApprovedAnswerTranslations,approvedAnswerPresentation} from './answer-translations.js';
import {ApprovedReplies} from './replies.js';
import {TwitchConnection,type Credentials} from './twitch.js';

type CloudServices={reserve?:(tokens:number)=>Promise<void>;group?:typeof groupBatch;detect?:typeof detectQuestions;translate?:typeof translateQuestions};
export class CloudProcessingError extends Error {constructor(stage:string,category:string){super('Cloud work failed at '+stage+' ('+category+').');}}
export async function processCloudChannel(repository:SupabaseRepository,channel:string,services:CloudServices={}){
 const progress={stage:'load'};
 try{await runCloudChannel(repository,channel,progress,services);}catch(error){const name=error instanceof Error?error.name:'';const category=error instanceof StateConflict?'conflict':['TimeoutError','AbortError'].includes(name)?'timeout':'operation failed';throw new CloudProcessingError(progress.stage,category);}
}
async function runCloudChannel(repository:SupabaseRepository,channel:string,progress:{stage:string},services:CloudServices){
 const initial=await repository.load(channel);progress.stage='inbox lookup';const pendingInbox=await repository.inbox(channel),now=Date.now();
 const displayLanguage=await repository.getSecret<typeof initial.state.questionLanguage>(channel,'question-language');if(displayLanguage)initial.state.questionLanguage=displayLanguage;
 const needsTranslation=(language:string)=>initial.state.groups.some(g=>{if(!['en','es','ru','de'].includes(language))return false;const lang=language as 'en'|'es'|'ru'|'de',source=translationSource(g),attempt=g.translationAttempts?.[lang];return g.translations?.[lang]?.source!==source&&(!attempt||attempt.source!==source||attempt.attempts<3&&attempt.next<=now);});
 const languages=[initial.state.questionLanguage||'original',...Object.entries(initial.state.cloudTranslations||{}).filter(([,at])=>at>now-60000).map(([lang])=>lang)];
 const aiDue=process.env.OPENAI_API_KEY&&((initial.state.aiJobs||[]).some(j=>!j.failed&&j.next<=now)||(initial.state.pendingMessages||[]).some(m=>m.next<=now)||languages.some(needsTranslation)||languages.some(language=>['en','es','de','ru'].includes(language)&&initial.state.groups.some(g=>answerIsActive(initial.state,g)&&approvedAnswerPresentation(initial.state,g,language as 'en'|'es'|'de'|'ru').pending)));
 if(!pendingInbox.length&&!aiDue&&!(initial.state.replyJobs||[]).length&&initial.state.cloudMaintenance&&initial.state.cloudMaintenance>now-3600000)return;
 progress.stage='claim';let record;try{record=await repository.acquire(channel);}catch(error){if(error instanceof ChannelBusy||error instanceof StateConflict)return;throw error;}
 let writes=Promise.resolve();const flush=()=>writes;let twitch:TwitchConnection|undefined;
 try{
 const state=record.state;if(displayLanguage)state.questionLanguage=displayLanguage;state.cloudStatus||={ai:'Ready',translation:'Ready'};const deadline=Date.now()+100000;
 const persist=()=>{writes=writes.then(()=>{if(!state.cloudLease||state.cloudLease.until<=Date.now())throw new StateConflict();return repository.commit(record);});};
 bindBudget(state,persist,flush);if(services.reserve)bindProviderBudget(state,services.reserve);else bindCloudQuota(state,channel);
 progress.stage='credentials';let credentialRecord=await repository.secretRecord<Credentials>(channel,'twitch');
 const credentials=credentialRecord?.value;
 const save=(next:Credentials|null)=>{writes=writes.then(async()=>{
  if(!credentialRecord)throw Error('Twitch disconnected.');
  const version=await repository.replaceSecret(channel,'twitch',credentialRecord.version,next);
  if(!version)throw Error('Twitch authorization changed.');credentialRecord=next?{value:next,version}:undefined;
 });};
 let sending:{groupId:string;answer:string}|undefined;
 const checkAuthorization=async()=>{
  await flush();const [current,latest]=await Promise.all([repository.secretRecord<Credentials>(channel,'twitch'),repository.load(channel)]);
  if(!credentialRecord||current?.version!==credentialRecord.version)throw Error('Twitch authorization changed.');
  const group=latest.state.groups.find(g=>g.id===sending?.groupId);
  if(latest.state.repliesPaused||!group||!answerIsActive(latest.state,group)||group.answer!==sending?.answer)throw Error('Approved reply changed or paused.');
 };
 twitch=credentials?new TwitchConnection(credentials,channel,()=>{},undefined,save,checkAuthorization):undefined;
 const answerTranslator=new ApprovedAnswerTranslations(state,persist);
 const replies=new ApprovedReplies(()=>state,async(message,parent)=>{
  // Persist the sending marker before a public side effect. Unknown outcomes are never retried.
  const job=state.replyJobs?.find(j=>j.messageId===parent);sending=job?{groupId:job.groupId,answer:job.answer}:undefined;
  await flush();if(!twitch)throw Error('Twitch is disconnected.');
  await twitch.sendChatMessage(message,parent);
 },()=>!!twitch?.canWriteChat&&twitch.status==='Connected',persist,process.env.OPENAI_API_KEY ? (group,questionText)=>answerTranslator.request({groupId:group.id,language:'detect',questionText}) : undefined);
 const work=new QuestionWork(state,persist,messages=>(services.detect||detectQuestions)(messages,state),ids=>(services.group||groupBatch)(state,ids),(g,user,messageId,questionText)=>{replies.enqueue(g,user,messageId,Date.now(),questionText);});
  progress.stage='inbox';const inbox=await repository.inbox(channel);
  const eventSchema=z.object({user:z.object({id:z.string().regex(/^\d+$/),name:z.string(),login:z.string().optional()}),text:z.string().max(2000),messageId:z.string(),at:z.number()});
  const seenState=state as typeof state&{cloudEvents?:string[]};seenState.cloudEvents||=[];
  for(const item of inbox){
   if(Date.now()>=deadline)break;
   const parsed=eventSchema.safeParse(item.value);if(!parsed.success){await repository.removeSecret(channel,item.name);continue;}const message=parsed.data;
   if(!seenState.cloudEvents.includes(message.messageId)){
    if(process.env.OPENAI_API_KEY||extractChatQuestion(message.text)){if(!work.ingest(message.user,message.text,message.messageId,message.at)){state.cloudStatus.ai=work.status;persist();await flush();continue;}}
    if(message.text.trim()==='!join'&&state.registration&&!state.participants.some(p=>p.id===message.user.id))state.participants.push({...message.user,selected:false});
    if(message.text.trim()==='!leave')state.participants=state.participants.filter(p=>p.id!==message.user.id);
    seenState.cloudEvents.push(message.messageId);seenState.cloudEvents=seenState.cloudEvents.slice(-2000);persist();await flush();
   }
   await repository.removeSecret(channel,item.name);
  }
  progress.stage='Twitch validation';if(credentials){await twitch!.validate();if(twitch!.status==='Disconnected')twitch!.status='Connected';else if(twitch!.status!=='Connected')await repository.putSecret(channel,'chat-status',{status:twitch!.status});await flush();}
  progress.stage='maintenance';if(!state.cloudMaintenance||state.cloudMaintenance<Date.now()-3600000){
   await repository.commit(record,true);retain(state);state.cloudMaintenance=Date.now();persist();await flush();
  }
  if(process.env.OPENAI_API_KEY&&(!state.spin||state.spin.end<Date.now())){
   progress.stage='grouping';await work.tick();state.cloudStatus.ai=work.status;persist();await flush();
   if(Date.now()<deadline){
    const translations=new TranslationWork(state,persist,services.translate?(items,language)=>services.translate!(items,language,state):undefined);
    const demanded=Object.entries(state.cloudTranslations||{}).filter(([,at])=>at>Date.now()-60000).map(([lang])=>lang);
    const language=[state.questionLanguage||'original',...demanded].find(needsTranslation) as 'en'|'es'|'ru'|'de'|undefined;
    progress.stage='translation';if(language)await translations.tick(Date.now(),language);state.cloudStatus.translation=translations.status;persist();await flush();
   }
  }
  progress.stage='answer translation';
  for(const job of process.env.OPENAI_API_KEY ? state.replyJobs||[] : [])answerTranslator.request({groupId:job.groupId,language:'detect',questionText:job.questionText});
  for(const language of languages)if(['en','es','de','ru'].includes(language))for(const group of state.groups)if(answerIsActive(state,group))answerTranslator.request({groupId:group.id,language:language as 'en'|'es'|'de'|'ru'});
  if(process.env.OPENAI_API_KEY&&Date.now()<deadline){await answerTranslator.tick(Date.now(),1);await flush();}
  progress.stage='public replies';
  while(Date.now()<deadline&&(state.replyJobs||[]).length){
   const before=JSON.stringify(state.replyJobs);await replies.flush();await flush();
   if(before===JSON.stringify(state.replyJobs)||state.repliesPaused)break;
   if((state.replyJobs||[]).length)await new Promise(resolve=>setTimeout(resolve,1500));
  }
 }finally{
  twitch?.stop();
  // A failed write leaves the lease to expire; never overwrite a newer owner after expiry.
  try{await flush();}finally{await repository.release(record);}
 }
}
