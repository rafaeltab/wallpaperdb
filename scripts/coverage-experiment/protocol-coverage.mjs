import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import convert from '../../.coverage-experiment/converter.mjs';
const require=createRequire(import.meta.url);
const {parse}=createRequire(require.resolve('vitest'))('acorn');
export async function verifyProtocolCoverage(directory,generated,original) {
 const code=await readFile(generated,'utf8');
 const mapName=[...code.matchAll(/sourceMappingURL=([^\s]+)/g)].at(-1)?.[1];
 assert.ok(mapName,'compiled production source must provide its map');
 const mapBytes=await readFile(new URL(mapName,pathToFileURL(generated)),'utf8');
 const map=JSON.parse(mapBytes);
 assert.deepEqual(map.sources,[original]);
 assert.equal(map.sourcesContent[0],await readFile(original,'utf8'));
 const recordings=[];
 for(const name of await readdir(directory))if(name.endsWith('.json')){
  const raw=JSON.parse(await readFile(directory+'/'+name,'utf8'));
  for(const script of raw.result)if(script.url===pathToFileURL(generated).href)recordings.push(script);
 }
 assert.equal(recordings.length,1,'one actual production child recording expected');
 const result=await convert({code,coverage:recordings[0],sourceMap:map,ast:parse(code,{ecmaVersion:'latest',sourceType:'module'})});
 assert.deepEqual(Object.keys(result),[original]);
 const coverage=result[original];
 const count=name=>Object.entries(coverage.fnMap).filter(([,f])=>f.name===name).map(([id])=>coverage.f[id]);
 assert.deepEqual(count('readRecord'),[200],'read-mode child calls the original readRecord exactly200 times');
 assert.deepEqual(count('publisher'),[0],'read-mode child never calls publisher');
 for(const value of [...Object.values(coverage.s),...Object.values(coverage.f),...Object.values(coverage.b).flat()])assert.ok(Number.isSafeInteger(value)&&value>=0);
 const root=(process.env.EXPERIMENT_REPO_OUTPUT_ROOT||fileURLToPath(new URL('../../.coverage-experiment/evidence',import.meta.url)))+'/protocol-child';
 await mkdir(root,{recursive:true});const evidence=await mkdtemp(root+'/attempt-');
 await Promise.all([writeFile(evidence+'/generated.js',code),writeFile(evidence+'/generated.js.map',mapBytes),writeFile(evidence+'/raw.json',JSON.stringify(recordings)),writeFile(evidence+'/converted.json',JSON.stringify(result))]);
 console.log('Actual production child: raw JS identity, exact original TS map, readRecord200/publisher0',evidence);
}
