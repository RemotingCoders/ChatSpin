import type {IncomingMessage,ServerResponse} from 'node:http';
import {createCloudApp} from '../server/cloud.js';
import {SupabaseRepository} from '../server/supabase.js';
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
 }catch(error){const message=error instanceof Error?error.message:'';const safe=['Invalid APP_URL','Invalid URL','SUPABASE_URL must be an HTTPS project origin.','SUPABASE_SECRET_KEY is missing.','SESSION_SECRET must be a random production secret of at least 32 characters.'].includes(message)?message:'ChatSpin backend is not configured. Check server environment variables.';res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:safe}));}
}
