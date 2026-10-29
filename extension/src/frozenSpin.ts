import type {Spin} from '../../server/domain';
// The server can finish a personal translation while a shared draw is running.
// Freeze the first visible projection for that draw/language; never change its geometry.
export class FrozenSpin {
 private key='';private snapshot:Spin|null=null;
 read(spin:Spin|null,language:string,now:number):Spin|null{
  if(!spin||spin.end<=now){this.key='';this.snapshot=null;return spin;}
  const key=spin.id+':'+language;
  if(key!==this.key){this.key=key;this.snapshot=structuredClone(spin);}
  return this.snapshot;
 }
}
