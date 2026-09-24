// Compare seedless, globally certified range expansion with exhaustive scoring.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {ROOT,api,readJson,saveJson,indexName,distribution,waitForIdle} from './global-common.mjs';
import {nativeQuery} from './global-native.mjs';
import {jointQuery} from './global-joint.mjs';
import {boundedSearch,closePit} from './global-bounded.mjs';
import {boundedJointSearch} from './global-joint-bounded.mjs';
const source=await readJson('global-evaluation.json');
await waitForIdle();
assert.equal(source.quality.length,6,'Adaptive benchmark requires all six validated corpus queries.');
const index=indexName('native',1000000);
const indexing=await readJson('global-indexing.json');
assert.equal((await api(`/${index}/_count`)).body.count,1000000);
const report={generatedAt:new Date().toISOString(),index,dataCacheKey:source.dataCacheKey,indexFingerprint:indexing.indexes.find(row=>row.index===index)?.fingerprint,sourceHashes:Object.fromEntries(await Promise.all(['global-adaptive.mjs','global-bounded.mjs','global-joint-bounded.mjs','global-native.mjs','global-joint.mjs'].map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,ROOT))).digest('hex')]))),model:'Same declared objectives and same existing million-parent index as global-evaluation.json. No token seed; start at1pp error, double until a complete globally certified page is available.',correctness:[],timings:[],concurrency:[]};
async function run(method,q,filter=[]){
  const start=performance.now();
  const result=await (method==='adaptive-joint'?boundedJointSearch:boundedSearch)(index,q.colors,{size:20,filter,threshold:method==='adaptive-joint'?.01:100});
  await closePit(result.pitId);
  return {...result,wallMs:performance.now()-start};
}
for(const q of source.quality)for(const [selectivity,filter]of [['all',[]],['one_percent',[{term:{partition:0}}]]])for(const method of ['adaptive-fine',...(q.colors.length<=2?['adaptive-joint']:[])]){
  const body=method==='adaptive-joint'?jointQuery(q.colors,{filters:filter,track_total_hits:false}):nativeQuery(q.colors,{filter,precision:'fine'});
  const baseline=(await api(`/${index}/_search?allow_partial_search_results=false`,body)).body;
  assert.equal(baseline.timed_out,false);assert.equal(baseline._shards.failed,0);
  const warm=await run(method,q,filter);
  assert.deepEqual(warm.hits.map(h=>h._id),baseline.hits.hits.map(h=>h._id));
  report.correctness.push({query:q.query,method,selectivity,passed:true});
  const samples=[];
  for(let i=0;i<15;i++)samples.push(await run(method,q,filter));
  const row={query:q.query,method,selectivity,wallMs:distribution(samples.map(s=>s.wallMs)),threshold:samples[0].threshold,requests:samples[0].timing.requests+1,iterations:samples[0].diagnostics.iterations};
  report.timings.push(row);console.log(`${q.query} ${selectivity} ${method}: median${row.wallMs.median.toFixed(1)}ms p95${row.wallMs.p95.toFixed(1)}ms, ${row.iterations.length} searches`);
  await saveJson('global-adaptive-evaluation.json',report);
}
for(const q of source.quality.filter(q=>['green40','red70dark30','rainbow20'].includes(q.query)))for(const method of ['adaptive-fine',...(q.colors.length<=2?['adaptive-joint']:[])]){
  const before=(await api('/_nodes/stats/jvm,process')).body,started=performance.now(),cpu=process.cpuUsage(),samples=[];
  let next=0;
  await Promise.all(Array.from({length:4},async()=>{while(next<40){next++;samples.push(await run(method,q));}}));
  const row={query:q.query,method,inFlight:4,wallMs:distribution(samples.map(s=>s.wallMs)),elapsedMs:performance.now()-started,serviceCpuMicroseconds:process.cpuUsage(cpu),serviceMemory:process.memoryUsage(),nodeBefore:before,nodeAfter:(await api('/_nodes/stats/jvm,process')).body};
  report.concurrency.push(row);console.log(`Concurrent4 ${q.query} ${method}: median${row.wallMs.median.toFixed(1)}ms p95${row.wallMs.p95.toFixed(1)}ms`);
  await saveJson('global-adaptive-evaluation.json',report);
}
report.completedAt=new Date().toISOString();await saveJson('global-adaptive-evaluation.json',report);
