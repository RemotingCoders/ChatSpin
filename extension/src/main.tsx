/// <reference types="vite/client" />
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider} from '../../src/i18n';
import {useExtensionI18n} from './messages';
import {Wheel} from '../../src/Wheel';
import {wheelPresentation} from '../../src/wheelState';
import {SerializedLoader} from '../../src/api';
import type {UILanguage} from '../../src/catalog';
import {connectHelper,type TwitchAuthorization} from './sdk';
import {extensionRequest,type ExtensionState,type PersonalLanguage,apiOrigin} from './api';
import {useOverlayPosition} from './useOverlayPosition';
import './style.css';
const params=new URLSearchParams(location.search),preview=location.pathname.endsWith('preview.html');
const view=preview?params.get('view')||'viewer':location.pathname.endsWith('live.html')?'live':location.pathname.endsWith('config.html')?'config':location.pathname.endsWith('overlay.html')?'overlay':'viewer';
function ExtensionApp(){
 const {t,language,setLanguage,hasPreference}=useExtensionI18n();
 const [auth,setAuth]=useState<TwitchAuthorization|null>(null),[state,setState]=useState<ExtensionState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[question,setQuestion]=useState(''),[selected,setSelected]=useState(''),[answer,setAnswer]=useState('');
 const [questionLanguage,setQuestionLanguage]=useState<PersonalLanguage>('inherit');
 const panel=useOverlayPosition(view==='overlay',auth?.channelId||'preview');
 const [now,setNow]=useState(Date.now()),[clock,setClock]=useState(0);const authorization=useRef<TwitchAuthorization|null>(null),preference=useRef<PersonalLanguage>('inherit'),disposed=useRef(false);
 const loader=useRef<SerializedLoader|null>(null);
 if(!loader.current)loader.current=new SerializedLoader(async()=>{const query=preference.current==='inherit'?'':'?language='+preference.current;const next=await extensionRequest('/state'+query,authorization.current?.token,undefined,preview) as ExtensionState;if(!disposed.current){setState(next);setClock(next.serverTime-Date.now());setError('');}});
 useEffect(()=>{
  disposed.current=false;
  if(preview)return()=>{disposed.current=true;};
  return connectHelper(next=>{authorization.current=next;setAuth(next);setReady(true);try{const saved=localStorage.getItem('chatspin.extension.questions.'+next.channelId);if(['inherit','original','en','es','ru','de'].includes(saved||'')){preference.current=saved as PersonalLanguage;setQuestionLanguage(saved as PersonalLanguage);}}catch{}},()=>setError('Open this view inside Twitch, or use the local preview.'));
 },[]);
 useEffect(()=>{if(!hasPreference){const requested=params.get('language')?.split('-')[0];if(['en','es','ru','de'].includes(requested||''))setLanguage(requested as UILanguage,false);else if(state?.uiLanguage)setLanguage(state.uiLanguage,false);}},[state?.uiLanguage,hasPreference]);
 useEffect(()=>{if(!ready)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{await loader.current!.load();}catch(e){if(!cancelled)setError((e as Error).message);}finally{if(!cancelled)timer=setTimeout(poll,1500);}};void poll();return()=>{cancelled=true;disposed.current=true;clearTimeout(timer);};},[ready]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[]);
 async function act(body:unknown){setBusy(true);setError('');try{await extensionRequest('/action',authorization.current?.token,body,preview);await loader.current!.load(true);return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}}
 async function startPreview(role:'viewer'|'streamer'){
  const response=await fetch('/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})});if(!response.ok){setError('Local preview is available only in development.');return;}setReady(true);
 }
 function chooseQuestions(value:PersonalLanguage){preference.current=value;setQuestionLanguage(value);try{localStorage.setItem('chatspin.extension.questions.'+(auth?.channelId||'preview'),value);}catch{}void loader.current!.load(true).catch(e=>setError(e.message));}
 const inSpin=!!state?.spin&&state.spin.end>now+clock,result=!inSpin?state?.spin:null;
 const presentation=state?wheelPresentation(state.entries,state.spin,state.mode,now+clock):null;
 return <main ref={panel.ref} style={panel.style} className={'extension-shell '+view+(panel.dragging?' dragging':'')}>
  <header>{view==='overlay'?<button className="overlay-drag-handle" aria-label={t('Move ChatSpin panel')} title={t('Drag to move. Arrow keys move; Home resets.')} {...panel.handle}><strong>✦ ChatSpin</strong><span aria-hidden="true">⠿</span></button>:<strong>✦ ChatSpin</strong>}{preview&&<span className="badge">{t('DEMO · SIMULATED DATA')}</span>}</header>
  <section className="extension-card">
   <div className="languages"><label>{t('Interface language')}<select aria-label={t('Interface language')} value={language} onChange={e=>setLanguage(e.target.value as UILanguage)}><option value="en">English</option><option value="es">Español</option><option value="ru">Русский</option><option value="de">Deutsch</option></select></label><label>{t('Question language')}<select aria-label={t('Question language')} value={questionLanguage} onChange={e=>chooseQuestions(e.target.value as PersonalLanguage)}><option value="inherit">{t('Follow channel language')}</option><option value="original">{t('Original language')}</option><option value="en">{t('English')}</option><option value="es">{t('Spanish')}</option><option value="ru">{t('Russian')}</option><option value="de">{t('German')}</option></select></label></div>
   {error&&<p className="error" role="alert">{t(error)}</p>}
   {!ready&&<div className="welcome"><p>{t(preview?'Local extension preview':'Waiting for Twitch authorization…')}</p>{preview&&<><button onClick={()=>startPreview('viewer')}>{t('Preview as viewer')}</button><button onClick={()=>startPreview('streamer')}>{t('Preview as streamer')}</button></>}</div>}
   {ready&&!state&&<p>{t('Loading')}</p>}
   {state&&<>
    <p className="help">{t('Your language changes only your view. The draw is shared by everyone.')}</p>
    {view==='config'&&<><h2>{t('Extension setup')}</h2><p>{t('Use the existing dashboard to connect Twitch chat and configure the channel.')}</p><a target="_blank" rel="noreferrer" href={preview?location.origin:apiOrigin()}>{t('Open streamer dashboard ↗')}</a></>}
    {view!=='config'&&<><Wheel spin={presentation!.spin} entries={presentation!.entries} clock={clock}/><section className="spotlight" aria-live="polite"><h2>{inSpin?t('Who’s up next?'):result?.text||t('Every voice deserves a turn.')}</h2>{result&&<p>{result.label}</p>}</section>
    <details open={view!=='overlay'}><summary>{t('Question queue')}</summary><div className="questions">{state.groups.filter(g=>g.status==='pending'||g.asked).map(g=><article key={g.id}><strong>{g.title}</strong>{g.translationPending&&<p className="help">{t('Translation pending — showing original text.')}</p>}<p>{g.text}</p><small>{t('{v0} unique {v1}',{v0:g.count,v1:g.count===1?'supporter':'supporters'})}</small>{g.answer&&<blockquote>{g.answer}</blockquote>}{g.status==='pending'&&state.canParticipate&&<button disabled={busy} onClick={()=>act({type:'support',id:g.id})}>{t('Support this question')}</button>}{state.controller&&g.status==='pending'&&<button disabled={busy||inSpin} onClick={()=>act({type:'spotlight',id:g.id})}>{t('Spotlight ↗')}</button>}</article>)}</div></details>
    <details open={view!=='overlay'}><summary>{t('Ask your question')}</summary>{state.canParticipate?<><form onSubmit={async e=>{e.preventDefault();if(await act({type:'ask',text:question}))setQuestion('');}}><label>{t('Your question')}<textarea value={question} onChange={e=>setQuestion(e.target.value)} maxLength={500} minLength={3} required/></label><button disabled={busy}>{t('Submit question →')}</button></form><button disabled={busy||!state.registration&&!state.joined} onClick={()=>act({type:state.joined?'leave':'join'})}>{t(state.joined?'Leave participant wheel':'Join participant wheel')}</button></>:<><p>{t('Share your Twitch identity to participate.')}</p><button onClick={()=>window.Twitch?.ext.actions.requestIdShare()}>{t('Share identity with ChatSpin')}</button></>}</details>
    {state.controller&&(view==='live'||preview)&&<section className="controls"><h2>{t('Streamer dashboard')}</h2><label>{t('Selection method')}<select value={state.odds} disabled={busy||inSpin} onChange={e=>act({type:'odds',value:e.target.value})}><option value="equal">{t('Equal chances')}</option><option value="support">{t('By support')}</option><option value="manual">{t('Manual selection')}</option></select></label><div><button disabled={busy||inSpin} onClick={()=>act({type:'mode',value:state.mode==='questions'?'participants':'questions'})}>{t(state.mode==='questions'?'♧ Participant Wheel':'◉ Question Wheel')}</button><button disabled={busy||inSpin||!state.entries.length||state.mode==='questions'&&state.odds==='manual'} onClick={()=>act({type:'spin'})}>{t('✦ Spin the wheel')}</button><button disabled={busy||inSpin} onClick={()=>act({type:'toggle-registration'})}>{t(state.registration?'Close registration':'Registration open')}</button><button disabled={busy||inSpin} onClick={()=>act({type:'toggle-exclusion'})}>{t('Exclude previously selected people')}: {t(state.excludeSelected?'On':'Off')}</button></div>
    <label>{t('Review & answer →')}<select value={selected} onChange={e=>{setSelected(e.target.value);setAnswer(state.groups.find(g=>g.id===e.target.value)?.answer||'');}}><option value="">{t('Select a group')}</option>{state.groups.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}</select></label><label>{t('Written answer (optional)')}<textarea maxLength={2000} value={answer} onChange={e=>setAnswer(e.target.value)}/></label><button disabled={busy||inSpin||!selected} onClick={async()=>{if(await act({type:'answer',id:selected,text:answer,scope:'session'})){setSelected('');setAnswer('');}}}>{t('Mark answered')}</button>
    </section>}
    </>}
   </>}
  </section>
 </main>;
}
document.documentElement.classList.toggle('overlay-body',view==='overlay');
document.body.classList.toggle('overlay-body',view==='overlay');
createRoot(document.getElementById('root')!).render(<I18nProvider><ExtensionApp/></I18nProvider>);
