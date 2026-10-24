import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, type WebSocket } from 'ws';
import { TwitchConnection } from '../server/twitch.ts';
test('EventSub subscribes, deduplicates notifications, reconnects, and handles revocation', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address(); if(!address || typeof address==='string') throw new Error('Expected a TCP address');
  const originalFetch = globalThis.fetch;
  let subscriptions = 0, connections = 0, received = 0; let current: WebSocket | undefined;
  globalThis.fetch = (async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.type,'channel.chat.message'); assert.equal(payload.condition.broadcaster_user_id,'owner');
    assert.equal(payload.condition.user_id,'owner'); assert.equal(payload.transport.method,'websocket');
    subscriptions++; return new Response('{}',{status:202});
  }) as typeof fetch;
  server.on('connection',socket=>{current=socket;connections++;socket.send(JSON.stringify({metadata:{message_type:'session_welcome'},payload:{session:{id:'session-'+connections}}}));});
  const client = new TwitchConnection({access_token:'test',refresh_token:'test',expires_in:3600},'owner',()=>received++,`ws://127.0.0.1:${address.port}`);
  const until = async (condition: ()=>boolean) => { const deadline=Date.now()+8000; while(!condition()) { if(Date.now()>deadline) throw new Error('Expected EventSub state not reached'); await new Promise(resolve=>setTimeout(resolve,20)); } };
  try {
    await client.start(); await until(()=>client.status==='Connected'); assert.equal(subscriptions,1);
    const notification=JSON.stringify({metadata:{message_type:'notification',message_id:'duplicate'},payload:{event:{chatter_user_id:'viewer',chatter_user_name:'Viewer',message:{text:'!ask How do I start?'}}}});
    current!.send(notification); current!.send(notification); await until(()=>received===1); assert.equal(received,1);
    current!.close(); await until(()=>connections===2 && client.status==='Connected'); assert.equal(subscriptions,2);
    current!.send(JSON.stringify({metadata:{message_type:'revocation'},payload:{}})); await until(()=>client.status.includes('revoked'));
  } finally { client.stop(); for(const socket of server.clients) socket.terminate(); server.close(); globalThis.fetch=originalFetch; }
});
