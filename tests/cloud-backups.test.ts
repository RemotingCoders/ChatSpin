import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './fixtures/cloud-db.ts';
import {restoreCloudBackup} from '../server/cloud-backups.ts';
import {addQuestion} from '../server/domain.ts';
import {cloudDashboardAction} from '../server/cloud-actions.ts';
import {extensionState} from '../extension/server/service.ts';
import {extensionController} from '../extension/server/auth.ts';

test('Cloud restore scopes previews and creates a pre-restore snapshot without replaying public jobs',async()=>{
 const {repository,snapshots}=database();
 await repository.mutate('101',s=>{addQuestion(s,{id:'1',name:'A'},'Saved question?');});
 await repository.mutate('101',s=>{s.groups=[];s.moderatorIds=['42'];},true);
 await assert.rejects(repository.backup('202','1'),/not found/);
 assert.equal((await repository.backups('101'))[0].groups,1);
 await restoreCloudBackup(repository,'101','1');
 const s=(await repository.load('101')).state;assert.equal(s.groups[0].text,'Saved question?');assert.deepEqual(s.moderatorIds,['42']);assert.deepEqual(s.replyJobs,[]);assert.equal(s.spin,null);assert.equal(snapshots.length,2);assert.equal(snapshots[1].state.groups.length,0);
});
test('Provider budgets cannot be changed from hosted actions and moderator IDs require validation',async()=>{
 const {repository}=database(),{state}=await repository.load('101'),owner={id:'101',name:'Owner'};
 assert.throws(()=>cloudDashboardAction(state,owner,{type:'limits',text:'{}'}),/operator/);
 cloudDashboardAction(state,owner,{type:'set-moderators',text:'["42","42"]'});assert.deepEqual(state.moderatorIds,['42']);
 assert.throws(()=>cloudDashboardAction(state,owner,{type:'set-moderators',text:'["bad"]'}));
 const claims={role:'moderator' as const,user_id:'42',opaque_user_id:'U42',channel_id:'101',exp:Date.now()/1000+300};
 assert.equal(extensionController(claims,state.moderatorIds!),true);assert.equal(extensionController({...claims,role:'viewer'},state.moderatorIds!),false);assert.equal(extensionController(claims,[]),false);
});
