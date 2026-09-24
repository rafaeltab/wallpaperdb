// Real OpenSearch arrival-rate benchmark. All filtering/ranking stays in the service.
import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { METHODS, supports, executeSearch } from './registry.mjs';
import { BASE, STORE, api, safeIndexName, hash } from './service.mjs';
import { WORKLOAD } from './workload.mjs';
import { runArrivals } from './arrival-scheduler.mjs';

export function arrivalConfiguration(args=[]){
  const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
  return {index:safeIndexName(option('--index','color-exploration-scale-features-v1')),seedIndex:safeIndexName(option('--seed-index','color-exploration-scale-vectors-v1')),
    selected:option('--methods','native-area-linear').split(','),rates:option('--rates','50,200').split(',').map(Number),durationMs:Number(option('--seconds','15'))*1000,maxInFlight:Number(option('--max-inflight','128')),queryIds:option('--query-ids')?.split(',')};
}
export function validateArrivalConfiguration({selected,rates,durationMs,maxInFlight,queryIds}){
  const methods=selected.map(id=>{const method=METHODS.find(item=>item.id===id);if(!method)throw Error('Unknown method: '+id);if(method.engine&&method.engine!=='opensearch')throw Error('This arrival driver only supports OpenSearch methods; use the dedicated '+method.engine+' benchmark.');return method;});
  if(!rates.length||rates.some(rate=>!Number.isFinite(rate)||rate<=0||rate>5000)||!(durationMs>0&&durationMs<=300000)||!Number.isInteger(maxInFlight)||maxInFlight<1)throw Error('Invalid arrival-rate benchmark configuration');
  if(rates.some(rate=>Math.floor(rate*durationMs/1000)<1||Math.floor(rate*durationMs/1000)>1000000))throw Error('Arrival count must be 1..1000000');
  for(const id of queryIds??[])if(!WORKLOAD.some(item=>item.id===id))throw Error('Unknown workload query: '+id);
  const workloads={},unsupported={};
  for(const method of methods){
    const requested=WORKLOAD.filter(item=>!queryIds||queryIds.includes(item.id));
    workloads[method.id]=requested.filter(item=>supports(method,item.query).supported);
    unsupported[method.id]=requested.filter(item=>!supports(method,item.query).supported).map(item=>({queryId:item.id,reason:supports(method,item.query).reason}));
    if(!workloads[method.id].length)throw Error('No supported workload queries for '+method.id);
    if(rates.some(rate=>Math.floor(rate*durationMs/1000)<workloads[method.id].length))throw Error('Each rate must cover every supported query at least once');
  }
  return {methods,workloads,unsupported};
}

async function resources() {
  const response = await api('_nodes/stats/process,jvm,indices?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem.heap_used_in_bytes,nodes.*.indices.search,nodes.*.indices.store.size_in_bytes');
  return { at: new Date().toISOString(), node: Object.values(response.body.nodes)[0],
    clientCpu: process.cpuUsage(), clientMemory: process.memoryUsage() };
}

async function searchActivity(){
  return (await api('_nodes/stats/thread_pool,indices?filter_path=nodes.*.thread_pool.search,nodes.*.thread_pool.search_throttled,nodes.*.indices.search.query_current,nodes.*.indices.search.fetch_current,nodes.*.indices.merges.current')).body;
}
export async function settleSearchQueue({sample=searchActivity,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),intervalMs=1000,timeoutMs=30000,quietSamples=2}={}){
  const started=now(),samples=[];let consecutive=0;
  while(true){
    const snapshot=await sample(),nodes=Object.values(snapshot.nodes??{});
    if(!nodes.length||nodes.some(node=>!node.thread_pool?.search))throw Error('No node search activity evidence for settling');
    const pools=nodes.flatMap(node=>Object.entries(node.thread_pool).filter(([name])=>name.startsWith('search')).map(([,pool])=>pool));
    const observation={at:new Date().toISOString(),active:pools.reduce((sum,pool)=>sum+(pool.active??0),0),queued:pools.reduce((sum,pool)=>sum+(pool.queue??0),0),queryCurrent:nodes.reduce((sum,node)=>sum+(node.indices?.search?.query_current??0),0),fetchCurrent:nodes.reduce((sum,node)=>sum+(node.indices?.search?.fetch_current??0),0),merges:nodes.reduce((sum,node)=>sum+(node.indices?.merges?.current??0),0)};
    samples.push(observation);
    consecutive=observation.active===0&&observation.queued===0&&observation.queryCurrent===0&&observation.fetchCurrent===0?consecutive+1:0;
    const elapsedMs=now()-started;
    if(consecutive>=quietSamples)return {settled:true,elapsedMs,quietSamples,samples};
    if(elapsedMs>=timeoutMs)return {settled:false,elapsedMs,quietSamples,samples};
    await sleep(Math.min(intervalMs,timeoutMs-elapsedMs));
  }
}

export async function runArrivalLoad(configuration=arrivalConfiguration()) {
  if (new URL(BASE).port!=='19217') throw new Error('Arrival load must use isolated OpenSearch port 19217');
  const {index,seedIndex,selected,rates,durationMs,maxInFlight,queryIds}=configuration;
  safeIndexName(index);safeIndexName(seedIndex);
  const {methods,workloads,unsupported}=validateArrivalConfiguration(configuration);
  const directory = path.join(STORE, 'arrival-load', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(directory, { recursive: true });
  const sourceNames = (await readdir(new URL('.', import.meta.url))).filter(name => name.endsWith('.mjs')).sort();
  const sourceSnapshot = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, await readFile(new URL(name, import.meta.url), 'utf8')])));
  await writeFile(path.join(directory, 'source-snapshot.json'), JSON.stringify(sourceSnapshot, null, 2));
  const count = (await api(index + '/_count')).body.count;
  const result = { schemaVersion: 1, startedAt: new Date().toISOString(), base: BASE, index, count,
    version: (await api('')).body.version,
    configuration: { methods: selected, rates, durationMs, maxInFlight, seedIndex, queryIds },
    sourceSnapshotHash: hash(sourceSnapshot), sourceSnapshot: path.join(directory, 'source-snapshot.json'),
    unsupported,
    observedNodeConfiguration:(await api('_nodes/os,jvm?filter_path=nodes.*.name,nodes.*.os.allocated_processors,nodes.*.os.available_processors,nodes.*.jvm.mem.heap_max_in_bytes')).body,
    topology: { nodes: 1, shardsPerIndex: 1, replicas: 0, cpuLimit: 8, javaHeapGiB: 4, containerMemoryGiB: 12 },
    corpus: 'Synthetic mixtures of 545 source descriptors; no additional relevance labels.',
    latencyBoundary: 'Scheduled arrival to complete decoded service result, including client dispatch delay; failures and client rejections count.',
    limitations: ['Single shared host and client, one OpenSearch node; not a production capacity guarantee.',
      'Deterministic evenly spaced arrivals with a rotating mixed workload, not realistic bursty traffic.',
      'CPU counters are cached; resource samples are observations, not instantaneous peaks.',
      'Client in-flight cap rejects excess arrivals explicitly; these are failed requests.'],
    profiles: [], warmups: [], settling: [] };
  const save = async () => {
    await writeFile(path.join(directory, 'load.partial.json'), JSON.stringify(result, null, 2));
    await rename(path.join(directory, 'load.partial.json'), path.join(directory, 'load.json'));
  };
  console.log('ARRIVAL_ARTIFACT ' + path.join(directory, 'load.json'));
  await save();
  const settle=async context=>{
    const observation=await settleSearchQueue();result.settling.push({...context,...observation});await save();
    if(!observation.settled)throw Error('Node search activity did not settle within30seconds; stopping to avoid contaminating the next profile.');
    return observation;
  };
  try{
  for (const method of methods) {
    await settle({method:method.id,phase:'before-warmup'});
    const workload = workloads[method.id];
    const request = async item => {
      const response = await executeSearch({ index, seedIndex, method, query: item.query,
        filter: item.filter, limit: 20, timeoutMs: 2000, serviceTimeout: '950ms' });
      return { queryId: item.id, serviceTookMs: response.evidence.serviceTookMs,
        hitCount: response.hits.length, topHit: response.hits[0] };
    };
    const warmups = [];
    for (const item of workload) {
      const started = performance.now();
      try { warmups.push({ ...await request(item), elapsedMs: performance.now() - started }); }
      catch (error) { warmups.push({ queryId: item.id, error: error.message, elapsedMs: performance.now() - started }); }
    }
    result.warmups.push({method:method.id,at:new Date().toISOString(),trials:warmups});await save();
    for (const rate of rates) {
      const settlingBefore=await settle({method:method.id,rate,phase:'before-profile'});
      const before = await resources(), samples = [];
      let sampling = false, stopped = false;
      const timer = setInterval(async () => {
        if (sampling || stopped) return;
        sampling = true;
        try { samples.push(await resources()); }
        catch (error) { samples.push({ error: error.message }); }
        finally { sampling = false; }
      }, 1000);
      let measurement;
      try {
        measurement = await runArrivals({ rate, durationMs, maxInFlight,
          run: async ordinal => {
            const item = workload[ordinal % workload.length];
            try { return await request(item); }
            catch (error) { return { queryId: item.id, error: error.message }; }
          } });
      } finally { stopped = true; clearInterval(timer); }
      while (sampling) await new Promise(resolve => setTimeout(resolve, 5));
      const after = await resources();
      const warmupErrors = warmups.filter(item => item.error).length;
      const warmupOverOneSecond = warmups.filter(item => item.elapsedMs >= 1000).length;
      // Client-rejected arrivals never invoke request(), but still belong to their scheduled query.
      for(const trial of measurement.trials)trial.queryId??=workload[trial.ordinal%workload.length].id;
      const profile = { method: method.id, index, count, ...measurement, workload, warmups,settlingBefore,
        queryRequestCounts:Object.fromEntries(workload.map(item=>[item.id,measurement.trials.filter(trial=>trial.queryId===item.id).length])),
        warmupErrors, warmupOverOneSecond,
        strictViable: measurement.viableAtTestedLoad && warmupErrors === 0 && warmupOverOneSecond === 0,
        cpuMs: after.node.process.cpu.total_in_millis - before.node.process.cpu.total_in_millis,
        serviceCpuMs: (after.clientCpu.user + after.clientCpu.system - before.clientCpu.user - before.clientCpu.system) / 1000,
        peakObservedHeapBytes: Math.max(...[before, ...samples, after].map(item => item.node?.jvm?.mem?.heap_used_in_bytes ?? 0)),
        peakObservedServiceRssBytes: Math.max(...[before, ...samples, after].map(item => item.clientMemory?.rss ?? 0)),
        before, after, samples };
      result.profiles.push(profile);
      await save();
      console.log(JSON.stringify({ ...profile, workload: undefined, warmups: undefined, trials: undefined, before: undefined, after: undefined, samples: undefined }));
      profile.settlingAfter=await settle({method:method.id,rate,phase:'after-profile',measuredFailure:!measurement.viableAtTestedLoad});await save();
      if (!measurement.viableAtTestedLoad) break;
    }
  }
  result.finishedAt = new Date().toISOString();
  await save();
  return {directory,result};
  }catch(error){result.interruption={at:new Date().toISOString(),error:error.stack??String(error)};await save();throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runArrivalLoad(arrivalConfiguration(process.argv.slice(2)));
