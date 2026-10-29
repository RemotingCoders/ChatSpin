import {execFileSync} from 'node:child_process';
import{existsSync,unlinkSync}from'node:fs';
import{resolve}from'node:path';
const target=resolve('extension/chatspin-extension.zip');if(existsSync(target))unlinkSync(target);
execFileSync('zip',['-qr',target,'.'],{cwd:resolve('extension/dist')});console.log('Extension package created. Register/configure it in Twitch before hosted testing.');
