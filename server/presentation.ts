import type {Group,State,Spin} from './domain.js';
export type QuestionLanguage='original'|'en'|'es'|'ru'|'de';
export type QuestionTranslation={source:string;text:string;title:string};
export const translationSource=(g:Group)=>JSON.stringify({text:g.text,title:g.customTitle||g.text});
export function questionPresentation(s:State,g:Group){
 const language=s.questionLanguage||'original';
 const translated=language==='original'?undefined:g.translations?.[language];
 if(translated?.source===translationSource(g))return {text:translated.text,title:translated.title,pending:false};
 return {text:g.text,title:g.customTitle||g.text,pending:language!=='original'};
}
export function presentedSpin(s:State,now=Date.now()):Spin|null{
 const spin=s.spin;if(!spin||spin.mode!=='questions'||spin.end>now)return spin;
 const winner=s.groups.find(g=>g.id===spin.winner);
 return {...spin,candidates:spin.candidates.map(c=>{const g=s.groups.find(g=>g.id===c.id);return {...c,label:g?questionPresentation(s,g).title:c.label};}),...(winner?{text:questionPresentation(s,winner).text,label:questionPresentation(s,winner).title}:{})};
}
