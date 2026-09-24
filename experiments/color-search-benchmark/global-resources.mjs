// Longer isolated blocks avoid attributing cached OpenSearch CPU counters to subsecond tests.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {api,readJson,saveJson,distribution,waitForIdle} from './global-common.mjs';
import {multiQuery,boundedMultiSearch} from './global-multi.mjs';
import {closePit} from './global-bounded.mjs';
const index='color-global-multi-1000000-v1';
const evidence=await readJson('global-multi-evaluation.json');
await waitForIdle();
const queries=evidence.queries.filter(q=>['red70dark30','rainbow20'].includes(q.id));
const report={generatedAt:new Date().toISOString(),index,dataCacheKey:evidence.dataCacheKey,scriptVariant:'typed',blockSeconds:8,inFlight:4,notes:['Each measured block lasts at least8seconds;1.2seconds idle before and after lets cached process counters refresh.','CPU includes node background/GC activity in the block; shared-host contention remains possible.','This measures a prototype coordinator and OpenSearch. Image extraction, production gateway logic and remote-user network latency are excluded.'],rows:[]};
const idle=()=>new Promise(resolve=>setTimeout(resolve,1200));
const stats=async()=>(await api('/_nodes/stats/jvm,process')).body;
const cpu=stats=>Object.values(stats.nodes).reduce((sum,node)=>sum+node.process.cpu.total_in_millis,0);
async function run(method,q){
  const start=performance.now();
  if(method==='adaptive'){
    const result=await boundedMultiSearch(index,q.colors,{size:20,scriptVariant:'typed'});
    await closePit(result.pitId);
  }else{
    const result=(await api(`/${index}/_search?allow_partial_search_results=false`,multiQuery(q.colors,{size:20,scriptVariant:'typed'}))).body;
    assert.equal(result.timed_out,false);assert.equal(result._shards.failed,0);assert.equal(result.hits.hits.length,20);
  }
  return performance.now()-start;
}
for(const q of queries)for(const method of ['exhaustive','adaptive']){
  await run(method,q);await idle();
  const before=await stats(),start=performance.now(),processStart=process.cpuUsage();
  const samples=[];
  await Promise.all(Array.from({length:4},async()=>{while(performance.now()-start<8000)samples.push(await run(method,q));}));
  const elapsedMs=performance.now()-start,serviceCpu=process.cpuUsage(processStart),memory=process.memoryUsage();
  await idle();const after=await stats();
  for(const id of Object.keys(before.nodes))assert.ok(after.nodes[id].process.timestamp>before.nodes[id].process.timestamp,'CPU counter did not refresh.');
  const row={query:q.id,method,requests:samples.length,elapsedMs,wallMs:distribution(samples),queriesPerSecond:samples.length/(elapsedMs/1000),openSearchCpuMs:cpu(after)-cpu(before),openSearchCpuMsPerQuery:(cpu(after)-cpu(before))/samples.length,serviceCpu,serviceCpuMsPerQuery:(serviceCpu.user+serviceCpu.system)/1000/samples.length,serviceMemory:memory,nodeBefore:before,nodeAfter:after};
  report.rows.push(row);await saveJson('global-resources.json',report);
  console.log(`${q.id}/${method}: ${row.queriesPerSecond.toFixed(1)}queries/s, p95${row.wallMs.p95.toFixed(1)}ms, OS CPU${row.openSearchCpuMsPerQuery.toFixed(1)}ms/query, service CPU${row.serviceCpuMsPerQuery.toFixed(2)}ms/query`);
}
report.completedAt=new Date().toISOString();await saveJson('global-resources.json',report);
