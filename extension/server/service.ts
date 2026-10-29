import {reviewVersion,checkReviewVersion} from '../../server/domain.js';
import {z} from 'zod';
import {approvedAnswerPresentation} from '../../server/answer-translations.js';
import {addQuestion,approveQuestion,answerIsActive,eligibleEntries,rememberAnswer,spin,support,type State,type User} from '../../server/domain.js';
import {questionPresentation,questionReadiness,type QuestionLanguage} from '../../server/presentation.js';
export const languages=['original','en','es','ru','de'] as const;
export const languageSchema=z.enum(languages);
export type ExtensionActor={user?:User;controller:boolean;anonymous:boolean};
export function extensionState(s:State,actor:ExtensionActor,language:QuestionLanguage){
 const presentation=(id:string)=>{const g=s.groups.find(g=>g.id===id);return g?questionPresentation({...s,questionLanguage:language},g):undefined;};
 const entries=eligibleEntries(s).filter(e=>s.mode!=='questions'||!presentation(e.id)?.pending).map(e=>({...e,label:s.mode==='questions'?presentation(e.id)?.title||e.label:e.label}));
 const draw=s.spin?{...s.spin,candidates:s.spin.candidates.map(e=>({...e,label:s.spin!.mode==='questions'?(presentation(e.id)?.pending?'…':presentation(e.id)?.title||e.label):e.label})),...(s.spin.mode==='questions'?{text:presentation(s.spin.winner)?.pending?'':presentation(s.spin.winner)?.text||s.spin.text,label:presentation(s.spin.winner)?.pending?'…':presentation(s.spin.winner)?.title||s.spin.label}:{})}:null;
 return {controller:actor.controller,canParticipate:!!actor.user,anonymous:actor.anonymous,user:actor.user||null,demo:s.demo,mode:s.mode,odds:s.odds,registration:s.registration,excludeSelected:s.excludeSelected,entries,spin:draw,serverTime:Date.now(),uiLanguage:s.uiLanguage||'en',questionLanguage:language,participantCount:s.participants.length,joined:!!actor.user&&s.participants.some(p=>p.id===actor.user!.id),groups:s.groups.map(g=>{
  const approved=approvedAnswerPresentation(s,g,language);
  const display=questionPresentation({...s,questionLanguage:language},g);const own=!!actor.user&&g.questions.some(q=>q.user.id===actor.user!.id);
  return {id:g.id,reviewVersion:actor.controller?reviewVersion(g):undefined,title:display.title,text:display.text,translationPending:display.pending,readiness:questionReadiness({...s,questionLanguage:language},g,!!process.env.OPENAI_API_KEY),count:support(g),status:g.status,asked:own,answer:answerIsActive(s,g)&&(own||actor.controller)?approved.text:'',originalAnswer:actor.controller?g.answer:undefined,answerTranslationPending:answerIsActive(s,g)&&(own||actor.controller)&&approved.pending,answerTranslationFailed:answerIsActive(s,g)&&(own||actor.controller)&&approved.failed,originals:actor.controller?g.questions:own?g.questions.filter(q=>q.user.id===actor.user!.id):[]};
 })};
}
const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('ask'),text:z.string().trim().min(3).max(500)}).strict(),
 z.object({type:z.literal('support'),id:z.string().max(100)}).strict(),
 z.object({type:z.enum(['join','leave','spin','toggle-registration','toggle-exclusion'])}).strict(),
 z.object({type:z.literal('spotlight'),id:z.string().max(100)}).strict(),
 z.object({type:z.literal('approve-question'),id:z.string().max(100)}).strict(),
 z.object({type:z.literal('mode'),value:z.enum(['questions','participants'])}).strict(),
 z.object({type:z.literal('odds'),value:z.enum(['equal','support','manual'])}).strict(),
 z.object({type:z.literal('answer'),expected:z.string().length(64).optional(),id:z.string().max(100),text:z.string().trim().max(2000),scope:z.enum(['session','permanent']).default('session'),removeFromWheel:z.boolean().default(true)}).strict()
]);
export type ExtensionAction=z.infer<typeof actionSchema>;
function applyAction(s:State,actor:ExtensionActor,body:unknown,enqueue:(id:string)=>void,busy=false){
 const action=actionSchema.parse(body),participation=['ask','support','join','leave'].includes(action.type);
 if(!participation&&!actor.controller)throw Object.assign(Error('Streamer or authorized moderator access required.'),{status:403});
 if(participation&&!actor.user)throw Object.assign(Error('Share your Twitch identity to participate.'),{status:403});
 if(!participation&&s.spin&&s.spin.end>Date.now())throw Object.assign(Error('Wait for the current spin to finish.'),{status:409});
 if(!participation&&busy)throw Object.assign(Error('Grouping is in progress. Please try again shortly.'),{status:409});
 const user=actor.user;
 switch(action.type){
  case 'ask':{const group=addQuestion(s,user!,action.text);if(!s.demo&&!group.aiProcessed)enqueue(group.id);break;}
  case 'support':{const g=s.groups.find(g=>g.id===action.id);if(!g||g.status!=='pending')throw Error('Choose a pending question.');if(!g.supporters.includes(user!.id))g.supporters.push(user!.id);break;}
  case 'join':if(!s.registration)throw Error('Registration is closed.');if(!s.participants.some(p=>p.id===user!.id))s.participants.push({...user!,selected:false});break;
  case 'leave':s.participants=s.participants.filter(p=>p.id!==user!.id);break;
  case 'spin':spin(s);break;
  case 'spotlight':spin(s,action.id);break;
  case 'approve-question':approveQuestion(s,action.id);break;
  case 'mode':s.mode=action.value;break;
  case 'odds':s.odds=action.value;break;
  case 'toggle-registration':s.registration=!s.registration;break;
  case 'toggle-exclusion':s.excludeSelected=!s.excludeSelected;break;
  case 'answer':{const g=s.groups.find(g=>g.id===action.id);if(!g)throw Error('Question not found.');checkReviewVersion(g,action.expected);rememberAnswer(g);g.answer=action.text;g.status=action.removeFromWheel?(action.text?'written':'live'):'pending';g.answerScope=action.scope;g.answerSession=s.liveSession;break;}
 }
}

export function applyExtensionAction(...args:Parameters<typeof applyAction>){try{return applyAction(...args);}catch(error){if(error instanceof Error&&!('status' in error))Object.assign(error,{status:400});throw error;}}
