// PERFORMANCE DATA ONLY. Standalone, resumable load driver; import has no side effects.
import { mkdir,readFile,writeFile,rename,appendFile,copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_NAMES } from './corpus-colors.mjs';
import { syntheticFeature,SYNTHETIC_PROVENANCE } from './scale-corpus.mjs';
import { RANK_FEATURE_METHODS,buildRankFeatureQuery,supportsRankFeatures } from './methods-rank-features.mjs';
import { toRankFeatureDocument,rankFeatureMapping,RANK_FEATURE_DEFINITION } from './rank-features-index.mjs';
import { api,BASE,STORE,CORPUS_STORE,loadFeatures,loadExpandedCorpus,safeIndexName,bulkIndex,searchIndex,hash } from './service.mjs';

export const SCALE_INDEX='color-exploration-rank-feature-scale-v1';
export const SOURCE_FIELDS=FEATURE_NAMES.flatMap(name=>[`cov_${name}`,`quality_${name}`]);
export const ENGINE_NOTES={
  collector:'Lucene9.7 TopFieldCollector retains TOP_SCORES when descending relevance is the first sort and total-hit counting is bounded, even with secondary ID sort. Secondary sorting does not categorically disable competitive pruning.',
  collectorSource:'https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/TopFieldCollector.java#L300',
  featureQuery:'FeatureQuery exposes block maximum scores and forwards the minimum competitive score to ImpactsDISI.',
  featureQuerySource:'https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/document/FeatureQuery.java#L116',
  inference:'The collector passes the current bottom score, so many equal-score blocks may remain competitive. Quantized-score ties and dense utility profiles still need empirical scaling evidence.',
};
const named=(name,percent)=>({name,...(percent==null?{}:{percent})});
// Kept identical to scale.mjs. Three custom-color/range cases are unsupported and recorded.
export const WORKLOAD=[
  {id:'red-vibe',query:{text:'red'}},
  {id:'green-vibe',query:{text:'green'}},
  {id:'blue-vibe',query:{text:'blue'}},
  {id:'orange-vibe-filter10',query:{text:'orange'},filter:{range:{partition:{lt:10}}}},
  {id:'pink-vibe-filter1',query:{text:'pink'},filter:{term:{partition:1}}},
  {id:'green40',query:{mode:'proportions',targets:[named('green',40)]}},
  {id:'green70',query:{mode:'proportions',targets:[named('green',70)]}},
  {id:'red20',query:{mode:'proportions',targets:[named('red',20)]}},
  {id:'redgreen50',query:{mode:'proportions',targets:[named('red',50),named('green',50)]}},
  {id:'blueorange40',query:{mode:'proportions',targets:[named('blue',40),named('orange',40)]}},
  {id:'gray80red20',query:{mode:'proportions',targets:[named('grayscale',80),named('red',20)]}},
  {id:'dark',query:{text:'dark'}},
  {id:'grayscale',query:{text:'grayscale'}},
  {id:'precise-warm-red',query:{swatchHex:'#ff2200'}},
  {id:'precise-muted-green',query:{swatchHex:'#4c8c72'}},
  {id:'hsl-dark-range',query:{mode:'proportions',targets:[{color:'#101010',percent:70,space:'hsl',tolerance:{h:1,s:0.2,l:0.15}}]}},
];
const SOURCE_FILES=['rank-features-scale.mjs','rank-features-index.mjs','methods-rank-features.mjs','scale-corpus.mjs','corpus-colors.mjs','query.mjs','service.mjs'];
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]:null;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Closed-loop load: minimum repetitions AND optional minimum elapsed duration.
 * Drain every started request. Individual failures stay in the returned evidence. */
export async function runWorkload({items,concurrency,repetitions,durationMs=0,trial,now=()=>performance.now()}){
  if(!items.length||!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isSafeInteger(repetitions)||repetitions<1||!Number.isFinite(durationMs)||durationMs<0)throw Error('Invalid workload configuration');
  const started=now(),minimumRequests=items.length*repetitions,trials=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(concurrency,minimumRequests)},async()=>{
    while(cursor<minimumRequests||now()-started<durationMs){
      const ordinal=cursor++,round=Math.floor(ordinal/items.length),item=items[(ordinal%items.length+round)%items.length];
      trials[ordinal]=await trial(item,ordinal);
    }
  }));
  return {trials,elapsedMs:now()-started,minimumRequests,durationMs};
}
export function summarizeTrials(trials,warmups){
  const successful=trials.filter(row=>!row.error).map(row=>row.elapsedMs),errors=trials.filter(row=>row.error).length;
  const overOneSecond=trials.filter(row=>row.overOneSecond||row.elapsedMs>=1000).length;
  const warmupErrors=warmups.filter(row=>row.error).length,warmupOverOneSecond=warmups.filter(row=>row.overOneSecond||row.elapsedMs>=1000).length;
  const timedRequestsViable=trials.length>0&&errors===0&&overOneSecond===0;
  return {requests:trials.length,p50Ms:percentile(successful,.5),p95Ms:percentile(successful,.95),p99Ms:percentile(successful,.99),maxMs:trials.length?trials.reduce((maximum,row)=>Math.max(maximum,row.elapsedMs),0):null,errors,overOneSecond,warmupErrors,warmupOverOneSecond,timedRequestsViable,viableAtTestedLoad:timedRequestsViable&&warmups.length>0&&warmupErrors===0&&warmupOverOneSecond===0};
}
async function atomicJson(filename,value){await writeFile(filename+'.tmp',JSON.stringify(value,null,2));await rename(filename+'.tmp',filename);}
async function optionalJson(filename){try{return JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}}
const cpuMs=sample=>Object.values(sample?.nodes??{}).reduce((sum,node)=>sum+(node.process?.cpu?.total_in_millis??0),0);
const totalHeap=sample=>Object.values(sample?.nodes??{}).reduce((sum,node)=>sum+(node.jvm?.mem?.heap_used_in_bytes??0),0);
async function resources(){
  const data=(await api('_nodes/stats/process,jvm,indices,thread_pool?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem,nodes.*.jvm.gc.collectors,nodes.*.indices.search,nodes.*.indices.merges.current,nodes.*.thread_pool.search')).body;
  return {at:new Date().toISOString(),nodes:data.nodes,serviceMemory:process.memoryUsage(),serviceCpu:process.cpuUsage()};
}
async function settleMerges(index){
  const started=performance.now();let current=0;
  for(let attempt=0;attempt<30;attempt++){
    const data=(await api(index+'/_stats/merge')).body;
    current=data._all?.total?.merges?.current??0;
    if(current===0)return {elapsedMs:performance.now()-started,settled:true};
    await pause(1000);
  }
  return {elapsedMs:performance.now()-started,settled:false,current};
}
export async function dryRun({samples=100}={}){
  if(!Number.isSafeInteger(samples)||samples<1)throw Error('Dry-run samples must be a positive integer');
  const features=await loadFeatures(),started=performance.now();let bytes=0,terms=0;
  for(let i=0;i<samples;i++){
    const document=toRankFeatureDocument(syntheticFeature(features,i,{fields:SOURCE_FIELDS}));
    const encoded=JSON.stringify({index:{_id:document.id}})+'\n'+JSON.stringify(document)+'\n';
    bytes+=Buffer.byteLength(encoded);terms+=Object.keys(document.utilities).length;
  }
  const elapsedMs=performance.now()-started;
  return {dryRun:true,noServiceRequests:true,samples,elapsedMs,documentsPerSecond:samples/(elapsedMs/1000),meanBytesPerBulkDocument:bytes/samples,meanFeaturesPerDocument:terms/samples,estimatedBulk50Bytes:bytes/samples*50,
    workload:WORKLOAD.length,supported:Object.fromEntries(RANK_FEATURE_METHODS.map(method=>[method.id,WORKLOAD.filter(item=>supportsRankFeatures(method,item.query).supported).length])),limitations:['Generation/serialization only; this is not an indexing or query performance measurement.']};
}
function options(args){
  const get=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
  return {index:get('--index',SCALE_INDEX),counts:get('--counts','1000,10000,100000,1000000').split(',').map(Number),concurrencies:get('--concurrency','1,4,16').split(',').map(Number),repetitions:Number(get('--repeats','4')),durationSeconds:Number(get('--duration-seconds','0')),batchSize:Number(get('--batch-size','50')),seed:Number(get('--seed','99539473')),resume:get('--resume'),directory:get('--directory'),rerun:args.includes('--rerun'),limit:Number(get('--limit','20'))};
}
export async function runRankFeatureScale(configuration){
  const config={...options([]),...configuration};
  if(new URL(BASE).port!=='19217')throw Error('Scale driver requires dedicated port19217 via COLOR_EXPLORATION_OPENSEARCH.');
  safeIndexName(config.index);
  if(!config.counts.every((n,i)=>Number.isSafeInteger(n)&&n>0&&n<=1000000&&(i===0||n>config.counts[i-1])))throw Error('Counts must be increasing integers1..1000000');
  if(!config.concurrencies.every(n=>Number.isSafeInteger(n)&&n>0&&n<=64)||!Number.isSafeInteger(config.repetitions)||config.repetitions<1)throw Error('Invalid concurrency/repetitions');
  if(!Number.isSafeInteger(config.batchSize)||config.batchSize<1||config.batchSize>1000)throw Error('Invalid batch size');
  if(!Number.isFinite(config.durationSeconds)||config.durationSeconds<0||config.durationSeconds>3600)throw Error('Duration must be 0..3600 seconds');
  const features=await loadFeatures(),corpus=await loadExpandedCorpus(),sourceHashes=Object.fromEntries(await Promise.all(SOURCE_FILES.map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
  if(features.length!==corpus.length)throw Error('Source corpus and descriptors have different sizes');
  const controlledFixtures=corpus.filter(asset=>asset.cohort==='controlled-fixture').length;
  const featureHash=hash(await readFile(path.join(CORPUS_STORE,'features.jsonl')));
  const identity={sourceFeatureHash:featureHash,seed:config.seed,sourceHashes:Object.fromEntries(['scale-corpus.mjs','rank-features-index.mjs','corpus-colors.mjs'].map(name=>[name,sourceHashes[name]])),mappingHash:hash(rankFeatureMapping({source:false})),utilityKeyHash:hash(toRankFeatureDocument(features[0]))};
  const identityHash=hash(identity),checkpointFile=path.join(STORE,config.index+'.checkpoint.json');
  let checkpoint=await optionalJson(checkpointFile);
  if(checkpoint&&checkpoint.identityHash!==identityHash)throw Error('Existing scale checkpoint uses different source descriptors/generator/mapping; choose a new index.');
  const directory=config.resume??config.directory??checkpoint?.directory??path.join(STORE,'rank-feature-scale',new Date().toISOString().replaceAll(':','-'));
  const sourceDirectory=path.join(directory,'sources',hash(sourceHashes).slice(0,16));
  await mkdir(sourceDirectory,{recursive:true});
  for(const name of SOURCE_FILES)await copyFile(fileURLToPath(new URL(name,import.meta.url)),path.join(sourceDirectory,name));
  let result=await optionalJson(path.join(directory,'scale.json'));
  if(result&&(result.identityHash!==identityHash||result.index!==config.index))throw Error('Resume run has a different index or source identity');
  result??={schemaVersion:1,index:config.index,base:BASE,startedAt:new Date().toISOString(),identity,identityHash,sourceHashes,configuration:config,workload:WORKLOAD,unsupported:Object.fromEntries(RANK_FEATURE_METHODS.map(method=>[method.id,WORKLOAD.filter(item=>!supportsRankFeatures(method,item.query).supported).map(item=>({queryId:item.id,reason:supportsRankFeatures(method,item.query).reason}))])),
    corpus:{...SYNTHETIC_PROVENANCE,sourceAssets:features.length,realPhotographs:features.length-controlledFixtures,controlledFixtures,sourceFeatureHash:featureHash},definition:RANK_FEATURE_DEFINITION,engineNotes:ENGINE_NOTES,indexing:[],warmups:[],profiles:[],skippedStages:[],invocations:[]};
  const invocationId=hash({at:new Date().toISOString(),configuration:config,sourceHashes}).slice(0,16);
  result.invocations.push({id:invocationId,at:new Date().toISOString(),configuration:config,sourceHashes,sourceDirectory});
  result.version=(await api('')).body.version;
  result.nodeConfiguration=(await api('_nodes/os,jvm,process?filter_path=nodes.*.name,nodes.*.os.allocated_processors,nodes.*.os.available_processors,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process')).body;
  const save=()=>atomicJson(path.join(directory,'scale.json'),result);
  let pendingWrites=Promise.resolve();
  const record=(filename,value)=>{pendingWrites=pendingWrites.then(()=>appendFile(path.join(directory,filename),JSON.stringify(value)+'\n'));};
  const saveCheckpoint=async()=>{checkpoint.updatedAt=new Date().toISOString();await atomicJson(checkpointFile,checkpoint);};
  console.log('RANK_FEATURE_SCALE_ARTIFACT '+path.join(directory,'scale.json'));
  // A checkpoint identifies the last fully acknowledged deterministic bulk. A partial
  // failed bulk is replayed from that boundary; unrelated existing indexes are rejected.
  let existingMapping;
  try{existingMapping=(await api(config.index+'/_mapping')).body[config.index]?.mappings;}
  catch(error){if(!error.message.includes('404'))throw error;}
  if(!existingMapping){
    if(checkpoint)throw Error('Checkpoint exists but its index is missing; refusing implicit recreation.');
    const mapping=rankFeatureMapping({source:false});mapping.mappings._meta={experiment:'rank-feature-scale',identityHash,identity};
    await api(config.index,{method:'PUT',body:mapping});
    checkpoint={schemaVersion:1,index:config.index,identityHash,identity,directory,nextIndex:0,completedStage:0,batchSize:config.batchSize};await saveCheckpoint();
  }else{
    if(existingMapping._meta?.identityHash!==identityHash||!checkpoint)throw Error('Existing index lacks this experiment checkpoint/identity; refusing to append.');
    await api(config.index+'/_refresh',{method:'POST'});
    const actual=(await api(config.index+'/_count')).body.count;
    if(actual<checkpoint.nextIndex||actual>checkpoint.nextIndex+checkpoint.batchSize)throw Error('Index count is inconsistent with the checkpoint or a single partial bulk.');
  }
  checkpoint.batchSize=config.batchSize;checkpoint.directory=directory;await saveCheckpoint();
  const trial=async(method,count,item,phase,concurrency,context={})=>{
    const started=performance.now();let row;
    try{
      const body=buildRankFeatureQuery({method,query:item.query,filter:item.filter,limit:config.limit});body.timeout='950ms';
      const response=await searchIndex(config.index,body,{timeoutMs:5000});
      const elapsedMs=performance.now()-started;
      row={method:method.id,count,queryId:item.id,phase,concurrency,elapsedMs,serviceTookMs:response.evidence.serviceTookMs,hits:response.hits,overOneSecond:elapsedMs>=1000};
    }catch(error){const elapsedMs=performance.now()-started;row={method:method.id,count,queryId:item.id,phase,concurrency,elapsedMs,error:error.message,overOneSecond:elapsedMs>=1000};}
    row={invocationId,...context,...row};record('requests.jsonl',row);
    // Keep complete hit evidence in JSONL, without retaining it for every sustained request.
    const {hits,...metrics}=row;return {...metrics,hitCount:hits?.length??0};
  };
  await save();
  try{
    for(const count of config.counts){
      if(checkpoint.nextIndex>count){result.skippedStages.push({count,actualAtLeast:checkpoint.nextIndex,reason:'Existing index is larger; no query result is labeled as this smaller size.'});await save();continue;}
      if(checkpoint.nextIndex<count){
        const before=await resources(),started=performance.now(),from=checkpoint.nextIndex;
        await api(config.index+'/_settings',{method:'PUT',body:{index:{refresh_interval:'-1'}}});
        while(checkpoint.nextIndex<count){
          const end=Math.min(count,checkpoint.nextIndex+config.batchSize),documents=[];
          for(let i=checkpoint.nextIndex;i<end;i++)documents.push(toRankFeatureDocument(syntheticFeature(features,i,{fields:SOURCE_FIELDS,seed:config.seed})));
          await bulkIndex(config.index,documents);
          checkpoint.nextIndex=end;checkpoint.batchSize=config.batchSize;await saveCheckpoint();
          if(end%10000===0||end===count)console.log('Indexed '+end+'/'+count+' rank-feature documents in '+Math.round((performance.now()-started)/1000)+'s');
        }
        await api(config.index+'/_refresh',{method:'POST'});
        const actual=(await api(config.index+'/_count')).body.count;if(actual!==count)throw Error('Index count mismatch: '+actual+' vs '+count);
        const after=await resources();
        result.indexing.push({count,from,indexed:count-from,elapsedMs:performance.now()-started,cpuMs:cpuMs(after)-cpuMs(before),before,after});
        checkpoint.completedStage=count;await saveCheckpoint();await save();
      }
      const countCheck=(await api(config.index+'/_count')).body.count;if(countCheck!==count)throw Error('Count changed before benchmark');
      const mergeStatus=await settleMerges(config.index);result.lastMergeStatus={count,...mergeStatus};
      result.indexStats??=[];result.indexStats.push({count,at:new Date().toISOString(),stats:(await api(config.index+'/_stats/store,docs,segments')).body._all});await save();
      for(const method of RANK_FEATURE_METHODS){
        const items=WORKLOAD.filter(item=>supportsRankFeatures(method,item.query).supported);
        const incomplete=config.concurrencies.some(concurrency=>config.rerun||!result.profiles.some(profile=>profile.method===method.id&&profile.count===count&&profile.concurrency===concurrency));
        if(!incomplete)continue;
        const warmupId=invocationId+':'+count+':'+method.id;
        const warmups=[];for(const item of items)warmups.push(await trial(method,count,item,'warmup',1,{warmupId}));
        result.warmups.push({id:warmupId,invocationId,at:new Date().toISOString(),count,method:method.id,trials:warmups});await save();
        for(const concurrency of config.concurrencies){
          if(!config.rerun&&result.profiles.some(profile=>profile.method===method.id&&profile.count===count&&profile.concurrency===concurrency))continue;
          const before=await resources(),samples=[before],profileId=warmupId+':c'+concurrency;
          let sampling=false,stopSampling=false,pendingSample=Promise.resolve();
          const timer=setInterval(()=>{
            if(sampling||stopSampling)return;sampling=true;
            pendingSample=resources().then(sample=>{samples.push(sample);record('resources.jsonl',{count,method:method.id,concurrency,...sample});}).catch(error=>{samples.push({at:new Date().toISOString(),error:error.message});}).finally(()=>{sampling=false;});
          },1000);
          let measurement;
          try{measurement=await runWorkload({items,concurrency,repetitions:config.repetitions,durationMs:config.durationSeconds*1000,trial:(item,ordinal)=>trial(method,count,item,'timed',concurrency,{profileId,warmupId,ordinal})});}
          finally{stopSampling=true;clearInterval(timer);await pendingSample;}
          const {trials,elapsedMs,minimumRequests,durationMs}=measurement,after=await resources();samples.push(after);
          const profile={id:profileId,invocationId,warmupId,method:method.id,index:config.index,count,concurrency,elapsedMs,minimumRequests,requestedDurationMs:durationMs,measurement:'closed-loop',...summarizeTrials(trials,warmups),throughputPerSecond:trials.length/(elapsedMs/1000),
            cpuMs:cpuMs(after)-cpuMs(before),serviceCpuMs:((after.serviceCpu.user-before.serviceCpu.user)+(after.serviceCpu.system-before.serviceCpu.system))/1000,peakObservedHeapBytes:Math.max(...samples.map(totalHeap)),peakObservedServiceRssBytes:Math.max(...samples.map(sample=>sample.serviceMemory?.rss??0)),resourceSampleCount:samples.length,before,after,trials,
            resourceLimitations:'CPU covers the whole node and counters may be cached; zero short-block deltas do not establish zero CPU use. Heap/RSS peaks are sampled at1second plus boundaries, not true peaks. Resource polling and artifact writes add measurement overhead. Shared host, closed-loop clients; not an arrival-rate SLO test.'};
          result.profiles.push(profile);await pendingWrites;await save();
          console.log(JSON.stringify({...profile,trials:undefined,before:undefined,after:undefined}));
          if(concurrency===1&&!profile.viableAtTestedLoad){result.skippedStages.push({count,method:method.id,concurrencies:config.concurrencies.filter(n=>n>1),reason:'Serial failure already violates the strict one-second criterion; higher concurrent load skipped.'});await save();break;}
        }
      }
    }
    await pendingWrites;result.finishedAt=new Date().toISOString();await save();return {directory,result};
  }catch(error){
    await pendingWrites;result.interruptions??=[];result.interruptions.push({at:new Date().toISOString(),error:error.stack??String(error),nextIndex:checkpoint.nextIndex});await save();throw error;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const sampleArgument=args.indexOf('--samples');
  if(args.includes('--dry-run'))console.log(JSON.stringify(await dryRun({samples:sampleArgument<0?100:Number(args[sampleArgument+1])}),null,2));
  else await runRankFeatureScale(options(args));
}
