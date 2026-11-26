import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const directory=mkdtempSync(fileURLToPath(new URL('../../.coverage-experiment/build/entry-control-',import.meta.url)));
try {
 writeFileSync(directory+'/entry.ts','literal source data; not executable JavaScript');
 mkdirSync(directory+'/node_modules/bare.ts',{recursive:true});
 writeFileSync(directory+'/node_modules/bare.ts/package.json',JSON.stringify({name:'bare.ts',type:'module',exports:'./index.js'}));
 writeFileSync(directory+'/node_modules/bare.ts/index.js',`export const value = 'compiled';`);
 writeFileSync(directory+'/entry.js',`import {value} from 'bare.ts'; export const executed = value; export function neverCalled(){throw new Error('must stay uncalled')}`);
 const url=pathToFileURL(directory+'/entry.ts').href;
 const program=`import {readFileSync} from 'node:fs'; const app=await import(${JSON.stringify(url)}); console.log(JSON.stringify({value:app.executed,data:readFileSync(new URL(${JSON.stringify(url)}),'utf8')}));`;
 const result=spawnSync(process.execPath,['--import',fileURLToPath(new URL('./native-hook.mjs',import.meta.url)),'--input-type=module','-e',program],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),{value:'compiled',data:'literal source data; not executable JavaScript'});
 console.log('TS module launch resolves compiled identity; filesystem data is unchanged');
}finally{rmSync(directory,{recursive:true,force:true});}
