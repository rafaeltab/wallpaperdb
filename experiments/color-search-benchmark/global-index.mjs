// THROWAWAY: build isolated, reproducible real and synthetic OpenSearch indexes.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {ROOT,api,bulk,recreateIndex,readJson,saveJson,metadataProperties,REAL_INDEX,indexName} from './global-common.mjs';
import {NATIVE_FAMILIES,NATIVE_PROPERTIES,toNativeDocument} from './global-native.mjs';
import {JOINT_PROPERTIES,toJointDocument} from './global-joint.mjs';
import {mappingProperties,toDynamicDocument} from './global-dynamic.mjs';
import {nativeMixture,dynamicMixture} from './global-load.mjs';

const data=await readJson('global-data.json');
const bases=[...data.wallpapers,...data.fixtures];
const sourceHashes=Object.fromEntries(await Promise.all(['global-index.mjs','global-load.mjs','global-native.mjs','global-joint.mjs','global-dynamic.mjs'].map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,ROOT))).digest('hex')])));
const fingerprint=createHash('sha256').update(JSON.stringify({sourceHashes,data:data.cacheKey})).digest('hex');
let previous;
try{previous=await readJson('global-indexing.json');}catch{previous={indexes:[]};}
const report={generatedAt:new Date().toISOString(),fingerprint,sourceHashes,dataCacheKey:data.cacheKey,environment:(await api('/')).body,indexes:previous.indexes.filter(x=>x.fingerprint===fingerprint)};
const meta=doc=>({cohort:doc.cohort,partition:doc.partition,reference_id:doc.reference_id??doc.id});
const nativeProperties={...metadataProperties,...NATIVE_PROPERTIES,...JOINT_PROPERTIES};
const nativeDoc=doc=>({...meta(doc),...toNativeDocument(doc),...toJointDocument(doc)});
const dynamicProperties={...metadataProperties,...mappingProperties};
const dynamicDoc=doc=>({...meta(doc),...toDynamicDocument(doc)});
const stats=async index=>{
  const result=(await api(`/${index}/_stats/docs,store,segments,indexing`)).body;
  return result._all.primaries;
};
async function build(index,count,properties,at){
  const existing=report.indexes.find(x=>x.index===index);
  if(existing){
    try{if((await api(`/${index}/_count`)).body.count===count){console.log(`Reusing ${index}: ${count} documents.`);return;}}catch{}
  }
  console.log(`Building ${index}: ${count} documents, ${Object.keys(properties).length} mapped fields.`);
  await recreateIndex(index,properties);
  const start=performance.now();let sumBulkMs=0;
  // Two batches in flight, at most 1000 documents each. Bound generator/service memory.
  for(let offset=0;offset<count;offset+=2000){
    const batches=[offset,offset+1000].filter(n=>n<count).map(first=>Array.from({length:Math.min(1000,count-first)},(_,i)=>at(first+i)));
    for(const ms of await Promise.all(batches.map(batch=>bulk(index,batch))))sumBulkMs+=ms;
    if((offset+2000)%20000===0||offset+2000>=count)console.log(`${index}: ${Math.min(count,offset+2000)}/${count}, ${((performance.now()-start)/1000).toFixed(1)}s`);
  }
  await api(`/${index}/_refresh`,{});
  const actual=(await api(`/${index}/_count`)).body.count;
  if(actual!==count)throw new Error(`Incorrect indexed count: ${actual} != ${count}`);
  const entry={index,count,fingerprint,wallMs:performance.now()-start,sumBulkMs,fields:Object.keys(properties).length,stats:await stats(index),generator:index===REAL_INDEX?'100 real wallpapers +20 analytic fixtures':index.includes('-native-')?'Convex mixtures of three real/analytic source-pixel descriptors; NOT independent photos.':'Reweighted real/analytic 32-color palettes; NOT independent photos.'};
  report.indexes=report.indexes.filter(x=>x.index!==index);report.indexes.push(entry);
  await saveJson('global-indexing.json',report);
  console.log(`Finished ${index}: ${(entry.stats.store.size_in_bytes/1024/1024).toFixed(1)} MiB.`);
}
await build(REAL_INDEX,bases.length,{...nativeProperties,...mappingProperties},i=>({...nativeDoc(bases[i]),...toDynamicDocument(bases[i])}));
const counts=(process.env.GLOBAL_COUNTS??'10000,100000,1000000').split(',').filter(Boolean).map(Number);
for(const count of counts){
  if(!Number.isInteger(count)||count<1||count>1000000)throw new Error('GLOBAL_COUNTS must contain positive integers up to 1000000.');
  await build(indexName('native',count),count,nativeProperties,i=>nativeDoc(nativeMixture(i,bases,NATIVE_FAMILIES)));
  if(count<=100000)await build(indexName('dynamic',count),count,dynamicProperties,i=>dynamicDoc(dynamicMixture(i,bases)));
}
report.completedAt=new Date().toISOString();
report.node=(await api('/_nodes/stats/jvm,process,os,indices')).body;
await saveJson('global-indexing.json',report);
