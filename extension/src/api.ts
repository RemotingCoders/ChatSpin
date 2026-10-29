import type {ExtensionClaims} from '../server/auth';
import type {extensionState} from '../server/service';
export type ExtensionState=ReturnType<typeof extensionState>;
export type PersonalLanguage='inherit'|'original'|'en'|'es'|'ru'|'de';
export function apiOrigin(){
 const configured=import.meta.env.VITE_EXTENSION_API_ORIGIN;
 if(!configured)throw Error('Extension backend URL is not configured.');
 const url=new URL(configured);if(url.pathname!=='/'||url.search||url.hash||url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Extension backend URL is not configured.');return url.origin;
}
export async function extensionRequest(path:string,token:string|undefined,body?:unknown,preview=false){
 const base=preview?'/api/extension-preview':apiOrigin()+'/extension-api';
 const response=await fetch(base+path,{method:body?'POST':'GET',credentials:preview?'same-origin':'omit',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Something went wrong. Please try again.');return data;
}
