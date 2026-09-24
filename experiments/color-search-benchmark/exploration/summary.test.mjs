import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJsonPruner,renderFindings, feedbackBackendReason } from './summary.mjs';
import { PRECISION_GRID_INDEX } from './precision-grid-index.mjs';

test('feedback accepts the declared real search engine and rejects mislabeled/local execution',()=>{
  assert.equal(feedbackBackendReason({id:'os-method'},{kind:'opensearch'}),null);
  assert.equal(feedbackBackendReason({id:'ch-method',engine:'clickhouse'},{kind:'clickhouse'}),null);
  assert.match(feedbackBackendReason({id:'ch-method',engine:'clickhouse'},{kind:'local-reference'}),/real search service/);
  assert.match(feedbackBackendReason({id:'ch-method',engine:'clickhouse'},{kind:'opensearch'}),/registered clickhouse engine/);
  assert.match(feedbackBackendReason({id:'os-method'},{kind:'clickhouse'}),/registered opensearch engine/);
});

test('saved ClickHouse feedback appears in findings with its engine and measured coverage',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'color-summary-clickhouse-'));
  try{
    const corpusStore=path.join(root,'corpus'),explorationStore=path.join(root,'exploration'),directory=path.join(corpusStore,'runs','clickhouse-fixture');
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(corpusStore,'expanded-corpus.json'),JSON.stringify({assets:[{id:'one'}]}));
    const method='clickhouse-palette-precision';
    const run={id:'clickhouse-fixture',createdAt:'2026-09-20T00:00:00Z',dataset:{corpusSize:1,hash:'dataset',corpusHash:'corpus'},candidates:[{
      id:method,label:'ClickHouse precision',configuration:{method},execution:{kind:'clickhouse'},cases:[],
      metadata:{limitations:['One precise target only.']},summary:{coverage:{ok:1,total:3,error:0},accuracy:{allPairs:{queryMacroAgreement:.8}},performance:{p95Ms:5,failures:0}},
    }]};
    await writeFile(path.join(directory,'run.json'),JSON.stringify(run));
    const {summary,html,markdown}=await renderFindings({corpusStore,explorationStore});
    const row=summary.methods.find(item=>item.id===method);
    assert.equal(row.engine,'clickhouse');
    assert.equal(row.record.execution.kind,'clickhouse');
    assert.deepEqual(row.record.coverage,{ok:1,total:3,error:0});
    assert.equal(row.million.length,0);
    assert.match(html,/ClickHouse · columnar-palette/);
    assert.match(markdown,/ClickHouse/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('ClickHouse scale artifacts retain backend resources and enforce their count-linked warmups',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'color-summary-clickhouse-scale-'));
  try{
    const corpusStore=path.join(root,'corpus'),explorationStore=path.join(root,'exploration'),directory=path.join(explorationStore,'clickhouse-scale','fixture');
    await mkdir(corpusStore,{recursive:true});await mkdir(directory,{recursive:true});
    await writeFile(path.join(corpusStore,'expanded-corpus.json'),JSON.stringify({assets:[{id:'one'}]}));
    const metadata={version:'26.3.9',hostname:'clickhouse-host',containerLimits:{cpus:8,memoryBytes:12884901888}};
    const method='clickhouse-palette-precision',table='color_exploration_scale_v1';
    const profile={method,engine:'clickhouse',table,count:1000000,concurrency:4,effectiveConcurrency:4,requests:20,p95Ms:50,maxMs:60,errors:0,overOneSecond:0,
      warmupErrors:0,warmupOverOneSecond:0,cpuMs:123,serviceCpuMs:4,maximumObservedServerRssBytes:456,maximumObservedServiceRssBytes:789};
    await writeFile(path.join(directory,'scale.json'),JSON.stringify({engine:'clickhouse',table,startedAt:'2026-09-20T00:00:00Z',sourceHashes:{fixture:'hash'},
      sourceSnapshot:path.join(directory,'source-snapshot.json'),indexing:[{count:1000000,metadata}],warmups:[{count:1000000,trials:[{elapsedMs:1000}]}],profiles:[profile]}));
    const {summary,html,markdown}=await renderFindings({corpusStore,explorationStore});
    const result=summary.methods.find(row=>row.id===method).million[0];
    assert.equal(result.status,'fail');
    assert.equal(result.warmupMaxMs,1000);
    assert.equal(result.engine,'clickhouse');
    assert.equal(result.table,table);
    assert.equal(result.observedServerRssBytes,456);
    assert.equal(result.peakObservedHeapBytes,undefined);
    assert.equal(summary.scaleRuns[0].version,'26.3.9');
    assert.deepEqual(summary.scaleRuns[0].topology.containerLimits,metadata.containerLimits);
    assert.match(summary.scaleRuns[0].provenanceLimitation,/archived/);
    assert.match(html,/ClickHouse/);
    assert.match(html,/26\.3\.9/);
    assert.match(html,/color_exploration_scale_v1/);
    assert.match(markdown,/clickhouse-host/);
    assert.match(html,/observedServerRssBytes/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('ClickHouse thread configurations remain separate and grid scale uses its own index',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'color-summary-service-configurations-'));
  try{
    const corpusStore=path.join(root,'corpus'),explorationStore=path.join(root,'exploration');
    await mkdir(corpusStore,{recursive:true});
    await writeFile(path.join(corpusStore,'expanded-corpus.json'),JSON.stringify({assets:[{id:'one'}]}));
    for(const threads of [1,8]){
      const directory=path.join(explorationStore,'clickhouse-scale',String(threads));await mkdir(directory,{recursive:true});
      const method='clickhouse-palette-precision',count=1000000;
      await writeFile(path.join(directory,'scale.json'),JSON.stringify({engine:'clickhouse',startedAt:'2026-09-20T00:00:00Z',configuration:{maxThreadsPerRequest:threads},
        warmups:[{method,count,trials:[{elapsedMs:2}]}],profiles:[{method,count,concurrency:4,requests:3,p95Ms:10,maxMs:11,errors:0,overOneSecond:0}]}));
    }
    const directory=path.join(explorationStore,'precision-grid-scale','fixture');await mkdir(directory,{recursive:true});
    const method='rank-features-precision-grid',count=1000000;
    await writeFile(path.join(directory,'scale.json'),JSON.stringify({engine:'opensearch',startedAt:'2026-09-20T00:00:00Z',
      warmups:[{method,count,trials:[{elapsedMs:2}]}],profiles:[{method,index:'dedicated-grid-index',count,concurrency:1,requests:3,p95Ms:10,maxMs:11,errors:0,overOneSecond:0}]}));
    const {summary,html}=await renderFindings({corpusStore,explorationStore});
    const clickhouse=summary.methods.find(row=>row.id==='clickhouse-palette-precision').million;
    assert.equal(clickhouse.length,2);
    assert.deepEqual(new Set(clickhouse.map(profile=>profile.maxThreadsPerRequest)),new Set([1,8]));
    const grid=summary.methods.find(row=>row.id===method).million[0];
    assert.equal(grid.engine,'opensearch');assert.equal(grid.index,'dedicated-grid-index');assert.equal(grid.status,'pass');
    assert.match(html,/8 threads\/query/);assert.match(html,/1 threads\/query/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('grid findings distinguish interpolated scores and compare only identical complete precision cases',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'color-summary-grid-comparison-'));
  try{
    const corpusStore=path.join(root,'corpus'),explorationStore=path.join(root,'exploration'),directory=path.join(corpusStore,'runs','grid-comparison');
    await mkdir(directory,{recursive:true});await mkdir(explorationStore,{recursive:true});
    await writeFile(path.join(corpusStore,'expanded-corpus.json'),JSON.stringify({assets:[{id:'one'}]}));
    const candidate=(method,agreement)=>({id:method,configuration:{method},execution:{kind:'opensearch'},setup:{descriptorHashes:{features:'same',gridComputation:'encoder'}},
      cases:[{caseId:'precision',status:'ok',accuracy:{status:'complete',allPairs:{agreement}}}],summary:{coverage:{ok:1,total:1,error:0},accuracy:{allPairs:{queryMacroAgreement:agreement}},performance:{failures:0}}});
    await writeFile(path.join(directory,'run.json'),JSON.stringify({id:'grid-comparison',dataset:{corpusSize:1,hash:'dataset',corpusHash:'corpus'},candidates:[candidate('palette-precision-typed',.8),candidate('rank-features-precision-grid',.9)]}));
    await writeFile(path.join(explorationStore,PRECISION_GRID_INDEX+'-diagnostics.json'),JSON.stringify({index:PRECISION_GRID_INDEX,queryCount:17,validation:{descriptorHash:'same',computationHash:'encoder'},summary:{meanTop20Recall:.81,meanTop20UtilityLoss:.004,maximumAbsoluteScoreError:.42}}));
    const {summary,html,markdown}=await renderFindings({corpusStore,explorationStore});
    assert.equal(summary.precisionComparison.available,true);
    assert.equal(summary.precisionComparison.assessed,1);
    assert.equal(summary.precisionComparison.candidateAgreement,.9);
    assert.equal(summary.precisionComparison.baselineAgreement,.8);
    assert.equal(summary.precisionComparison.diagnostics.queryCount,17);
    assert.match(html,/Interpolated color score/);assert.match(markdown,/Precision grid versus continuous palette/);
    assert.match(html,/81\.0%/);assert.match(html,/0\.4200/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('streaming projection preserves metrics and handles escaped strings at every chunk boundary',()=>{
  const input={text:'quotes " and slash \\ and snow ☃',hits:[{text:'fake } ] " braces',nested:[1,2]}],nested:{trials:null,metric:.75},samplesMs:'quoted "value"',resources:12,tail:[1,{hits:true,keep:'yes'}]};
  const expected={...input,hits:null,nested:{trials:null,metric:.75},samplesMs:null,resources:null,tail:[1,{hits:null,keep:'yes'}]};
  const source=JSON.stringify(input);
  for(const size of [1,2,7,128]){
    const parser=createJsonPruner(new Set(['hits','trials','samplesMs','resources']));let output='';
    for(let i=0;i<source.length;i+=size)output+=parser.feed(source.slice(i,i+size));
    parser.finish();assert.deepEqual(JSON.parse(output),expected);
  }
  const incomplete=createJsonPruner(new Set(['hits']));incomplete.feed('{"hits":[1,');
  assert.throws(()=>incomplete.finish(),/inside a JSON value/);
});

test('strict scale status includes warmups, exact one-second boundary, and missing evidence',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'color-summary-'));
  try{
    const corpusStore=path.join(root,'corpus'),explorationStore=path.join(root,'exploration'),directory=path.join(explorationStore,'rank-feature-scale','fixture');
    await mkdir(corpusStore,{recursive:true});await mkdir(directory,{recursive:true});
    await writeFile(path.join(corpusStore,'expanded-corpus.json'),JSON.stringify({assets:[{id:'one'}]}));
    const base={method:'rank-features-vibe',count:1000000,concurrency:1,requests:1,p95Ms:10,maxMs:10,errors:0,overOneSecond:0};
    const cases=[
      {trial:{elapsedMs:1000},expected:'fail'},
      {trial:{elapsedMs:4,error:'service failure'},expected:'fail'},
      {trial:{elapsedMs:4},expected:'pass'},
      {trial:null,expected:'incomplete'},
      {trial:{elapsedMs:4},profile:{maxMs:1000},expected:'fail'},
      {trial:{elapsedMs:4},profile:{p95Ms:null,maxMs:null,errors:1},expected:'fail'},
      {trial:{elapsedMs:4},profile:{trials:[{elapsedMs:1000,error:'hidden by stale summary'}]},expected:'fail'},
    ];
    for(let i=0;i<cases.length;i++){
      const item=cases[i],run={startedAt:'2026-09-20T00:00:00Z',sourceHashes:{fixture:'hash'},profiles:[{...base,...item.profile}],warmups:item.trial?[{method:base.method,count:base.count,trials:[item.trial]}]:[],padding:i};
      await writeFile(path.join(directory,'scale.json'),JSON.stringify(run));
      const {summary,html}=await renderFindings({corpusStore,explorationStore});
      const result=summary.methods.find(method=>method.id===base.method).million[0];
      assert.equal(result.status,item.expected,JSON.stringify(item));
      assert.equal(summary.methods.find(method=>method.id==='hsv-cosine-ann').record,null);
      assert.equal(summary.methods.find(method=>method.id==='hsv-cosine-ann').million.length,0);
      assert.ok(!html.includes('<script>'));
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('arrival-rate results stay separate and rejections or cold failures cannot pass',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'color-summary-arrivals-'));
  try{
    const corpusStore=path.join(root,'corpus'),explorationStore=path.join(root,'exploration'),directory=path.join(explorationStore,'arrival-load','fixture');
    await mkdir(corpusStore,{recursive:true});await mkdir(directory,{recursive:true});
    await writeFile(path.join(corpusStore,'expanded-corpus.json'),JSON.stringify({assets:[{id:'one'}]}));
    const base={method:'rank-features-vibe',count:1000000,requests:10,rate:50,durationMs:1000,p95Ms:12,maxMs:14,errors:0,overOneSecond:0,clientRejected:0,workload:[{id:'red-vibe'}],warmups:[{elapsedMs:4}]};
    await writeFile(path.join(directory,'load.json'),JSON.stringify({startedAt:'2026-09-20T00:00:00Z',profiles:[base,{...base,rate:100,clientRejected:1},{...base,rate:150,warmups:[{elapsedMs:1000}]}]}));
    const {summary,html,markdown}=await renderFindings({corpusStore,explorationStore});
    assert.deepEqual(summary.arrivalProfiles.map(profile=>profile.status),['pass','fail','fail']);
    assert.equal(summary.methods.find(row=>row.id===base.method).million.length,0);
    assert.ok(html.includes('Scheduled arrival load'));assert.ok(markdown.includes('Scheduled arrival load'));
    assert.deepEqual(summary.arrivalProfiles[0].queryIds,['red-vibe']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('scale profiles use their own warmup invocation instead of a later rerun',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'color-summary-warmup-'));
  try{
    const corpusStore=path.join(root,'corpus'),explorationStore=path.join(root,'exploration'),directory=path.join(explorationStore,'rank-feature-scale','fixture');
    await mkdir(corpusStore,{recursive:true});await mkdir(directory,{recursive:true});
    await writeFile(path.join(corpusStore,'expanded-corpus.json'),JSON.stringify({assets:[{id:'one'}]}));
    const method='rank-features-vibe',count=1000000;
    const profile={method,count,concurrency:16,effectiveConcurrency:15,requests:15,p95Ms:10,maxMs:10,errors:0,overOneSecond:0,warmupId:'original'};
    await writeFile(path.join(directory,'scale.json'),JSON.stringify({startedAt:'2026-09-20T00:00:00Z',profiles:[profile],warmups:[{id:'original',method,count,trials:[{elapsedMs:1200}]},{id:'rerun',method,count,trials:[{elapsedMs:5}]}]}));
    const {summary,html}=await renderFindings({corpusStore,explorationStore});
    assert.equal(summary.methods.find(row=>row.id===method).million[0].status,'fail');
    assert.equal(summary.methods.find(row=>row.id===method).million[0].effectiveConcurrency,15);
    assert.ok(html.includes('C15 (requested 16)'));
  }finally{await rm(root,{recursive:true,force:true});}
});
