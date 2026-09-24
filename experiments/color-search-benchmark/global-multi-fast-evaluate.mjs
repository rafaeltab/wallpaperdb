// Same stored descriptors and objective; compare a typed Painless implementation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ROOT,api,readJson,saveJson,distribution,waitForIdle} from './global-common.mjs';
import {multiQuery,multiReference,boundedMultiSearch} from './global-multi.mjs';
import {closePit} from './global-bounded.mjs';
await waitForIdle();
const source=await readJson('global-multi-evaluation.json'),extended=await readJson('global-multi-verification.json'),data=await readJson('global-multi-data.json');
assert.equal(source.dataCacheKey,data.cacheKey);assert.equal(extended.dataCacheKey,data.cacheKey);
const index='color-global-multi-1000000-v1';
const queries=[...source.queries,{id:'partial3',colors:[{family:'red',amount:.2},{family:'orange',amount:.2},{family:'yellow',amount:.2}]},{id:'partial5',colors:['red','orange','yellow','green','blue'].map(family=>({family,amount:.1}))}];
const report={generatedAt:new Date().toISOString(),dataCacheKey:data.cacheKey,indexFingerprint:source.indexFingerprint,scriptVariant:'typed',index,sourceHashes:Object.fromEntries(await Promise.all(['global-multi-fast-evaluate.mjs','global-multi-fast-source.mjs','global-multi.mjs','global-joint-bounded.mjs'].map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,ROOT))).digest('hex')]))),correctness:[],timings:[],concurrency:[],failures:[]};
async function run(method,index,q,filter=[],extra={}){
  const start=performance.now();
  if(method==='adaptive'){
    const result=await boundedMultiSearch(index,q.colors,{size:20,filter,scriptVariant:'typed',...extra});
    await closePit(result.pitId);return {hits:result.hits,wallMs:performance.now()-start,threshold:result.threshold,requests:result.timing.requests+1,diagnostics:result.diagnostics};
  }
  const response=await api(`/${index}/_search?allow_partial_search_results=false`,multiQuery(q.colors,{size:20,filters:filter,scriptVariant:'typed',...extra}));
  assert.equal(response.body.timed_out,false);assert.equal(response.body._shards.failed,0);
  return {hits:response.body.hits.hits,wallMs:performance.now()-start,took:response.body.took,requests:1};
}
for(const q of queries){
  const oracle=data.wallpapers.map(doc=>({id:doc.id,...multiReference(doc,q.colors)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,20);
  for(const method of ['exhaustive','adaptive']){
    const result=await run(method,'color-global-multi-real-v1',q,[{term:{cohort:'real'}}]);
    assert.deepEqual(result.hits.map(h=>h._id),oracle.map(d=>d.id));result.hits.forEach((h,i)=>assert.equal(Math.fround(h._score),oracle[i].score));
    report.correctness.push({query:q.id,method,scale:100,passed:true});
  }
  for(const [selectivity,filter]of [['all',[]],['one_percent',[{term:{partition:0}}]]]){
    const baseline=await run('exhaustive',index,q,filter);
    const original=extended.extendedOracle.find(row=>row.query===q.id);
    if(selectivity==='all'&&original){assert.deepEqual(baseline.hits.map(h=>({id:h._id,score:h._score})),original.top20);report.correctness.push({query:q.id,scale:1000000,comparison:'original90s oracle versus typed',passed:true});}
    for(const method of ['exhaustive','adaptive']){
      try{
        const warm=await run(method,index,q,filter);assert.deepEqual(warm.hits.map(h=>h._id),baseline.hits.map(h=>h._id));assert.deepEqual(warm.hits.map(h=>h._score),baseline.hits.map(h=>h._score));
        report.correctness.push({query:q.id,scale:1000000,method,selectivity,passed:true});
        const samples=[],n=warm.wallMs>1000?5:15;
        for(let i=0;i<n;i++)samples.push(await run(method,index,q,filter));
        const row={query:q.id,regions:q.colors.length,method,selectivity,wallMs:distribution(samples.map(r=>r.wallMs)),took:method==='exhaustive'?distribution(samples.map(r=>r.took)):null,threshold:samples[0].threshold,requests:samples[0].requests,diagnostics:samples[0].diagnostics};
        report.timings.push(row);console.log(`${q.id} ${selectivity} typed-${method}: median${row.wallMs.median.toFixed(1)}ms, p95${row.wallMs.p95.toFixed(1)}ms`);
      }catch(error){report.failures.push({query:q.id,method,selectivity,error:error.message});console.log(`FAILED typed ${q.id}/${method}: ${error.message.slice(0,300)}`);}
      await saveJson('global-multi-fast-evaluation.json',report);
    }
  }
}
for(const q of queries.filter(q=>['red70dark30','warm30_30_40','dark40blue30navy30','rainbow20','partial5'].includes(q.id))){
  const samples=[],started=performance.now();let next=0;
  await Promise.all(Array.from({length:4},async()=>{while(next<40){next++;samples.push((await run('adaptive',index,q)).wallMs);}}));
  const row={query:q.id,inFlight:4,wallMs:distribution(samples),elapsedMs:performance.now()-started};
  report.concurrency.push(row);console.log(`Concurrent4 typed-adaptive ${q.id}: median${row.wallMs.median.toFixed(1)}ms, p95${row.wallMs.p95.toFixed(1)}ms`);
  await saveJson('global-multi-fast-evaluation.json',report);
}
report.completedAt=new Date().toISOString();await saveJson('global-multi-fast-evaluation.json',report);
console.log(`Typed script evaluation complete: ${report.correctness.length} correctness cases, ${report.failures.length} failures.`);
if(report.failures.length)process.exitCode=1;
