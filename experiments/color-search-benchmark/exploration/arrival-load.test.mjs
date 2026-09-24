import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalConfiguration,validateArrivalConfiguration,settleSearchQueue } from './arrival-load.mjs';

test('arrival configuration is importable without service calls and preserves supported workload',()=>{
  const config=arrivalConfiguration(['--methods','rank-features-vibe','--rates','50','--seconds','15']);
  const validated=validateArrivalConfiguration(config);
  assert.equal(validated.workloads['rank-features-vibe'].length,14);
  assert.equal(validated.unsupported['rank-features-vibe'].length,9);
  assert.ok(validated.workloads['rank-features-vibe'].some(item=>item.id==='five-color-portions'));
  assert.equal(config.durationMs,15000);
});

test('queue settling requires consecutive idle observations and records continuing background merges',async()=>{
  let clock=0,cursor=0;
  const states=[1,0,1,0,0];
  const result=await settleSearchQueue({now:()=>clock,sleep:async ms=>{clock+=ms;},intervalMs:5,timeoutMs:30,sample:async()=>({nodes:{one:{thread_pool:{search:{active:states[cursor++],queue:0}},indices:{search:{query_current:0,fetch_current:0},merges:{current:1}}}}})});
  assert.equal(result.settled,true);assert.equal(result.samples.length,5);assert.equal(result.elapsedMs,20);
  assert.equal(result.samples.at(-1).merges,1);
});

test('queue settling times out visibly and rejects missing service evidence',async()=>{
  let clock=0;
  const result=await settleSearchQueue({now:()=>clock,sleep:async ms=>{clock+=ms;},intervalMs:5,timeoutMs:15,sample:async()=>({nodes:{one:{thread_pool:{search:{active:0,queue:1}},indices:{search:{query_current:0,fetch_current:0}}}}})});
  assert.equal(result.settled,false);assert.equal(result.elapsedMs,15);assert.equal(result.samples.length,4);
  await assert.rejects(settleSearchQueue({sample:async()=>({nodes:{}})}),/No node search activity/);
});

test('arrival configuration rejects incomplete workload coverage and excessive or unknown arrivals before load',()=>{
  const config=arrivalConfiguration(['--methods','rank-features-vibe']);
  assert.throws(()=>validateArrivalConfiguration({...config,rates:[1],durationMs:1000}),/cover every supported query/);
  assert.throws(()=>validateArrivalConfiguration({...config,rates:[5000],durationMs:300000}),/1..1000000/);
  assert.throws(()=>validateArrivalConfiguration({...config,queryIds:['does-not-exist']}),/Unknown workload query/);
  assert.throws(()=>validateArrivalConfiguration({...config,selected:['clickhouse-palette-precision']}),/only supports OpenSearch/);
});
