/** Merge a worker's changes into a newer channel revision without overwriting
 * concurrent actions. Conflicting edits are retried from persisted jobs. */
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export class RebaseConflict extends Error {}
export function rebase(base:any,change:any,current:any):any {
 if(equal(base,current)||equal(change,current))return change;
 if(equal(base,change))return current;
 if(Array.isArray(base)&&Array.isArray(change)&&Array.isArray(current)){
  const all=[...base,...change,...current];
  const key=all.every(x=>x&&typeof x==='object'&&typeof x.id==='string')?'id':all.every(x=>x&&typeof x==='object'&&typeof x.messageId==='string')?'messageId':null;
  if(key){
   const before=new Map(base.map(x=>[x[key],x])),next=new Map(change.map(x=>[x[key],x])),live=new Map(current.map(x=>[x[key],x]));
   const result:any[]=[];
   for(const id of new Set([...live.keys(),...next.keys()])){
    const value=rebase(before.get(id),next.get(id),live.get(id));if(value!==undefined)result.push(value);
   }
   return result;
  }
 }
 if(base&&change&&current&&![base,change,current].some(Array.isArray)&&[base,change,current].every(x=>typeof x==='object')){
  const out:Record<string,unknown>={};
  for(const key of new Set([...Object.keys(base),...Object.keys(change),...Object.keys(current)])){
   const value=rebase(base[key],change[key],current[key]);if(value!==undefined)out[key]=value;
  }
  return out;
 }
 throw new RebaseConflict('Concurrent changes require fresh processing.');
}
