// Exact, service-side palette ranking over synthetic descriptors. No local rerank.
// Only run after the experiment coordinator grants an exclusive load window.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { STORE, loadFeatures, hash } from './service.mjs';
import { syntheticFeature } from './scale-corpus.mjs';
import { rgbToLab } from './corpus-colors.mjs';
import { WORKLOAD } from './workload.mjs';
import { CLICKHOUSE_METHOD, supportsClickHouse, searchClickHouse } from './methods-clickhouse.mjs';
import { CLICKHOUSE_BASE, CLICKHOUSE_SCALE_TABLE, safeClickHouseTable, clickHouseRequest, countTable, clickHouseMetadata } from './clickhouse-service.mjs';
import { toClickHouseDocument, createClickHouseTable, insertClickHouseDocuments } from './clickhouse-index.mjs';

const SOURCE_NAMES = ['clickhouse-scale.mjs','clickhouse-service.mjs','methods-clickhouse.mjs','clickhouse-index.mjs','clickhouse-compose.yml','scale-corpus.mjs','workload.mjs','corpus-colors.mjs','methods-precision-typed.mjs','methods-palette-bounded.mjs','methods-direct-palette.mjs','methods.mjs','query.mjs','service.mjs'];
const percentile = (values, q) => values.length ? [...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)] : null;

export function precisionWorkload({ filtered = true } = {}) {
  const original = WORKLOAD.filter(item => supportsClickHouse(item.query).supported);
  if (original.length !== 7) throw new Error('Expected the same seven picked swatches as the OpenSearch workload');
  return filtered ? [...original, ...original.map(item=>({...item,id:item.id+'-filter10',filter:{range:{partition:{lt:10}}}})), ...original.map(item=>({...item,id:item.id+'-filter1',filter:{term:{partition:1}}}))] : original;
}

async function stats(table) {
  const metadata = await clickHouseMetadata(table);
  const events = await clickHouseRequest("SELECT event,value FROM system.events WHERE event IN ('UserTimeMicroseconds','SystemTimeMicroseconds','OSCPUVirtualTimeMicroseconds','Query','SelectedRows','SelectedBytes') FORMAT JSON");
  const merges = await clickHouseRequest('SELECT count() AS activeMerges,sum(memory_usage) AS mergeMemoryBytes FROM system.merges WHERE database=currentDatabase() AND table={table:String} FORMAT JSON',{params:{table}});
  return { at:new Date().toISOString(), ...metadata, events:Object.fromEntries(events.body.data.map(row=>[row.event,Number(row.value)])), merges:merges.body.data[0], serviceMemory:process.memoryUsage(), serviceCpu:process.cpuUsage() };
}

async function ensureTable(table, count, features) {
  safeClickHouseTable(table);
  const ledgerPath=path.join(STORE,`${table}-generation.json`);
  const sourceFeatureHash=hash(features), generatorHash=hash(await readFile(new URL('scale-corpus.mjs',import.meta.url))),colorTransformHash=hash(rgbToLab.toString());
  let existing;
  try { existing=(await countTable(table)).count; }
  catch(error) { if(!error.message.includes('UNKNOWN_TABLE'))throw error; await createClickHouseTable(table); existing=0; }
  if(existing>count)throw new Error(`${table} contains ${existing} rows; refusing to label it ${count}`);
  if(existing){
    const ledger=JSON.parse(await readFile(ledgerPath,'utf8'));
    if(ledger.sourceFeatureHash!==sourceFeatureHash||ledger.generatorHash!==generatorHash||ledger.documentTransformHash!==hash(toClickHouseDocument.toString())||ledger.colorTransformHash!==colorTransformHash)throw new Error('Existing ClickHouse scale data has different source features, generator, document transformation or RGB-to-OKLab conversion');
    const identity=(await clickHouseRequest(`SELECT count() AS count,uniqExact(id) AS uniqueIds,min(id) AS minId,max(id) AS maxId,countIf(NOT match(id,'^synthetic-[0-9]{9}$')) AS malformed FROM ${table} FORMAT JSON`)).body.data[0];
    if(Number(identity.count)!==existing||Number(identity.uniqueIds)!==existing||Number(identity.malformed)!==0||identity.minId!=='synthetic-000000000'||identity.maxId!==`synthetic-${String(existing-1).padStart(9,'0')}`)throw new Error('Existing ClickHouse synthetic IDs are not the expected complete contiguous sequence');
  }
  await writeFile(ledgerPath,JSON.stringify({table,sourceFeatureHash,generatorHash,colorTransformHash,createdAt:new Date().toISOString(),documentTransformHash:hash(toClickHouseDocument.toString()),lastVerifiedCount:existing},null,2));
  const started=performance.now();
  let batch=[];
  for(let i=existing;i<count;i++){
    const feature=syntheticFeature(features,i,{fields:['palette32_packed','palette_total']});
    batch.push(toClickHouseDocument(feature));
    if(batch.length===2000||i===count-1){await insertClickHouseDocuments(table,batch);batch=[];}
    if((i+1)%10000===0)console.log(`CLICKHOUSE_INDEX ${i+1}/${count} in ${Math.round((performance.now()-started)/1000)}s`);
  }
  const final=await countTable(table);
  if(final.count!==count||final.uniqueIds!==count)throw new Error('ClickHouse scale index cardinality mismatch');
  return {existing,indexed:count-existing,elapsedMs:performance.now()-started,sourceFeatureHash,generatorHash,metadata:await clickHouseMetadata(table)};
}

async function waitForIdle() {
  const started=performance.now(),observations=[];
  while(performance.now()-started<30000){
    const active=Number((await clickHouseRequest("SELECT count() AS count FROM system.processes WHERE startsWith(query_id,'color-exploration-') AND query_id!=currentQueryID() FORMAT JSON")).body.data[0].count);
    observations.push({elapsedMs:performance.now()-started,activeQueries:active});
    if(!active)return{elapsedMs:performance.now()-started,observations,idle:true};
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('ClickHouse queries remained active for30s after failure; refusing to overlap the next load profile');
}

async function trial(table,item,maxThreads=8) {
  const started=performance.now();
  try {
    const result=await searchClickHouse({table,query:item.query,filter:item.filter,limit:20,timeoutMs:5000,serviceTimeout:'950ms',maxThreads});
    const elapsedMs=performance.now()-started;
    return {queryId:item.id,elapsedMs,serviceTookMs:result.evidence.serviceTookMs,rowsRead:result.evidence.rowsRead,bytesRead:result.evidence.bytesRead,hitCount:result.hits.length,topHit:result.hits[0],overOneSecond:elapsedMs>=1000};
  }catch(error){const elapsedMs=performance.now()-started;return{queryId:item.id,elapsedMs,error:error.message,overOneSecond:elapsedMs>=1000};}
}

export function summarizeTrials(trials) {
  const elapsed=trials.map(t=>t.elapsedMs), successes=trials.filter(t=>!t.error);
  return {requests:trials.length,errors:trials.filter(t=>t.error).length,overOneSecond:trials.filter(t=>t.overOneSecond||t.elapsedMs>=1000).length,
    p50Ms:percentile(elapsed,.5),p95Ms:percentile(elapsed,.95),p99Ms:percentile(elapsed,.99),maxMs:percentile(elapsed,1),
    successfulP95Ms:percentile(successes.map(t=>t.elapsedMs),.95),successfulMeanServiceMs:successes.length?successes.reduce((sum,t)=>sum+t.serviceTookMs,0)/successes.length:null,
    percentilePolicy:'All request latencies, including errors and timeouts; successfulP95Ms is separately labeled.'};
}

async function profile(table,count,concurrency,items,{repetitions,durationMs,maxThreads},warmups) {
  const before=await stats(table),started=performance.now(),trials=[];
  const tasks=Array.from({length:repetitions},(_,round)=>items.map((_,i)=>items[(i+round)%items.length])).flat();
  let cursor=0;
  const effectiveConcurrency=Math.min(concurrency,tasks.length);
  await Promise.all(Array.from({length:effectiveConcurrency},async()=>{
    while(cursor<tasks.length||performance.now()-started<durationMs){const ordinal=cursor++;trials[ordinal]=await trial(table,tasks[ordinal%tasks.length],maxThreads);}
  }));
  const elapsedMs=performance.now()-started,after=await stats(table),summary=summarizeTrials(trials);
  const warmupSummary=summarizeTrials(warmups);
  return {method:CLICKHOUSE_METHOD.id,engine:'clickhouse',table,count,concurrency,effectiveConcurrency,maxThreadsPerRequest:maxThreads,elapsedMs,throughputPerSecond:trials.length/(elapsedMs/1000),...summary,
    warmupErrors:warmupSummary.errors,warmupOverOneSecond:warmupSummary.overOneSecond,
    viableAtTestedLoad:summary.errors===0&&summary.overOneSecond===0,strictViable:summary.errors===0&&summary.overOneSecond===0&&warmupSummary.errors===0&&warmupSummary.overOneSecond===0,
    byQuery:Object.fromEntries(items.map(item=>[item.id,summarizeTrials(trials.filter(t=>t.queryId===item.id))])),
    cpuMs:((after.events.UserTimeMicroseconds??0)+(after.events.SystemTimeMicroseconds??0)-(before.events.UserTimeMicroseconds??0)-(before.events.SystemTimeMicroseconds??0))/1000,
    serviceCpuMs:(after.serviceCpu.user+after.serviceCpu.system-before.serviceCpu.user-before.serviceCpu.system)/1000,
    maximumObservedServerRssBytes:Math.max(before.metrics.MemoryResident??0,after.metrics.MemoryResident??0),maximumObservedServiceRssBytes:Math.max(before.serviceMemory.rss,after.serviceMemory.rss),
    resourceLimitations:'CPU counters include all ClickHouse query threads during the window; RSS snapshots are not peaks. Async OSUserTime/OSSystemTime are rates, not CPU deltas. Shared host; closed-loop clients, not an arrival-rate SLO test.',before,after,trials};
}

export async function main(args=process.argv.slice(2)) {
  const option=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
  const counts=option('--counts','1000,10000,100000,1000000').split(',').map(Number),concurrencies=option('--concurrency','1,4,16').split(',').map(Number);
  const repetitions=Number(option('--repeats','12')),durationMs=Number(option('--duration-ms','10000')),mergeWaitSeconds=Number(option('--merge-wait-seconds','30')),maxThreads=Number(option('--max-threads','8'));
  const table=option('--table',CLICKHOUSE_SCALE_TABLE),filtered=option('--filtered','yes')!=='no',indexOnly=args.includes('--index-only');
  if(!counts.every(n=>Number.isSafeInteger(n)&&n>0&&n<=1000000)||!concurrencies.every(n=>Number.isSafeInteger(n)&&n>0&&n<=64)||!Number.isSafeInteger(repetitions)||repetitions<1||!Number.isFinite(durationMs)||durationMs<0||!Number.isSafeInteger(mergeWaitSeconds)||mergeWaitSeconds<0||!Number.isInteger(maxThreads)||maxThreads<1||maxThreads>8)throw new Error('Invalid ClickHouse scale configuration');
  const features=await loadFeatures(),directory=path.join(STORE,'clickhouse-scale',new Date().toISOString().replaceAll(':','-'));
  await mkdir(directory,{recursive:true});
  const sourceSnapshot=Object.fromEntries(await Promise.all(SOURCE_NAMES.map(async name=>[name,await readFile(new URL(name,import.meta.url),'utf8')])));
  await writeFile(path.join(directory,'source-snapshot.json'),JSON.stringify(sourceSnapshot,null,2));
  const items=precisionWorkload({filtered});
  const initialMetadata=await clickHouseMetadata(table);
  const result={schemaVersion:1,startedAt:new Date().toISOString(),engine:'clickhouse',base:CLICKHOUSE_BASE,method:CLICKHOUSE_METHOD,table,version:initialMetadata.version,topology:{nodes:1,cpuLimit:8,containerMemoryGiB:12,maxThreadsPerRequest:maxThreads,hostname:initialMetadata.hostname,engine:'MergeTree'},
    configuration:{counts,concurrencies,repetitions,durationMs,mergeWaitSeconds,filtered,indexOnly,maxThreadsPerRequest:maxThreads,queryCache:false,serverTimeoutMs:950,timeoutBeforeCheckingExecutionSpeed:0,clientTimeoutMs:5000},
    corpus:{kind:'synthetic descriptor mixtures',realSources:features.length,sourceFeatureHash:hash(features),warning:'Performance only: not one million unique real wallpapers or additional human relevance labels. Same deterministic generator/IDs as OpenSearch; palette descriptors retain all duplicate centroid entries.'},
    sourceHashes:Object.fromEntries(Object.entries(sourceSnapshot).map(([name,text])=>[name,hash(text)])),sourceSnapshot:path.join(directory,'source-snapshot.json'),sourceSnapshotHash:hash(sourceSnapshot),workload:items,indexing:[],settling:[],cooldowns:[],warmups:[],profiles:[]};
  const save=()=>writeFile(path.join(directory,'scale.json'),JSON.stringify(result,null,2));
  console.log(`CLICKHOUSE_SCALE_ARTIFACT ${path.join(directory,'scale.json')}`);await save();
  for(const count of counts){
    result.indexing.push({count,...await ensureTable(table,count,features)});await save();
    if(indexOnly)continue;
    const settlingStart=performance.now();let activeMerges=0;
    for(let i=0;i<=mergeWaitSeconds;i++){
      activeMerges=Number((await clickHouseRequest('SELECT count() AS count FROM system.merges WHERE database=currentDatabase() AND table={table:String} FORMAT JSON',{params:{table}})).body.data[0].count);
      if(!activeMerges||i===mergeWaitSeconds)break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    result.settling.push({count,elapsedMs:performance.now()-settlingStart,activeMergesAtMeasurementStart:activeMerges,metadata:await clickHouseMetadata(table)});await save();
    const warmups=[];for(const item of items)warmups.push(await trial(table,item,maxThreads));
    result.warmups.push({count,method:CLICKHOUSE_METHOD.id,trials:warmups,...summarizeTrials(warmups)});await save();
    if(warmups.some(t=>t.error)){result.cooldowns.push({count,after:'warmup',...await waitForIdle()});await save();}
    for(const concurrency of concurrencies){
      const record=await profile(table,count,concurrency,items,{repetitions,durationMs,maxThreads},warmups);
      result.profiles.push(record);await save();
      console.log(JSON.stringify({...record,byQuery:undefined,trials:undefined,before:undefined,after:undefined}));
      if(record.errors){result.cooldowns.push({count,afterConcurrency:concurrency,...await waitForIdle()});await save();}
      // Run all requested concurrencies even when an earlier profile fails; record every failure.
    }
  }
  result.finishedAt=new Date().toISOString();result.finalCounts=await countTable(table);result.finalMetadata=await clickHouseMetadata(table);await save();
  return {artifact:path.join(directory,'scale.json'),profiles:result.profiles.map(({count,concurrency,p95Ms,errors,overOneSecond,strictViable})=>({count,concurrency,p95Ms,errors,overOneSecond,strictViable}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await main(),null,2));
