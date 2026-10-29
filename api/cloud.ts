import type {IncomingMessage,ServerResponse} from 'node:http';
import {createCloudApp} from '../server/cloud.ts';
import {SupabaseRepository} from '../server/supabase.ts';
let app:ReturnType<typeof createCloudApp>|undefined;
export default function handler(req:IncomingMessage,res:ServerResponse){
 try{
  if(!app){
   const origin=new URL(process.env.APP_URL||'');if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Invalid APP_URL');
   const secret=process.env.SESSION_SECRET||'';
   app=createCloudApp(new SupabaseRepository(process.env.SUPABASE_URL||'',process.env.SUPABASE_SECRET_KEY||'',secret),origin.origin,secret);
  }
  // Vercel rewrites carry the original logical route explicitly.
  const url=new URL(req.url||'/','https://local.invalid');
  const route=url.searchParams.get('__chatspin_route');
  if(route){if(!/^\/(api|auth|extension-api)(\/|$)/.test(route)){res.statusCode=400;res.end();return;}url.searchParams.delete('__chatspin_route');req.url=route+(url.searchParams.size?'?'+url.searchParams.toString():'');}
  app(req,res);
 }catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'ChatSpin backend is not configured. Check server environment variables.'}));}
}
