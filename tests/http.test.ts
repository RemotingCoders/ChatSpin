import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('HTTP authorization, privacy, origin protection, duplicate support, and OBS snapshot', async () => {
  const port = 14500 + Math.floor(Math.random()*1000), origin = `http://localhost:${port}`;
  const dir = mkdtempSync(join(tmpdir(),'chatspin-test-'));
  const child = spawn(process.execPath,['--import','tsx','server/index.ts'], { env: { ...process.env, PORT: String(port), APP_URL: origin, DATA_FILE: join(dir,'state.json'), ENABLE_DEMO:'true', NODE_ENV:'test', OPENAI_API_KEY:'', TWITCH_CLIENT_ID:'', TWITCH_CLIENT_SECRET:'' }, stdio:['ignore','pipe','pipe'] });
  try {
    await new Promise<void>((resolve,reject) => {
      const timeout = setTimeout(()=>reject(new Error('Test server did not start')),15000);
      child.stdout.on('data', data=>{ if(String(data).includes('ChatSpin is running')) {clearTimeout(timeout);resolve();} });
      child.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Test server exited: ${code}`));});
    });
    async function call(path: string, cookie = '', body?: unknown, source = origin) {
      return fetch(origin+path,{headers:{cookie,Origin:source,...(body ? {'Content-Type':'application/json'} : {})},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
    }
    assert.equal((await call('/api/state')).status,401);
    assert.equal((await call('/api/demo','',{},'https://untrusted.example')).status,403);
    assert.equal((await call('/api/overlay?token=wrong')).status,403);
    const signIn = async (role: string) => { const r=await call('/api/demo','',{role}); assert.equal(r.status,200); return r.headers.get('set-cookie')!.split(';')[0]; };
    const admin = await signIn('streamer'), alice = await signIn('viewer'), bob = await signIn('viewer');
    assert.equal((await (await call('/api/session',alice)).json()).controller,false);
    for (const type of ['spin','answer','merge','split','settings','registration','reopen']) assert.equal((await call('/api/action',alice,{type})).status,403);
    await call('/api/action',alice,{type:'ask',text:'My private original question'});
    let a=await (await call('/api/state',alice)).json();
    const own=a.groups.find((g: {text:string})=>g.text==='My private original question');
    assert.equal(own.questions.length,1); assert.equal(a.obsUrl,undefined);
    let b=await (await call('/api/state',bob)).json(); assert.equal(b.groups.find((g: {id:string})=>g.id===own.id).questions.length,0);
    await call('/api/action',alice,{type:'support',id:own.id}); await call('/api/action',alice,{type:'ask',text:'My private original question'});
    a=await (await call('/api/state',alice)).json(); assert.equal(a.groups.find((g: {id:string})=>g.id===own.id).count,1);
    await call('/api/action',admin,{type:'answer',id:own.id,text:'Approved exact answer'});
    a=await (await call('/api/state',alice)).json(); b=await (await call('/api/state',bob)).json();
    assert.equal(a.groups.find((g: {id:string})=>g.id===own.id).answer,'Approved exact answer');
    assert.equal(b.groups.find((g: {id:string})=>g.id===own.id).answer,'');
    await call('/api/action',bob,{type:'ask',text:'My private original question'});
    b=await (await call('/api/state',bob)).json(); assert.equal(b.groups.find((g: {id:string})=>g.id===own.id).answer,'Approved exact answer');
    await call('/api/action',admin,{type:'reopen',id:own.id});
    assert.equal((await call('/api/action',admin,{type:'spin',id:own.id})).status,200);
    const dashboard=await (await call('/api/state',admin)).json();
    const overlayUrl=new URL(dashboard.obsUrl);
    const overlay=await (await call(overlayUrl.pathname.replace('/obs','/api/overlay')+overlayUrl.search)).json();
    assert.deepEqual(overlay.spin,dashboard.spin); assert.equal(overlay.groups,undefined); assert.equal(dashboard.spin.winner,own.id);
    await call('/api/action',admin,{type:'spin'});
    assert.equal((await call('/api/action',admin,{type:'spin'})).status,409);
    await call('/api/action',admin,{type:'registration',value:false});
  } finally { child.kill(); await new Promise(resolve=>child.once('exit',resolve)); rmSync(dir,{recursive:true,force:true}); }
});
