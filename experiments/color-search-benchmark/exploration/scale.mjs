// Closed-loop load experiment against a separate real OpenSearch node.
// Synthetic descriptors measure execution only; they add no human relevance labels.
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { SCALAR_FIELDS } from './methods.mjs';
import { METHODS, supports, executeSearch } from './registry.mjs';
import { api, BASE, STORE, CORPUS_STORE, loadFeatures, toIndexDocument, createIndex, bulkIndex, finishIndex, searchIndex, hash } from './service.mjs';
import { syntheticFeature } from './scale-corpus.mjs';
import { paletteCellIds } from './methods-palette-bounded.mjs';
import { WORKLOAD } from './workload.mjs';
import { encodePaletteLab, PRECOMPUTED_FIELDS } from './methods-precision-precomputed.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const counts = option('--counts', '1000,10000,100000,1000000').split(',').map(Number);
const concurrencies = option('--concurrency', '1,4,16').split(',').map(Number);
const repetitions = Number(option('--repeats', '4'));
const durationMs=Number(option('--duration-ms','0'));
const mergeWaitSeconds=Number(option('--merge-wait-seconds','30'));
const selected = option('--methods')?.split(',');
for (const id of selected ?? []) {
  const method = METHODS.find(candidate => candidate.id === id);
  if (!method) throw Error(`Unknown scale method: ${id}`);
  if (method.engine === 'clickhouse') throw Error('Use color-exploration-clickhouse-scale for ClickHouse measurements.');
  if (method.family === 'rank-features') throw Error('Use color-exploration-rank-scale for rank-feature measurements.');
  if (method.searchKind === 'precision-grid') throw Error('Use color-exploration-precision-grid-scale for picked-color grid measurements.');
}
const methods = METHODS.filter(m => m.engine!=='clickhouse'&&m.family!=='rank-features'&&m.searchKind!=='precision-grid'&&(!selected || selected.includes(m.id)));
let relativeById;
let relativeFields=[];
const groupFor=method=>method.representation==='palette32-oklab-fixed'||method.id==='hybrid-indexed-precomputed'?'precomputed':method.vector?'vectors':['relative','indexed-hybrid','indexed-typed-hybrid','palette-bounded','precision-bounded-typed'].includes(method.searchKind)?'refined':'features';
const groups = {
  features: { index: option('--feature-index', 'color-exploration-scale-features-v1'), fields: ['rgb4096','pixel_total','palette32_packed','palette_total','coverage_tokens','rgb_cdf48_packed', ...Object.keys(SCALAR_FIELDS)] },
  vectors: { index: option('--vector-index', 'color-exploration-scale-vectors-v1'), fields: ['hsv_cosine','hsv_l2','hsv_sqrt','rgb_cosine','rgb_sqrt'] },
  precomputed: { index:option('--precomputed-index','color-exploration-scale-precomputed-v1'),fields:['palette32_packed','palette_total','palette_cells',...Object.keys(PRECOMPUTED_FIELDS),'coverage_tokens',...Object.keys(SCALAR_FIELDS)] },
  refined: { index:option('--refined-index','color-exploration-scale-refined-v1'),fields:['palette32_packed','palette_total','palette_cells','coverage_tokens',...Object.keys(SCALAR_FIELDS)] },
};
const percentile = (values, q) => values.length ? [...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)] : null;
async function stats() {
  const body = (await api('_nodes/stats/process,jvm,indices,os?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem.heap_used_in_bytes,nodes.*.jvm.gc.collectors,nodes.*.indices.search,nodes.*.indices.store.size_in_bytes,nodes.*.os.cpu.percent')).body;
  return { at: new Date().toISOString(), node: Object.values(body.nodes ?? {})[0], serviceProcessMemory: process.memoryUsage(), serviceCpu: process.cpuUsage() };
}

async function ensureGroup(group, count, features) {
  let existing = 0;
  try { existing = (await api(`${group.index}/_count`)).body.count; }
  catch (error) { if (!error.message.includes('404')) throw error; await createIndex(group.index, {fields:group.fields,source:false}); }
  if (existing > count) throw Error(`${group.index} already contains ${existing} documents; resume with --counts ${existing} or use new index names. Refusing to label a larger index as ${count}.`);
  if (existing === count) return { existing, indexed:0, elapsedMs:0 };
  await api(`${group.index}/_settings`, {method:'PUT',body:{index:{refresh_interval:'-1'}}});
  const started = performance.now();
  let batch = [];
  for (let i = existing; i < count; i++) {
    const feature = syntheticFeature(features,i,{fields:group.fields});
    if(group.fields.includes('palette_cells'))feature.palette_cells=paletteCellIds(feature);
    if(group.fields.includes('palette_lab_lw'))Object.assign(feature,encodePaletteLab(feature));
    if([groups.refined,groups.precomputed].includes(group)){
      const [a,b]=feature.source_ids.map(id=>relativeById.get(id));
      for(const field of relativeFields)feature[field]=a[field]*feature.mixture_weight+b[field]*(1-feature.mixture_weight);
    }
    batch.push(toIndexDocument(feature,group.fields));
    if (batch.length === 200 || i === count-1) {
      await bulkIndex(group.index,batch); batch=[];
      if ((i+1)%10000===0) console.log(`Indexed ${group.index} ${i+1}/${count} in ${Math.round((performance.now()-started)/1000)}s`);
    }
  }
  const actual = await finishIndex(group.index);
  if(actual !== count) throw Error(`Unexpected scale count ${actual}, wanted ${count}`);
  return {existing,indexed:count-existing,elapsedMs:performance.now()-started};
}

async function trial(method,index,item) {
  const started=performance.now();
  try {
    // Timeout in OpenSearch as well as HTTP. Partial results are rejected by service.mjs.
    const result=await executeSearch({index,seedIndex:groups.vectors.index,method,query:item.query,filter:item.filter,limit:20,timeoutMs:5000,serviceTimeout:'950ms'});
    const elapsedMs=performance.now()-started;
    return {queryId:item.id,elapsedMs,serviceTookMs:result.evidence.serviceTookMs,...(durationMs?{hitCount:result.hits.length,topHit:result.hits[0]}:{hits:result.hits}),overOneSecond:elapsedMs>=1000};
  } catch(error) {return {queryId:item.id,elapsedMs:performance.now()-started,error:error.message,overOneSecond:performance.now()-started>=1000};}
}

async function profile(method,index,count,concurrency,items) {
  const before=await stats(), started=performance.now(), trials=[];
  const tasks=Array.from({length:repetitions},(_,round)=>items.map((_,i)=>items[(i+round)%items.length])).flat();
  if(!tasks.length)throw Error(`No supported workload queries for ${method.id}`);
  const effectiveConcurrency=durationMs?concurrency:Math.min(concurrency,tasks.length);
  let cursor=0;
  await Promise.all(Array.from({length:effectiveConcurrency},async()=>{
    while(cursor<tasks.length||performance.now()-started<durationMs) {const ordinal=cursor++; trials[ordinal]=await trial(method,index,tasks[ordinal%tasks.length]);}
  }));
  const elapsedMs=performance.now()-started, after=await stats();
  const successes=trials.filter(t=>!t.error).map(t=>t.elapsedMs);
  const errors=trials.filter(t=>t.error).length, over=trials.filter(t=>t.overOneSecond).length;
  return {method:method.id,index,count,concurrency,effectiveConcurrency,requests:trials.length,elapsedMs,throughputPerSecond:trials.length/(elapsedMs/1000),
    p50Ms:percentile(successes,.5),p95Ms:percentile(successes,.95),p99Ms:percentile(successes,.99),maxMs:successes.length?Math.max(...successes):null,
    errors,overOneSecond:over,viableAtTestedLoad:errors===0&&over===0,before,after,trials,
    serviceCpuMs:(after.serviceCpu.user+after.serviceCpu.system-before.serviceCpu.user-before.serviceCpu.system)/1000,
    peakObservedServiceRssBytes:Math.max(before.serviceProcessMemory.rss,after.serviceProcessMemory.rss),
    peakObservedHeapBytes:Math.max(before.node?.jvm?.mem?.heap_used_in_bytes??0,after.node?.jvm?.mem?.heap_used_in_bytes??0),
    cpuMs:(after.node?.process?.cpu?.total_in_millis??0)-(before.node?.process?.cpu?.total_in_millis??0),
    resourceLimitations:'CPU delta is whole OpenSearch node; heap snapshots are not peaks; shared host; closed-loop clients, not an arrival-rate SLO test.'};
}

async function main() {
  if(!BASE.includes(':19217')) throw Error('Scale benchmark requires dedicated port19217 via COLOR_EXPLORATION_OPENSEARCH; preserve interactive service');
  if(!counts.every(n=>Number.isSafeInteger(n)&&n>0&&n<=1000000))throw Error('Counts must be1..1000000');
  if(!methods.length)throw Error('No methods selected');
  const features=await loadFeatures();
  if(methods.some(m=>['refined','precomputed'].includes(groupFor(m)))){
    const sidecar=(await readFile(path.join(CORPUS_STORE,'refinement-features.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    relativeById=new Map(sidecar.map(row=>[row.id,row]));
    relativeFields=Object.keys(sidecar[0]).filter(field=>field.startsWith('rel_'));
    groups.refined.fields.push(...relativeFields);
    groups.precomputed.fields.push(...relativeFields);
  }
  const directory=path.join(STORE,'scale',new Date().toISOString().replaceAll(':','-'));
  await mkdir(directory,{recursive:true});
  const result={schemaVersion:1,startedAt:new Date().toISOString(),base:BASE,version:(await api('')).body.version,
    topology:{nodes:1,shardsPerIndex:1,replicas:0,cpuLimit:8,containerMemoryGiB:12,javaHeapGiB:4},
    corpus:{kind:'synthetic descriptor mixtures',realSources:features.length,sourceFeatureHash:hash(await readFile(path.join(path.dirname(STORE),'features.jsonl'))),warning:'Performance-only. Not one million unique real wallpapers or additional relevance judgments.'},
    configuration:{counts,concurrencies,repetitions,durationMs,mergeWaitSeconds,methods:methods.map(m=>m.id),groups},workload:WORKLOAD,indexing:[],profiles:[],warmups:[],indexStats:[],settling:[]};
  result.sourceHashes=Object.fromEntries(await Promise.all(['scale.mjs','workload.mjs','scale-corpus.mjs','methods.mjs','query.mjs','service.mjs','corpus-colors.mjs'].map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
  const sourceNames=(await readdir(new URL('.',import.meta.url))).filter(name=>name.endsWith('.mjs')).sort();
  const sourceSnapshot=Object.fromEntries(await Promise.all(sourceNames.map(async name=>[name,await readFile(new URL(name,import.meta.url),'utf8')])));
  await writeFile(path.join(directory,'source-snapshot.json'),JSON.stringify(sourceSnapshot,null,2));
  result.sourceSnapshotHash=hash(sourceSnapshot);
  if(relativeFields.length)result.corpus.relativeFeatureNote='Relative-lightness scalars are interpolated between source descriptors for performance testing; they are not recomputed image-mixture quantiles.';
  const save=async()=>writeFile(path.join(directory,'scale.json'),JSON.stringify(result,null,2));
  console.log(`SCALE_ARTIFACT ${directory}/scale.json`);
  for(const count of counts) {
    for(const name of ['features','vectors','refined','precomputed']) {
      if(!methods.some(m=>groupFor(m)===name))continue;
      const group=groups[name];
      const indexing=await ensureGroup(group,count,features);
      result.indexing.push({count,group:name,...indexing,
        reusedIndexNote:indexing.existing ? 'Existing descriptor index reused. Initial features/vectors were generated before partition changed to i%100; new refined index uses the archived generator. Source choices and mixtures are unchanged.' : undefined});
      result.indexStats.push({count,group:name,index:group.index,stats:(await api(group.index+'/_stats/store?filter_path=_all.primaries.store.size_in_bytes,_all.total.store.size_in_bytes')).body});await save();
    }
    // Record bounded settling; any remaining background merge stays visible.
    const settlingStart=performance.now();
    let activeMerges=0;
    for(let i=0;i<=mergeWaitSeconds;i++){
      const body=(await api('_nodes/stats/indices?filter_path=nodes.*.indices.merges.current')).body;
      activeMerges=Object.values(body.nodes).reduce((sum,n)=>sum+n.indices.merges.current,0);
      if(!activeMerges||i===mergeWaitSeconds)break;
      if(i%30===0)console.log('Waiting for background merges: '+activeMerges+' active');
      await new Promise(r=>setTimeout(r,1000));
    }
    result.settling.push({count,elapsedMs:performance.now()-settlingStart,activeMergesAtMeasurementStart:activeMerges});await save();
    for(const method of methods) {
      const index=groups[groupFor(method)].index;
      const items=WORKLOAD.filter(item=>supports(method,item.query).supported);
      const warmups=[];
      for(const item of items)warmups.push(await trial(method,index,item));
      result.warmups.push({count,method:method.id,trials:warmups});await save();
      for(const concurrency of concurrencies) {
        const record=await profile(method,index,count,concurrency,items);
        record.warmupErrors=warmups.filter(item=>item.error).length;
        record.warmupOverOneSecond=warmups.filter(item=>item.overOneSecond||item.elapsedMs>=1000).length;
        record.strictViable=record.viableAtTestedLoad&&record.warmupErrors===0&&record.warmupOverOneSecond===0;
        record.byQuery=Object.fromEntries(items.map(item=>{const trials=record.trials.filter(t=>t.queryId===item.id);return[item.id,{requests:trials.length,errors:trials.filter(t=>t.error).length,overOneSecond:trials.filter(t=>t.overOneSecond).length,p95Ms:percentile(trials.map(t=>t.elapsedMs),.95),maxMs:percentile(trials.map(t=>t.elapsedMs),1)}];}));
        result.profiles.push(record);await save();
        console.log(JSON.stringify({...record,trials:undefined,before:undefined,after:undefined}));
        // Serial failure already rejects a method here. Avoid adding queue load to a failing scan.
        if(concurrency===1&&!record.viableAtTestedLoad)break;
      }
    }
  }
  result.finishedAt=new Date().toISOString();await save();
}
await main();
