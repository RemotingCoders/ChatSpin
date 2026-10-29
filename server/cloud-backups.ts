import {cleanupAnswerTranslations} from './domain.js';
import type {SupabaseRepository} from './supabase.js';
export async function restoreCloudBackup(repository:SupabaseRepository,channel:string,id:string){
 const backup=await repository.backup(channel,id);
 await repository.mutate(channel,s=>{
  if(s.spin&&s.spin.end>Date.now())throw Object.assign(Error('Wait for the current spin to finish.'),{status:409});
  const moderators=s.moderatorIds,rates=s.cloudRates;
  for(const key of Object.keys(s))delete (s as any)[key];Object.assign(s,structuredClone(backup.state));
  delete s.cloudLease;delete s.cloudMaintenance;s.moderatorIds=moderators;s.cloudRates=rates;
  // Restore content, not historical side effects or authentication coordination.
  s.replyJobs=[];s.pendingMessages=[];s.spin=null;cleanupAnswerTranslations(s,'clear');
 },true);
}
