// Actual OpenSearch evaluation of original-pixel, joint1–5-region matching.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {ROOT,api,readJson,saveJson,indexName,distribution,waitForIdle} from './global-common.mjs';
import {multiQuery,multiReference,boundedMultiSearch} from './global-multi.mjs';
import {closePit} from './global-bounded.mjs';
import {minCostTransport} from './proportions.mjs';
import {NATIVE_FAMILIES} from './global-native.mjs';
const data=await readJson('global-multi-data.json'),indexing=await readJson('global-multi-indexing.json');
assert.equal(data.cacheKey,indexing.dataCacheKey,'Dataset and indexed descriptor versions must agree.');
assert.equal(data.wallpapers.length,100);assert.equal(data.fixtures.length,20);
await waitForIdle();
const queries=[
  {id:'green40',colors:[{family:'green',amount:.4}]},
  {id:'red70dark30',colors:[{family:'red',amount:.7},{family:'dark',amount:.3}]},
  {id:'grayscale40',colors:[{family:'grayscale',amount:.4}]},
  {id:'warm30_30_40',colors:[{family:'red',amount:.3},{family:'orange',amount:.3},{family:'yellow',amount:.4}]},
  {id:'dark40blue30navy30',colors:[{family:'dark',amount:.4},{family:'blue',amount:.3},{family:'navy',amount:.3}]},
  {id:'rainbow20',colors:['red','orange','yellow','green','blue'].map(family=>({family,amount:.2}))},
];
const report={generatedAt:new Date().toISOString(),dataCacheKey:data.cacheKey,indexFingerprint:indexing.fingerprint,sourceHashes:Object.fromEntries(await Promise.all(['global-multi-evaluate.mjs','global-multi.mjs','global-joint.mjs','global-joint-bounded.mjs'].map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,ROOT))).digest('hex')]))),sampling:'Approximately65,536 original RGBA pixels, deterministic jittered strata; exact alpha-byte counts per membership mask. Synthetic scale images are three-basis descriptor mosaics quantized to1e9 mass units.',queries,correctness:[],realRankings:[],timings:[],concurrency:[],profiles:[],failures:[]};
async function run(method,index,q,filters=[],extra={}){
  const start=performance.now();
  if(method==='adaptive'){
    const result=await boundedMultiSearch(index,q.colors,{size:20,filter:filters,...extra});
    await closePit(result.pitId);
    return {hits:result.hits,wallMs:performance.now()-start,requests:result.timing.requests+1,threshold:result.threshold,diagnostics:result.diagnostics,profile:result.profile};
  }
  const response=await api(`/${index}/_search?allow_partial_search_results=false`,multiQuery(q.colors,{size:20,filters,...extra}));
  assert.equal(response.body.timed_out,false,'Timed-out search.');assert.equal(response.body._shards.failed,0,'Partial shard failure.');
  return {hits:response.body.hits.hits,wallMs:performance.now()-start,took:response.body.took,requests:1,profile:response.body.profile};
}
const idSort=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
for(const q of queries){
  const bits=q.colors.map(c=>1<<NATIVE_FAMILIES.findIndex(f=>f.id===c.family)),Q=q.colors.reduce((s,c)=>s+c.amount,0);
  for(const doc of [...data.wallpapers,...data.fixtures]){
    const matrix=doc.atoms.map(atom=>[...bits.map(bit=>atom.mask&bit?0:1),bits.some(bit=>atom.mask&bit)?1:0]);
    const transport=minCostTransport(doc.atoms.map(a=>a.count/doc.total),[...q.colors.map(c=>c.amount),1-Q],matrix).cost;
    assert.ok(Math.abs(transport-multiReference(doc,q.colors).cost)<1e-9,`Transport disagreement for${doc.id}/${q.id}`);
  }
  for(const [label,filters,docs]of [['all',[],[...data.wallpapers,...data.fixtures]],['real',[{term:{cohort:'real'}}],data.wallpapers]]){
    const oracle=docs.map(doc=>({id:doc.id,...multiReference(doc,q.colors)})).sort((a,b)=>b.score-a.score||idSort(a,b));
    for(const method of ['exhaustive','adaptive']){
      const result=await run(method,'color-global-multi-real-v1',q,filters);
      assert.equal(result.hits.length,Math.min(20,oracle.length));assert.equal(new Set(result.hits.map(h=>h._id)).size,result.hits.length);
      assert.deepEqual(result.hits.map(h=>h._id),oracle.slice(0,20).map(d=>d.id));
      result.hits.forEach((h,i)=>assert.equal(Math.fround(h._score),oracle[i].score));
      report.correctness.push({query:q.id,method,filter:label,passed:true});
    }
    if(label==='real')report.realRankings.push({query:q.id,top20:oracle.slice(0,20),within10pp:oracle.filter(d=>d.cost<=.1).length});
  }
}
console.log(`Multi real corpus: ${report.correctness.length} global checks plus720 direct transport checks passed.`);
await saveJson('global-multi-evaluation.json',report);
for(const count of (process.env.GLOBAL_COUNTS??'100000,1000000').split(',').filter(Boolean).map(Number)){
  const index=indexName('multi',count);
  assert.ok(indexing.indexes.some(row=>row.index===index&&row.count===count),'Missing matching index manifest.');
  assert.equal((await api(`/${index}/_count`)).body.count,count,'Actual index size differs from the benchmark.');
  for(const q of queries)for(const [selectivity,filters]of [['all',[]],['one_percent',[{term:{partition:0}}]]]){
    let baseline;
    for(const method of ['exhaustive','adaptive']){
      try{
        const warm=await run(method,index,q,filters);
        if(method==='exhaustive')baseline=warm.hits.map(h=>h._id);
        if(baseline)assert.deepEqual(warm.hits.map(h=>h._id),baseline);
        const samples=[],n=warm.wallMs>1000?5:15;
        for(let i=0;i<n;i++)samples.push(await run(method,index,q,filters));
        const row={count,query:q.id,regions:q.colors.length,selectivity,method,wallMs:distribution(samples.map(s=>s.wallMs)),took:method==='exhaustive'?distribution(samples.map(s=>s.took)):null,requests:samples[0].requests,threshold:samples[0].threshold,diagnostics:samples[0].diagnostics};
        report.timings.push(row);console.log(`${count} ${q.id} ${selectivity} ${method}: median${row.wallMs.median.toFixed(1)}ms, p95${row.wallMs.p95.toFixed(1)}ms`);
      }catch(error){report.failures.push({count,query:q.id,selectivity,method,error:error.message});console.log(`FAILED ${count}/${q.id}/${method}: ${error.message.slice(0,300)}`);}
      await saveJson('global-multi-evaluation.json',report);
    }
  }
  for(const method of ['exhaustive','adaptive']){
    if(method==='exhaustive'&&report.failures.some(f=>f.count===count&&f.query===queries.at(-1).id&&f.method===method&&f.selectivity==='all')){
      report.profiles.push({count,method,skipped:'Unprofiled full query already exceeded its timeout.'});
      continue;
    }
    try{const result=await run(method,index,queries.at(-1),[],{profile:true});report.profiles.push({count,method,profile:result.profile});}
    catch(error){report.failures.push({count,method,stage:'profile',error:error.message});}
  }
}
if((process.env.GLOBAL_COUNTS??'100000,1000000').includes('1000000'))for(const q of [queries[1],queries[3],queries[5]]){
  const samples=[],started=performance.now();let next=0;
  await Promise.all(Array.from({length:4},async()=>{while(next<40){next++;samples.push(await run('adaptive',indexName('multi',1000000),q));}}));
  const row={count:1000000,query:q.id,method:'adaptive',inFlight:4,wallMs:distribution(samples.map(s=>s.wallMs)),elapsedMs:performance.now()-started};
  report.concurrency.push(row);console.log(`Concurrent4 ${q.id} adaptive: median${row.wallMs.median.toFixed(1)}ms p95${row.wallMs.p95.toFixed(1)}ms`);
  await saveJson('global-multi-evaluation.json',report);
}
report.completedAt=new Date().toISOString();await saveJson('global-multi-evaluation.json',report);
console.log(`Multi evaluation complete; ${report.failures.length} failures.`);
if(report.failures.length)process.exitCode=1;
