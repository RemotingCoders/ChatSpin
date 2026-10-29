import {useLayoutEffect,useRef,useState,type CSSProperties,type PointerEvent,type KeyboardEvent} from 'react';
import {fitPanel,restorePanel,rememberPanel,type PanelPosition} from './overlayPosition';
export function useOverlayPosition(enabled:boolean,channel:string){
 const ref=useRef<HTMLElement|null>(null),current=useRef<PanelPosition>({x:0,y:0}),saved=useRef<unknown>(null);
 const [position,setPosition]=useState<PanelPosition|null>(null),[dragging,setDragging]=useState(false);
 const drag=useRef<{id:number;x:number;y:number;start:PanelPosition}|null>(null);
 const key='chatspin.extension.position.'+channel;
 const bounds=()=>({width:ref.current?.offsetWidth||0,height:ref.current?.offsetHeight||0,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight});
 function place(next:PanelPosition){current.current=fitPanel(next,bounds());setPosition(current.current);}
 function persist(){saved.current=rememberPanel(current.current,bounds());try{localStorage.setItem(key,JSON.stringify(saved.current));}catch{}}
 useLayoutEffect(()=>{
  if(!enabled||!ref.current)return;
  saved.current=null;try{saved.current=JSON.parse(localStorage.getItem(key)||'null');}catch{}
  const resize=()=>place(restorePanel(saved.current,bounds()));
  resize();const observer=new ResizeObserver(resize);observer.observe(ref.current);
  window.addEventListener('resize',resize);document.addEventListener('fullscreenchange',resize);
  return()=>{observer.disconnect();window.removeEventListener('resize',resize);document.removeEventListener('fullscreenchange',resize);};
 },[enabled,key]);
 function onPointerDown(event:PointerEvent<HTMLButtonElement>){
  if(!enabled||!event.isPrimary||event.button!==0)return;
  event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
  drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,start:current.current};setDragging(true);
 }
 function onPointerMove(event:PointerEvent<HTMLButtonElement>){const active=drag.current;if(active?.id!==event.pointerId)return;place({x:active.start.x+event.clientX-active.x,y:active.start.y+event.clientY-active.y});}
 function finish(event:PointerEvent<HTMLButtonElement>){if(drag.current?.id!==event.pointerId)return;drag.current=null;setDragging(false);persist();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
 function onKeyDown(event:KeyboardEvent<HTMLButtonElement>){
  const amount=event.shiftKey?40:10,delta:Record<string,PanelPosition>={ArrowLeft:{x:-amount,y:0},ArrowRight:{x:amount,y:0},ArrowUp:{x:0,y:-amount},ArrowDown:{x:0,y:amount}};
  if(event.key==='Home'){event.preventDefault();saved.current=null;place(restorePanel(null,bounds()));persist();return;}
  const move=delta[event.key];if(!move)return;event.preventDefault();place({x:current.current.x+move.x,y:current.current.y+move.y});persist();
 }
 return {ref,style:enabled&&position?{left:position.x,top:position.y,right:'auto',margin:0} as CSSProperties:undefined,dragging,handle:{onPointerDown,onPointerMove,onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,onKeyDown}};
}
