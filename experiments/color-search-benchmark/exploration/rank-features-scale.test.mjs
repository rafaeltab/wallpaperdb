import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkload,summarizeTrials,beginInvocation,WORKLOAD } from './rank-features-scale.mjs';
import { RANK_FEATURE_METHODS,supportsRankFeatures } from './methods-rank-features.mjs';

test('rank-feature scale workload records all 16 cases and supports the same 13 for both methods',()=>{
  assert.equal(WORKLOAD.length,16);
  for(const method of RANK_FEATURE_METHODS)assert.equal(WORKLOAD.filter(item=>supportsRankFeatures(method,item.query).supported).length,13);
});

test('sustained workload meets duration and minimum repetitions without dropping slow requests',async()=>{
  let clock=0;const seen=[];
  const result=await runWorkload({items:['A','B','C'],concurrency:1,repetitions:2,durationMs:10,now:()=>clock,trial:async(item,ordinal)=>{seen.push(item);clock++;return {ordinal,elapsedMs:1};}});
  assert.equal(result.trials.length,10);assert.equal(result.elapsedMs,10);
  assert.deepEqual(seen.slice(0,6),['A','B','C','B','C','A']);
  clock=0;
  const slow=await runWorkload({items:['A','B','C'],concurrency:1,repetitions:2,durationMs:2,now:()=>clock,trial:async()=>{clock+=3;return {elapsedMs:3};}});
  assert.equal(slow.trials.length,6);assert.equal(slow.elapsedMs,18);
});

test('concurrency is bounded and every started request is retained',async()=>{
  let active=0,maximum=0;
  const result=await runWorkload({items:['A','B','C'],concurrency:4,repetitions:4,trial:async(item,ordinal)=>{
    maximum=Math.max(maximum,++active);await new Promise(resolve=>setImmediate(resolve));active--;return {ordinal,item};
  }});
  assert.equal(maximum,4);assert.equal(active,0);assert.equal(result.trials.length,12);
  assert.deepEqual(result.trials.map(row=>row.ordinal),Array.from({length:12},(_,i)=>i));
});

test('scale viability rejects warmup failures, exact one-second observations, and empty evidence',()=>{
  const successful=[{elapsedMs:5}],slow=[{elapsedMs:1000}],error=[{elapsedMs:3,error:'timeout'}];
  assert.equal(summarizeTrials(successful,successful).viableAtTestedLoad,true);
  for(const [trials,warmups] of [[successful,slow],[successful,error],[slow,successful],[error,successful],[[],successful],[successful,[]]])assert.equal(summarizeTrials(trials,warmups).viableAtTestedLoad,false);
});

test('starting a rerun clears the overall completion marker and preserves previous completion evidence',()=>{
  const result={finishedAt:'2026-09-20T01:00:00Z',invocations:[{id:'old'}]};
  beginInvocation(result,{id:'new',at:'2026-09-20T02:00:00Z'});
  assert.equal(result.finishedAt,undefined);
  assert.equal(result.invocations[0].finishedAt,'2026-09-20T01:00:00Z');
  assert.equal(result.invocations[1].id,'new');
  assert.equal(result.invocations[1].finishedAt,undefined);
});
