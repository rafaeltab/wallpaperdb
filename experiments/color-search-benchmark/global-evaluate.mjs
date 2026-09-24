// THROWAWAY: actual OpenSearch global-ranking correctness, quality proxies, and timings.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {ROOT,api,readJson,saveJson,REAL_INDEX,indexName,distribution} from './global-common.mjs';
import {NATIVE_FAMILIES,nativeQuery,tokenQuery,nativeReference,tokenReference} from './global-native.mjs';
import {dynamicQuery,referenceScore} from './global-dynamic.mjs';
import {jointQuery,jointReference} from './global-joint.mjs';
import {boundedSearch,closePit} from './global-bounded.mjs';
const OUTPUT=process.env.GLOBAL_OUTPUT??'global-evaluation.json';

export const QUERIES=[
  {id:'green40',colors:[{family:'green',amount:.4}]},
  {id:'red50green50',colors:[{family:'red',amount:.5},{family:'green',amount:.5}]},
  {id:'red70dark30',colors:[{family:'red',amount:.7},{family:'dark',amount:.3}]},
  {id:'dark90',colors:[{family:'dark',amount:.9}]},
  {id:'grayscale40',colors:[{family:'grayscale',amount:.4}]},
  {id:'rainbow20',colors:['red','orange','yellow','green','blue'].map(family=>({family,amount:.2}))},
];
const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const data=await readJson('global-data.json'),docs=[...data.wallpapers,...data.fixtures];
const regions=q=>q.colors.map(c=>({...NATIVE_FAMILIES.find(f=>f.id===c.family),amount:c.amount}));
const realFilter=[{term:{cohort:'real'}}];
const report={generatedAt:new Date().toISOString(),dataCacheKey:data.cacheKey,sourceHashes:Object.fromEntries(await Promise.all(['global-evaluate.mjs','global-native.mjs','global-bounded.mjs','global-joint.mjs','global-dynamic.mjs'].map(async p=>[p,createHash('sha256').update(await readFile(new URL(p,ROOT))).digest('hex')]))),environment:(await api('/')).body,correctness:[],quality:[],timings:[],concurrency:[],profiles:[],failures:[],notes:['Latency includes local client JSON/network time; warm runs on a shared development host, not production capacity proof.','Synthetic scale documents are mixtures/reweighted descriptors, not independent wallpapers.','Quality uses declared area-error proxies and sampled pixels, not human relevance labels.','Native/token methods use marginal family amounts; joint/dynamic methods allocate each area once. Hard boundaries only in joint prototypes.']};
if(process.env.GLOBAL_TIMINGS_ONLY==='1'){
  const prior=await readJson(OUTPUT);
  assert.equal(prior.dataCacheKey,data.cacheKey,'Timing-only reuse requires validation for the same data.');
  assert.ok(prior.correctness.length&&prior.quality.length,'Run corpus validation before timing-only evaluation.');
  report.correctness=prior.correctness;report.quality=prior.quality;
  report.reusedValidation={generatedAt:prior.generatedAt,sourceHashes:prior.sourceHashes};
}

async function request(index,body){
  const result=await api(`/${index}/_search?allow_partial_search_results=false`,{...body,timeout:'15s'});
  assert.equal(result.body.timed_out,false,'Search timed out.');assert.equal(result.body._shards.failed,0,'Partial shard failure.');
  return {hits:result.body.hits.hits,wallMs:result.wallMs,took:result.body.took,body:result.body,requests:1};
}
let jointBounded;
try{({boundedJointSearch:jointBounded}=await import('./global-joint-bounded.mjs'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
if(jointBounded)report.sourceHashes['global-joint-bounded.mjs']=createHash('sha256').update(await readFile(new URL('global-joint-bounded.mjs',ROOT))).digest('hex');
async function run(method,index,q,filter=[],extra={}){
  const start=performance.now();
  if(method==='bounded'||method==='joint-bounded'){
    const result=await (method==='bounded'?boundedSearch:jointBounded)(index,q.colors,{size:20,filter,...extra});
    await closePit(result.pitId);
    return {hits:result.hits,wallMs:performance.now()-start,took:result.timing?.searchTookMs??null,requests:result.timing?result.timing.requests+1:null,diagnostics:result.diagnostics,threshold:result.threshold,body:{profile:result.profile}};
  }
  const body=method==='tokens'?tokenQuery(q.colors,{filter,size:20,...extra}):method==='joint'?jointQuery(q.colors,{filters:filter,size:20,track_total_hits:false,...extra}):method==='dynamic'?dynamicQuery(regions(q),{filters:filter,size:20,trackTotalHits:false,...extra}):nativeQuery(q.colors,{filter,size:20,precision:method==='fine'?'fine':'bucket',...extra});
  return request(index,body);
}
function expected(method,q,documents){
  return documents.map(doc=>({id:doc.id,...(method==='joint'?jointReference(doc,q.colors):method==='dynamic'?referenceScore(doc,regions(q)):method==='tokens'?tokenReference(doc,q.colors):nativeReference(doc,q.colors,{precision:method==='fine'||method==='bounded'?'fine':'bucket'}))})).sort((a,b)=>method==='dynamic'?a.cost-b.cost||byId(a,b):b.score-a.score||byId(a,b));
}
function verify(result,oracle,method,size=20){
  assert.equal(result.hits.length,Math.min(size,oracle.length),'Result page cardinality differs from the global oracle.');
  assert.equal(new Set(result.hits.map(h=>h._id)).size,result.hits.length,'Result page contains duplicate IDs.');
  if(method!=='dynamic')assert.deepEqual(result.hits.map(h=>h._id),oracle.slice(0,size).map(d=>d.id));
  else assert.ok(result.hits.every((hit,i)=>Math.abs(hit.sort[0]-oracle[i].cost)<1e-9),'Dynamic global order differs beyond numerical tolerance.');
  for(const hit of result.hits){const doc=oracle.find(d=>d.id===hit._id);const actual=method==='dynamic'?hit.sort[0]:method==='joint'?Math.fround(hit._score):hit._score;assert.ok(Math.abs(actual-(method==='dynamic'?doc.cost:doc.score))<1e-9,`Score mismatch ${method}/${hit._id}`);}
}

if(process.env.GLOBAL_TIMINGS_ONLY!=='1'){
  for(const q of QUERIES){
    const methods=['numeric','tokens','fine','bounded',...(q.colors.length<=2?['joint','dynamic',...(jointBounded?['joint-bounded']:[])]:[])];
    for(const method of methods){
      for(const [label,filter,eligible]of [['all',[],docs],['real',realFilter,data.wallpapers],['partition',[{term:{partition:0}}],docs.filter(d=>d.partition===0)]]){
        const result=await run(method,REAL_INDEX,q,filter);
        const referenceMethod=method==='joint-bounded'?'joint':method;
        verify(result,expected(referenceMethod,q,eligible),referenceMethod);
        report.correctness.push({query:q.id,method,filter:label,documents:eligible.length,passed:true});
      }
    }
    const fine=expected('fine',q,data.wallpapers),bucket=expected('tokens',q,data.wallpapers);
    const trueMarginal=doc=>q.colors.reduce((sum,c)=>sum+Math.abs(doc.features[c.family]-c.amount),0);
    const oracleMarginal=[...data.wallpapers].sort((a,b)=>trueMarginal(a)-trueMarginal(b)||byId(a,b));
    const errorFor=ranking=>ranking.slice(0,10).reduce((sum,d)=>sum+trueMarginal(data.wallpapers.find(x=>x.id===d.id)),0)/10;
    const quality={query:q.id,colors:q.colors,marginal:{oracleTop10MeanError:errorFor(oracleMarginal),fineTop10MeanError:errorFor(fine),bucketTop10MeanError:errorFor(bucket),fineTop10:fine.slice(0,10).map(d=>d.id),bucketTop10:bucket.slice(0,10).map(d=>d.id)}};
    quality.marginal.bucketTop1Regret=trueMarginal(data.wallpapers.find(d=>d.id===bucket[0].id))-trueMarginal(oracleMarginal[0]);
    quality.marginal.fineTop1Regret=trueMarginal(data.wallpapers.find(d=>d.id===fine[0].id))-trueMarginal(oracleMarginal[0]);
    quality.marginal.bucketFineSameTop10Positions=fine.slice(0,10).filter((d,i)=>d.id===bucket[i].id).length;
    if(q.colors.length<=2){
      const joint=expected('joint',q,data.wallpapers),palette=expected('dynamic',q,data.wallpapers);
      const cost=id=>joint.find(d=>d.id===id).cost;
      quality.joint={pixelTop10MeanError:joint.slice(0,10).reduce((s,d)=>s+d.cost,0)/10,paletteSelectedTop10PixelMeanError:palette.slice(0,10).reduce((s,d)=>s+cost(d.id),0)/10,paletteCostAbsoluteError:distribution(palette.map(d=>Math.abs(d.cost-cost(d.id)))),pixelTop10:joint.slice(0,10).map(d=>d.id),paletteTop10:palette.slice(0,10).map(d=>d.id),largestDisagreements:palette.map(d=>({id:d.id,paletteError:d.cost,pixelError:cost(d.id),difference:Math.abs(d.cost-cost(d.id))})).sort((a,b)=>b.difference-a.difference).slice(0,5)};
    }
    report.quality.push(quality);
  }
  console.log(`Global real-corpus checks passed: ${report.correctness.length}.`);
  await saveJson(OUTPUT,report);
}

const counts=(process.env.GLOBAL_COUNTS??'10000,100000,1000000').split(',').filter(Boolean).map(Number);
const repetitions=Number(process.env.GLOBAL_REPETITIONS??15);
for(const count of counts){
  const nativeIndex=indexName('native',count);
  for(const q of QUERIES){
    for(const [selectivity,filter]of [['all',[]],['one_percent',[{term:{partition:0}}]]]){
      const baseline=await run('fine',nativeIndex,q,filter);
      const jointBaseline=q.colors.length<=2?await run('joint',nativeIndex,q,filter):null;
      const methods=['numeric','tokens','fine','bounded',...(jointBaseline?['joint',...(jointBounded?['joint-bounded']:[])]:[])];
      for(const method of methods){
        try{
          const warm=await run(method,nativeIndex,q,filter);
          if(method==='bounded')assert.deepEqual(warm.hits.map(h=>h._id),baseline.hits.map(h=>h._id));
          if(method==='joint-bounded')assert.deepEqual(warm.hits.map(h=>h._id),jointBaseline.hits.map(h=>h._id));
          const samples=[];
          for(let i=0;i<repetitions;i++)samples.push(await run(method,nativeIndex,q,filter));
          const row={index:nativeIndex,count,query:q.id,method,selectivity,wallMs:distribution(samples.map(s=>s.wallMs)),took: samples.every(s=>s.took!==null)?distribution(samples.map(s=>s.took)):null,requests: samples[0].requests,threshold:samples[0].threshold,diagnostics:samples[0].diagnostics};
          report.timings.push(row);console.log(`${count} ${q.id} ${selectivity} ${method}: median ${row.wallMs.median.toFixed(1)}ms, p95 ${row.wallMs.p95.toFixed(1)}ms`);
        }catch(error){report.failures.push({count,query:q.id,method,selectivity,error:error.message});console.log(`FAILED ${count} ${q.id} ${method}: ${error.message.slice(0,500)}`);}
      }
      await saveJson(OUTPUT,report);
    }
  }
  // Heavy flexible baseline: three examples, broad and 1% filters; fewer repetitions if slow.
  if(count<=100000)for(const q of [QUERIES[0],QUERIES[2],QUERIES[4]])for(const [selectivity,filter]of [['all',[]],['one_percent',[{term:{partition:0}}]]]){
    try{
      const warm=await run('dynamic',indexName('dynamic',count),q,filter);
      const samples=[];const n=warm.wallMs>1000?5:repetitions;
      for(let i=0;i<n;i++)samples.push(await run('dynamic',indexName('dynamic',count),q,filter));
      const row={index:indexName('dynamic',count),count,query:q.id,method:'dynamic',selectivity,wallMs:distribution(samples.map(s=>s.wallMs)),took:distribution(samples.map(s=>s.took)),requests:1};
      report.timings.push(row);console.log(`${count} ${q.id} ${selectivity} dynamic: median ${row.wallMs.median.toFixed(1)}ms, p95 ${row.wallMs.p95.toFixed(1)}ms`);
    }catch(error){report.failures.push({count,query:q.id,method:'dynamic',selectivity,error:error.message});}
    await saveJson(OUTPUT,report);
  }
  // Profiles are separate from timing runs; inspect scored-document counts, not just execution names.
  for(const method of ['numeric','tokens','fine','bounded','joint',...(jointBounded?['joint-bounded']:[])]){
    const profiled=await run(method,nativeIndex,QUERIES[2],[],{profile:true});
    report.profiles.push({count,method,profile:profiled.body.profile});
  }
  await saveJson(OUTPUT,report);
}
if(counts.includes(1000000)){
  for(const q of [QUERIES[0],QUERIES[2],QUERIES[5]])for(const method of ['tokens','fine','bounded',...(q.colors.length<=2&&jointBounded?['joint-bounded']:[])]){
    const samples=[],started=performance.now(),cpu=process.cpuUsage();
    const before=(await api('/_nodes/stats/jvm,process')).body;
    let next=0;
    await Promise.all(Array.from({length:4},async()=>{while(next<40){next++;samples.push(await run(method,indexName('native',1000000),q));}}));
    const after=(await api('/_nodes/stats/jvm,process')).body;
    const row={count:1000000,query:q.id,method,inFlight:4,wallMs:distribution(samples.map(s=>s.wallMs)),elapsedMs:performance.now()-started,serviceCpuMicroseconds:process.cpuUsage(cpu),serviceMemory:process.memoryUsage(),nodeBefore:before,nodeAfter:after};
    report.concurrency.push(row);console.log(`Concurrent4 ${q.id} ${method}: median ${row.wallMs.median.toFixed(1)}ms, p95 ${row.wallMs.p95.toFixed(1)}ms`);
    await saveJson(OUTPUT,report);
  }
}
report.finishedAt=new Date().toISOString();
report.serviceMemory=process.memoryUsage();
report.node=(await api('/_nodes/stats/jvm,process,os,indices')).body;
await saveJson(OUTPUT,report);
console.log(`Evaluation complete: ${report.correctness.length} correctness cases; ${report.timings.length} timing cases; ${report.failures.length} failures.`);
if(report.failures.length)process.exitCode=1;
