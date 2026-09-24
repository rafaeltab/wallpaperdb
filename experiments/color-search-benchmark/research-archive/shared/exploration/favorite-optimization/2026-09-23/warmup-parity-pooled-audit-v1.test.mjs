// Prepared only; run after capacity timing ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { configuration, METHODS, verifyPooledWitness, verifyPinnedSnapshot, compareWarmups } from './warmup-parity-pooled-audit-v1.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('pooled campaign defaults require all4 methods,3selectivities and explicit source/overlap bindings',()=>{
 const args=['--directory','/tmp/screen','--receipt','/tmp/receipt','--audit','/tmp/audit','--output','/tmp/output','--pins','/tmp/pins','--overlap','/tmp/overlap'];
 const c=configuration(args);assert.equal(c.count,1000000);assert.equal(c.scope,'full');assert.deepEqual(c.methods,METHODS);assert.equal(c.selectivities.length,3);
 assert.throws(()=>configuration(args.slice(0,-2)));
 assert.ok(c.methods.includes('favorite-utility-bounded-pooled-delete'));assert.ok(c.methods.includes('favorite-utility-maxima-bounded-pooled-delete'));
});
test('both pooled warmups need a real single-attempt native cleanup witness',()=>{
 for(const method of METHODS.filter(method=>method.endsWith('-pooled-delete'))){
  const evidence={method,parentMethod:method.replace('-pooled-delete',''),transport:{kind:'favorite-pooled-pit-delete',version:1,nativeDeleteRequests:1,nativeDeleteResponses:1,attempts:1,reusedConnections:1}};
  verifyPooledWitness(evidence,method);
  for(const mutate of [x=>delete x.transport,x=>x.transport.attempts=2,x=>x.parentMethod='favorite-utility-numeric',x=>x.transport.nativeDeleteResponses=0]){
   const changed=structuredClone(evidence);mutate(changed);assert.throws(()=>verifyPooledWitness(changed,method));
  }
 }
});
test('source/config pin binding rejects altered archived source or configuration',()=>{
 const configurationBytes=Buffer.from(JSON.stringify({candidates:[{id:'fixture'}]})),sources={'exploration/fixture.mjs':'saved source'},workspace='/workspace';
 const pins={experiment:'favorite-pooled-retry-source-pins',pinCount:44,workspace,pins:[
  {path:'/saved/config.json',sha256:hash(configurationBytes),bytes:configurationBytes.length},
  {path:workspace+'/experiments/color-search-benchmark/exploration/fixture.mjs',sha256:hash('saved source'),bytes:Buffer.byteLength('saved source')},
  ...Array.from({length:42},(_,i)=>({path:'/other/'+i,sha256:'irrelevant',bytes:0}))]};
 const plan={configuration:{configFile:'/saved/config.json'},configHash:hash(configurationBytes),candidates:[{id:'fixture'}]},campaign={configHash:plan.configHash};
 const data={pins,sources,plan,campaign,configurationBytes};assert.equal(verifyPinnedSnapshot(data).archivedSourcesBound,1);
 assert.throws(()=>verifyPinnedSnapshot({...data,sources:{'exploration/fixture.mjs':'changed'}}));
 assert.throws(()=>verifyPinnedSnapshot({...data,configurationBytes:Buffer.from('{}')}));
 assert.throws(()=>verifyPinnedSnapshot({...data,sources:{'exploration/unknown.mjs':'saved source'}}));
});
test('pooled numeric scores have no single-sort raw-score exception',()=>{
 const make=transport=>{const hits=Array.from({length:20},(_,i)=>({id:'favorite-synthetic-'+String(i).padStart(9,'0'),score:transport?Math.fround(.9-i*.02):.9-i*.02}));return {hits,hitCount:20,hitsHash:hash(JSON.stringify(hits)),elapsedMs:2};};
 for(const method of METHODS.filter(method=>method.endsWith('-pooled-delete')))assert.equal(compareWarmups(make(false),make(true),{method,targets:1,count:1000000,selectivity:'all'}).status,'mismatch');
});
