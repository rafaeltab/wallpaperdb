// Render measured evidence, not a production capacity forecast.
import {writeFile} from 'node:fs/promises';
import {ROOT,readJson} from './global-common.mjs';
const evidence=await readJson('global-evaluation.json');
let validation=evidence;
try{validation=await readJson('global-real-validation.json');}catch{}
const indexing=await readJson('global-indexing.json');
const fmt=x=>typeof x==='number'?x.toFixed(1):'—';
const pp=x=>`${(x*100).toFixed(2)} pp`;
const lines=['# OpenSearch global color ranking — measured evidence','',`Generated from evaluation starting ${evidence.generatedAt}.`,'','Local OpenSearch2.11, three shards per index, one node, four CPUs, 2GiB heap /4GiB container limit. Shared development host. Synthetic load data are mixtures of the100 real and20 analytic descriptors; timings are warm observations, not a100M capacity guarantee.','',`Global corpus checks: **${evidence.correctness.length} passed**. Recorded timing failures: **${evidence.failures.length}**. Separate formula, pagination, filter and snapshot probes are in the adjacent probe JSON files.`,'','## Indexing and storage','','These indexes deliberately retain redundant prototype encodings and `_source`. Storage is measured, not optimized. Ingestion includes descriptor generation, bulk requests and final refresh.','','| Index | Parents | Fields | Build seconds | Store MiB |','|---|---:|---:|---:|---:|'];
for(const row of indexing.indexes)lines.push(`| ${row.index} | ${row.count.toLocaleString('en-US')} | ${row.fields} | ${fmt(row.wallMs/1000)} | ${fmt((row.statsAfterQuiescence??row.stats).store.size_in_bytes/1024/1024)} |`);
lines.push('','## Sequential latency','','Each cell is median client wall time / observed p95 in milliseconds. Normal rows have15 measured repetitions after a warmup; slow dynamic rows have5. Client timing for certified bounds includes opening and closing the PIT plus seed and final queries. A5- or15-sample p95 is an observation of this small run, not a reliable tail-latency estimate.');
for(const count of [...new Set(evidence.timings.map(r=>r.count))])for(const selectivity of ['all','one_percent']){
  const rows=evidence.timings.filter(r=>r.count===count&&r.selectivity===selectivity);
  const methods=[...new Set(rows.map(r=>r.method))];
  lines.push('',`### ${count.toLocaleString('en-US')} parents — ${selectivity==='all'?'all eligible':'1% metadata filter'}`,'',`| Query | ${methods.join(' | ')} |`,`|---|${methods.map(()=>'---:').join('|')}|`);
  for(const query of [...new Set(rows.map(r=>r.query))])lines.push(`| ${query} | ${methods.map(method=>{const r=rows.find(row=>row.query===query&&row.method===method);return r?`${fmt(r.wallMs.median)} / ${fmt(r.wallMs.p95)}`:'—';}).join(' | ')} |`);
}
lines.push('','## Four simultaneous requests','','Forty requests per row, four in flight. Service CPU is the benchmark coordinator (including HTTP/JSON), not a production gateway measurement. OpenSearch process statistics are cached; these short batches cannot reliably attribute node CPU to a method, so those deltas are deliberately omitted.','','| Query | Method | Median ms | p95 ms | Requests/sec | Service CPU ms/request |','|---|---|---:|---:|---:|---:|');
const nodeCpu=stats=>Object.values(stats.nodes).reduce((s,node)=>s+(node.process?.cpu?.total_in_millis??0),0);
for(const row of evidence.concurrency??[])lines.push(`| ${row.query} | ${row.method} | ${fmt(row.wallMs.median)} | ${fmt(row.wallMs.p95)} | ${fmt(row.wallMs.samples/(row.elapsedMs/1000))} | ${fmt((row.serviceCpuMicroseconds.user+row.serviceCpuMicroseconds.system)/1000/row.wallMs.samples)} |`);
let adaptive;
try{adaptive=await readJson('global-adaptive-evaluation.json');}catch{}
if(adaptive){
  lines.push('','## Adaptive global bounds without token seeds','','Start at1 percentage point of total error, search all documents inside necessary indexed bounds, and double the threshold if a complete page is not yet proved. Every returned page remains globally correct; no fixed candidate count is used. Same million-parent index and objectives. Fifteen warm measurements per sequential row.','','| Query | Method | Metadata filter | Median ms | p95 ms | Search requests |','|---|---|---|---:|---:|---:|');
  for(const row of adaptive.timings)lines.push(`| ${row.query} | ${row.method} | ${row.selectivity} | ${fmt(row.wallMs.median)} | ${fmt(row.wallMs.p95)} | ${row.iterations.length} |`);
  lines.push('','Four simultaneous requests, forty requests per row:','','| Query | Method | Median ms | p95 ms |','|---|---|---:|---:|');
  for(const row of adaptive.concurrency)lines.push(`| ${row.query} | ${row.method} | ${fmt(row.wallMs.median)} | ${fmt(row.wallMs.p95)} |`);
}
let multi,fast,resources,varied,planner;
try{multi=await readJson('global-multi-indexing.json');}catch{}
try{fast=await readJson('global-multi-fast-evaluation.json');}catch{}
try{resources=await readJson('global-resources.json');}catch{}
try{varied=await readJson('global-varied.json');}catch{}
try{planner=await readJson('global-planner.json');}catch{}
if(multi){
  lines.push('','## Original-pixel joint representation','','This later representation uses roughly65k unblended original pixels, packed membership/count pairs, and171 indexed singleton/pair-union measurements. It supports1–5 regions. It has different sampling from the earlier256-resize methods, so do not treat cross-representation differences as a pure algorithm comparison. Sizes below use post-merge measurements when available.','','| Index | Parents | Mean membership atoms | Fields | Store MiB |','|---|---:|---:|---:|---:|');
  for(const row of multi.indexes)lines.push(`| ${row.index} | ${row.count.toLocaleString('en-US')} | ${fmt(row.atomsMean)} | ${row.fields} | ${fmt((row.statsAfterQuiescence??row.stats).store.size_in_bytes/1024/1024)} |`);
}
if(fast){
  lines.push('','## Optimized joint scorer:1,000,000 parents','','The original generic Painless implementation exceeded15s for three broad multi-region queries. Extended reference requests completed in about20s and verified the adaptive global winners. Caching typed locals and unrolling membership tests preserved the same score while removing repeated dynamic lookups. The following measurements use that optimized script on the SAME original-pixel index. One/two-region requests retain their small closed-form fast path.','','Each cell is median / observed p95 client milliseconds;15 repeats per row. “Partial” requests specify less than100% total and still penalize excess requested-family area.');
  for(const selectivity of ['all','one_percent']){
    lines.push('',`### Optimized joint — ${selectivity==='all'?'all eligible':'1% metadata filter'}`,'','| Query | Regions | Exhaustive | Adaptive globally exact |','|---|---:|---:|---:|');
    for(const query of [...new Set(fast.timings.map(r=>r.query))]){
      const direct=fast.timings.find(r=>r.query===query&&r.selectivity===selectivity&&r.method==='exhaustive'),bounded=fast.timings.find(r=>r.query===query&&r.selectivity===selectivity&&r.method==='adaptive');
      lines.push(`| ${query} | ${direct?.regions??bounded?.regions} | ${direct?`${fmt(direct.wallMs.median)} / ${fmt(direct.wallMs.p95)}`:'—'} | ${bounded?`${fmt(bounded.wallMs.median)} / ${fmt(bounded.wallMs.p95)}`:'—'} |`);
    }
  }
  lines.push('','Optimized adaptive search with four simultaneous requests, forty requests per row:','','| Query | Median ms | Observed p95 ms |','|---|---:|---:|');
  for(const row of fast.concurrency)lines.push(`| ${row.query} | ${fmt(row.wallMs.median)} | ${fmt(row.wallMs.p95)} |`);
}
if(varied?.completedAt){
  lines.push('','## Changing queries: the less favorable workload','','Sixty unique region/amount queries, half broad and half selecting distinct 1% metadata partitions. Both methods run once per query with alternating method order. This is an already used node; the paired methods can warm each other. Concurrency reuses the same sixty queries. See [GLOBAL-VARIED.md](GLOBAL-VARIED.md) for the full cache caveats and all groups. These results supersede any inference that arbitrary queries reliably take only a few milliseconds.','','| Pass | Method | Regions | Filter | Samples | Median ms | Observed p95 ms |','|---|---|---|---|---:|---:|---:|');
  for(const row of varied.summary)lines.push(`| ${row.stage} | ${row.method} | ${row.regions??'all'} | ${row.selectivity??'mixed'} | ${row.wallMs.samples} | ${fmt(row.wallMs.median)} | ${fmt(row.wallMs.p95)} |`);
  lines.push('',`Passed comparisons: ${varied.sequential.filter(row=>row.passed).length}/${varied.sequential.length} sequential and ${varied.concurrent.filter(row=>row.passed).length}/${varied.concurrent.length} concurrent, checking exhaustive ordered IDs and float32 scores. Recorded failures: ${varied.failures.length}. Direct scoring was substantially faster for several selective queries; adaptive bounds were often better for broad queries. The choice of strategy belongs in the query planner.`);
}
if(planner?.completedAt){
  lines.push('','## Same-snapshot query planner','','A metadata-only count on the same PIT chooses direct typed scoring only when it proves at most 10,000 eligible documents; other searches use adaptive bounds. That cutoff comes from the previous workload, not a universal cost model. These are repeat measurements of the same sixty-query set on an already warmed node. Count, PIT and cleanup overhead are included. The concurrent planner pass ran after the adaptive pass, with a possible cache advantage. Broad searches use identical adaptive logic, so their timing differences are not a planner improvement. See [GLOBAL-PLANNER.md](GLOBAL-PLANNER.md) for group details and limits.','','| Pass | Method | Samples | Median ms | Observed p95 ms |','|---|---|---:|---:|---:|');
  for(const row of planner.summary.filter(row=>row.regions===null))lines.push(`| ${row.stage} | ${row.method} | ${row.wallMs.samples} | ${fmt(row.wallMs.median)} | ${fmt(row.wallMs.p95)} |`);
  lines.push('',`Passed comparisons: ${planner.sequential.filter(row=>row.passed).length}/${planner.sequential.length} sequential, ${planner.concurrent.filter(row=>row.passed).length}/${planner.concurrent.length} concurrent, plus ${planner.edgeChecks.length} edge/pagination cases. Recorded failures: ${planner.failures.length}. Source hashes and index mutation counters remained unchanged.`);
}
if(resources?.completedAt){
  lines.push('','## Sustained resource check','','Optimized script, same million-document original-pixel index. Four requests in flight for at least 8s per row; 1.2s idle before/after refreshes cached node CPU counters. Node CPU includes GC/background work. Service memory is the benchmark coordinator, not a production gateway deployment. Memory columns are end-of-block snapshots, not peaks. JVM heap excludes native memory and filesystem cache; the OpenSearch container limit was 4 GiB with a 2 GiB heap.','','| Query | Method | Requests | Queries/sec | p95 ms | OpenSearch CPU ms/query | Service CPU ms/query | Service RSS MiB | OpenSearch heap MiB |','|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for(const row of resources.rows)lines.push(`| ${row.query} | ${row.method} | ${row.requests} | ${fmt(row.queriesPerSecond)} | ${fmt(row.wallMs.p95)} | ${fmt(row.openSearchCpuMsPerQuery)} | ${fmt(row.serviceCpuMsPerQuery)} | ${fmt(row.serviceMemory.rss/1024/1024)} | ${fmt(Object.values(row.nodeAfter.nodes).reduce((total,node)=>total+node.jvm.mem.heap_used_in_bytes,0)/1024/1024)} |`);
}
lines.push('','## Quality: historical resized pixels versus palette32','','These are area-error proxies under the declared hard region definitions, not human preference labels. Lower is better. A poor best-available score can also mean that this 100-image corpus contains no close composition. Pixel measurements in this historical table use a 256px maximum side. The later [original-pixel sampling audit](GLOBAL-SAMPLING.md) found material interpolation error in those measurements; use that audit for the final representation decision.','','| Query | Pixel-ranked top10 mean area error | Palette-ranked top10, measured on pixels | Worst per-image descriptor error |','|---|---:|---:|---:|');
for(const row of evidence.quality.filter(r=>r.joint))lines.push(`| ${row.query} | ${pp(row.joint.pixelTop10MeanError)} | ${pp(row.joint.paletteSelectedTop10PixelMeanError)} | ${pp(row.joint.paletteCostAbsoluteError.max)} |`);
lines.push('','## Quantized percentage ordering','','This section uses the independent marginal-coverage objective, which differs from joint distinct-area matching when families overlap. Similar top-ten means do not imply identical ordering: top-one regret and unchanged rank positions expose that difference.','','| Query | Pixel oracle top10 mean error | Fine0.01pp | Coarse1pp | Coarse top1 regret | Fine/coarse same top10 positions |','|---|---:|---:|---:|---:|---:|');
for(const row of validation.quality)lines.push(`| ${row.query} | ${pp(row.marginal.oracleTop10MeanError)} | ${pp(row.marginal.fineTop10MeanError)} | ${pp(row.marginal.bucketTop10MeanError)} | ${pp(row.marginal.bucketTop1Regret??0)} | ${row.marginal.bucketFineSameTop10Positions??'—'}/10 |`);
if(evidence.failures.length)lines.push('','## Recorded failures','',...evidence.failures.map(f=>`- ${f.count} / ${f.query} / ${f.method}: ${f.error}`));
lines.push('','## Raw evidence','','- `global-indexing.json`: build timings, store sizes, node constraints.','- `global-evaluation.json`: all per-query timings, correctness checks, profiles and resource snapshots.','- `global-data.json`:100 source-pixel measurements and20 analytic fixtures.','- `global-*-probe.json`: executable correctness, snapshot and pagination probes.','');
await writeFile(new URL('GLOBAL-MEASUREMENTS.md',ROOT),lines.join('\n'));
console.log(lines.join('\n'));
