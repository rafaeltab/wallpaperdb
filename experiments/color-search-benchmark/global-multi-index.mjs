// Isolated indexes for source-pixel membership atoms; does not replace earlier evidence.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {ROOT,api,bulk,recreateIndex,readJson,saveJson,metadataProperties,indexName} from './global-common.mjs';
import {MULTI_PROPERTIES,toMultiDocument,multiMixture} from './global-multi.mjs';
const data=await readJson('global-multi-data.json');
const bases=[...data.wallpapers,...data.fixtures];
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceHashes=Object.fromEntries(await Promise.all(['global-multi-index.mjs','global-multi.mjs'].map(async p=>[p,hash(await readFile(new URL(p,ROOT)))])));
const fingerprint=hash(JSON.stringify({sourceHashes,data:hash(await readFile(new URL('global-multi-data.json',ROOT)))}));
let previous;
try{previous=await readJson('global-multi-indexing.json');}catch{previous={indexes:[]};}
const report={generatedAt:new Date().toISOString(),fingerprint,sourceHashes,dataCacheKey:data.cacheKey,indexes:previous.indexes.filter(r=>r.fingerprint===fingerprint)};
async function build(index,count,at){
  if(report.indexes.some(r=>r.index===index))try{if((await api(`/${index}/_count`)).body.count===count){console.log(`Reusing ${index}`);return;}}catch{}
  const properties={...metadataProperties,...MULTI_PROPERTIES};
  await recreateIndex(index,properties);
  const start=performance.now();let sumBulkMs=0,atomsTotal=0,atomsMax=0;
  for(let offset=0;offset<count;offset+=2000){
    const batches=[offset,offset+1000].filter(n=>n<count).map(first=>Array.from({length:Math.min(1000,count-first)},(_,j)=>{
      const raw=at(first+j);atomsTotal+=raw.atoms.length;atomsMax=Math.max(atomsMax,raw.atoms.length);
      return {...toMultiDocument(raw),cohort:raw.cohort??'synthetic',partition:raw.partition??(first+j)%100,reference_id:raw.reference_id??raw.id};
    }));
    for(const ms of await Promise.all(batches.map(docs=>bulk(index,docs))))sumBulkMs+=ms;
    if((offset+2000)%20000===0||offset+2000>=count)console.log(`${index}: ${Math.min(count,offset+2000)}/${count}, ${((performance.now()-start)/1000).toFixed(1)}s`);
  }
  await api(`/${index}/_refresh`,{});
  if((await api(`/${index}/_count`)).body.count!==count)throw new Error('Incorrect indexed count.');
  const row={index,count,fingerprint,fields:Object.keys(properties).length,wallMs:performance.now()-start,sumBulkMs,atomsMean:atomsTotal/count,atomsMax,stats:(await api(`/${index}/_stats/docs,store,segments,indexing`)).body._all.primaries};
  report.indexes=report.indexes.filter(r=>r.index!==index);report.indexes.push(row);await saveJson('global-multi-indexing.json',report);
  console.log(`Finished ${index}: ${(row.stats.store.size_in_bytes/1024/1024).toFixed(1)} MiB; mean${row.atomsMean.toFixed(1)} atoms.`);
}
await build('color-global-multi-real-v1',bases.length,i=>bases[i]);
for(const count of (process.env.GLOBAL_COUNTS??'100000,1000000').split(',').filter(Boolean).map(Number)){
  if(!Number.isInteger(count)||count<1||count>1000000)throw new Error('Invalid GLOBAL_COUNTS.');
  await build(indexName('multi',count),count,i=>multiMixture(i,bases));
}
report.completedAt=new Date().toISOString();await saveJson('global-multi-indexing.json',report);
