import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildClickHouseQuery,supportsClickHouse,searchClickHouse } from './methods-clickhouse.mjs';
import { toClickHouseDocument,validateClickHouseReal } from './clickhouse-index.mjs';
import { safeClickHouseTable,arrayParameter } from './clickhouse-service.mjs';
import { buildPrecisionTypedQuery } from './methods-precision-typed.mjs';
import { INDEX,STORE,searchIndex,loadExpandedCorpus,hash } from './service.mjs';
import { precisionWorkload,summarizeTrials } from './clickhouse-scale.mjs';

test('ClickHouse compiler parameterizes filters and keeps all ranking in SQL',()=>{
  const injected="x') OR 1=1 --";
  const body=buildClickHouseQuery({query:{swatchHex:'#ff2200'},eligibleIds:[injected],excludedIds:['b'],filter:{range:{partition:{lt:10}}},limit:20});
  assert.match(body.sql,/ORDER BY score DESC,id ASC LIMIT/);
  assert.doesNotMatch(body.sql,/OR 1=1/);
  assert.match(Object.values(body.params).join(','),/OR 1=1/);
  assert.equal(supportsClickHouse({text:'red'}).supported,false);
  assert.throws(()=>buildClickHouseQuery({query:{swatchHex:'#ff2200'},filter:{term:{unrecognized:'x'}}}),/Unsupported/);
  assert.throws(()=>safeClickHouseTable('production.wallpapers'),/Unsafe/);
  assert.equal(arrayParameter(["a'b",'c\\d']),"['a\\'b','c\\\\d']");
});
test('ClickHouse descriptor retains duplicate centroid mass and full precision',()=>{
  const p=0xff2200*65536+300, doc=toClickHouseDocument({id:'duplicate',palette32_packed:[p,15784,p],palette_total:16384});
  assert.equal(doc.palette_l.length,3);
  assert.equal(doc.palette_w.reduce((a,b)=>a+b,0),1);
  assert.equal(doc.palette_l[1],doc.palette_l[2]);
});
test('ClickHouse scale workload matches seven swatches and never hides failures in percentiles',()=>{
  assert.equal(precisionWorkload({filtered:false}).length,7);
  assert.equal(precisionWorkload().length,21);
  const summary=summarizeTrials([{elapsedMs:4,serviceTookMs:3},{elapsedMs:1200,error:'timeout',overOneSecond:true}]);
  assert.equal(summary.errors,1);assert.equal(summary.overOneSecond,1);assert.equal(summary.p95Ms,1200);assert.equal(summary.successfulP95Ms,4);
});
test('ClickHouse rejects unbounded or invalid per-query parallelism before HTTP',async()=>{
  for(const maxThreads of [0,9,1.5,NaN,'1'])await assert.rejects(searchClickHouse({query:{swatchHex:'#ff2200'},maxThreads}),/maxThreads/);
});
test('ClickHouse real service agrees with OpenSearch typed precision and applies metadata before ranking',{skip:process.env.COLOR_EXPLORATION_CLICKHOUSE_TEST!=='1'},async()=>{
  const corpus=await loadExpandedCorpus();
  const validation=await validateClickHouseReal({expectedIds:corpus.map(c=>c.id)});
  assert.equal(validation.count,545);
  const queries=['#ff2200','#4c8c72','#808080','#101010','#dd6600','#8030b0','#20b8d0'].map(swatchHex=>({swatchHex}));
  queries.push({mode:'vibe',targets:[{color:'#ff2200',space:'oklab',tolerance:{distance:0},edgeWeight:.5}]});
  queries.push({mode:'vibe',targets:[{color:'#4c8c72',space:'oklab',tolerance:{distance:.2},edgeWeight:1}]});
  const results=[];
  for(const query of queries){
    const reference=await searchIndex(INDEX,buildPrecisionTypedQuery({query,limit:1000}));
    const actual=await searchClickHouse({query,limit:1000});
    assert.equal(actual.hits.length,545);
    const scores=new Map(reference.hits.map(h=>[h.id,h.score]));
    const maximumError=Math.max(...actual.hits.map(h=>Math.abs(h.score-scores.get(h.id))));
    assert.ok(maximumError<=2e-7,`Cross-service score error ${maximumError}`);
    assert.deepEqual(actual.hits.map(h=>h.id),reference.hits.map(h=>h.id));
    const oneThread=await searchClickHouse({query,limit:1000,maxThreads:1});
    assert.deepEqual(oneThread.hits,actual.hits);
    results.push({query,documents:545,maximumError,completeOrderEqual:true,evidence:actual.evidence,oneThreadScoreOrderEqual:true,oneThreadEvidence:oneThread.evidence});
  }
  const eligible=corpus.slice(0,12).map(c=>c.id),excluded=eligible.slice(0,3);
  const filtered=await searchClickHouse({query:{swatchHex:'#ff2200'},eligibleIds:eligible,excludedIds:excluded,limit:100,filter:{term:{partition:0}}});
  assert.equal(filtered.hits.length,9);
  assert.ok(filtered.hits.every(h=>eligible.includes(h.id)&&!excluded.includes(h.id)));
  const none=await searchClickHouse({query:{swatchHex:'#ff2200'},eligibleIds:[],limit:20});assert.equal(none.hits.length,0);
  const partition=await searchClickHouse({query:{swatchHex:'#ff2200'},filter:{term:{partition:1}},limit:20});assert.equal(partition.hits.length,0);
  await assert.rejects(validateClickHouseReal({expectedIds:[...corpus.slice(1).map(c=>c.id),'wrong-id']}),/coverage/);
  const artifact={createdAt:new Date().toISOString(),validation,results,filteredChecks:true,sourceHashes:Object.fromEntries(await Promise.all(['methods-clickhouse.mjs','clickhouse-service.mjs','clickhouse-index.mjs','methods-clickhouse.test.mjs','methods-precision-typed.mjs'].map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])))};
  await writeFile(path.join(STORE,'clickhouse-parity.json'),JSON.stringify(artifact,null,2));
});
