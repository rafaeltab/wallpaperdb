// Finish the original-script experiment after its recorded 15s profile timeout.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {api,readJson,saveJson,distribution,waitForIdle} from './global-common.mjs';
import {multiQuery,boundedMultiSearch} from './global-multi.mjs';
import {closePit} from './global-bounded.mjs';
await waitForIdle();
const index='color-global-multi-1000000-v1',source=await readJson('global-multi-evaluation.json');
const report={generatedAt:new Date().toISOString(),dataCacheKey:source.dataCacheKey,indexFingerprint:source.indexFingerprint,extendedOracle:[],concurrency:[],note:'Full1M generic-script oracle requests use90s timeout only to verify correctness; these are not successful15s-SLO latency samples. Original 15s timeouts remain in global-multi-evaluation.json.'};
for(const q of source.queries.filter(q=>q.colors.length>=3)){
  const body=multiQuery(q.colors,{size:20,timeout:'90s'});
  const baseline=await api(`/${index}/_search?allow_partial_search_results=false`,body);
  assert.equal(baseline.body.timed_out,false);assert.equal(baseline.body._shards.failed,0);
  const exact=await boundedMultiSearch(index,q.colors,{size:20});
  await closePit(exact.pitId);
  assert.deepEqual(exact.hits.map(h=>h._id),baseline.body.hits.hits.map(h=>h._id));
  assert.deepEqual(exact.hits.map(h=>h._score),baseline.body.hits.hits.map(h=>h._score));
  report.extendedOracle.push({query:q.id,baselineWallMs:baseline.wallMs,baselineTook:baseline.body.took,top20:exact.hits.map(h=>({id:h._id,score:h._score})),passed:true});
  console.log(`Extended global oracle ${q.id}: ${(baseline.wallMs/1000).toFixed(1)}s; adaptive ordered IDs and scores agree.`);
  await saveJson('global-multi-verification.json',report);
}
for(const q of source.queries.filter(q=>['red70dark30','warm30_30_40','dark40blue30navy30','rainbow20'].includes(q.id))){
  const samples=[],start=performance.now();let next=0;
  await Promise.all(Array.from({length:4},async()=>{while(next<40){next++;const started=performance.now();const response=await boundedMultiSearch(index,q.colors,{size:20});await closePit(response.pitId);samples.push(performance.now()-started);}}));
  report.concurrency.push({query:q.id,inFlight:4,wallMs:distribution(samples),elapsedMs:performance.now()-start});
  console.log(`Original adaptive concurrent4 ${q.id}: median${report.concurrency.at(-1).wallMs.median.toFixed(1)}ms p95${report.concurrency.at(-1).wallMs.p95.toFixed(1)}ms`);
  await saveJson('global-multi-verification.json',report);
}
report.completedAt=new Date().toISOString();await saveJson('global-multi-verification.json',report);
