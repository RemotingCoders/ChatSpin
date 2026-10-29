import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OperationsPanel} from '../src/OperationsPanel.tsx';
import {emptyState} from '../server/domain.ts';
import {parseModeratorIds} from '../src/hostedSettings.ts';
import type {ViewState} from '../src/types.ts';
test('Hosted operation controls hide all user-configurable AI budgets; local controls remain',()=>{
 const state={...emptyState(),groups:[],serverTime:Date.now()} as ViewState;
 const render=()=>renderToStaticMarkup(createElement(OperationsPanel,{state,busy:false,inSpin:false,act:async()=>true}));
 assert.match(render(),/AI calls per live session/);assert.match(render(),/Save limits/);
 state.hosted=true;const html=render();assert.doesNotMatch(html,/AI calls per live session|Save limits|Budget used/);assert.match(html,/Channel moderators/);assert.match(html,/Channel backups/);
});
test('Moderator entry rejects names and malformed IDs and deduplicates explicit numeric IDs',()=>{
 assert.deepEqual(parseModeratorIds('123, 456\n123'),['123','456']);assert.deepEqual(parseModeratorIds(''),[]);
 assert.throws(()=>parseModeratorIds('123, @viewer'));assert.throws(()=>parseModeratorIds('123;456'));
 assert.throws(()=>parseModeratorIds(Array.from({length:21},(_,i)=>String(i+1)).join(',')));
});
