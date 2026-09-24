// THROWAWAY PERFORMANCE EXPERIMENT. Actual rounded synthetic palettes, native service ranking.
import { mkdir,readFile,writeFile,rename,appendFile,copyFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticFeature,SYNTHETIC_PROVENANCE } from './scale-corpus.mjs';
import { PRECISION_GRID_METHODS,buildPrecisionGridQuery,supportsPrecisionGrid } from './methods-precision-grid.mjs';
import { createPrecisionGridEncoder,precisionGridMapping,precisionGridFingerprints,PRECISION_GRID_DEFINITION } from './precision-grid-index.mjs';
import { runWorkload,summarizeTrials,beginInvocation,ENGINE_NOTES } from './rank-features-scale.mjs';
import { settleSearchQueue } from './arrival-load.mjs';
import { WORKLOAD } from './workload.mjs';
import { api,BASE,STORE,loadFeatures,loadExpandedCorpus,safeIndexName,bulkIndex,searchIndex,hash } from './service.mjs';

export const SCALE_INDEX='color-exploration-precision-grid-scale-v1';
export const SOURCE_FIELDS=['palette32_packed','palette_total'];
const METHOD=PRECISION_GRID_METHODS[0];
export const SUPPORTED_WORKLOAD=WORKLOAD.filter(item=>supportsPrecisionGrid(METHOD,item.query).supported);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cpuMs=sample=>Object.values(sample?.nodes??{}).reduce((sum,node)=>sum+(node.process?.cpu?.total_in_millis??0),0);
const heapBytes=sample=>Object.values(sample?.nodes??{}).reduce((sum,node)=>sum+(node.jvm?.mem?.heap_used_in_bytes??0),0);
async function atomicJson(filename,value){await writeFile(filename+'.tmp',JSON.stringify(value,null,2));await rename(filename+'.tmp',filename);}
async function optionalJson(filename){try{return JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}}
const pinnedColors=features=>features.flatMap(feature=>feature.palette32_packed.map(value=>Math.floor(value/65536)));

export function gridScaleConfiguration(args=[]){
  const get=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
  return {index:get('--index',SCALE_INDEX),counts:get('--counts','1000,10000,100000,1000000').split(',').map(Number),concurrencies:get('--concurrency','1,4,16').split(',').map(Number),repetitions:Number(get('--repeats','4')),durationSeconds:Number(get('--duration-seconds','0')),batchSize:Number(get('--batch-size','100')),seed:Number(get('--seed','99539473')),resume:get('--resume'),directory:get('--directory'),rerun:args.includes('--rerun'),limit:Number(get('--limit','20')),mergeWaitSeconds:Number(get('--merge-wait-seconds','300'))};
}
export function validateGridScaleConfiguration(config){
  safeIndexName(config.index);
  if(!config.counts.length||!config.counts.every((n,i)=>Number.isSafeInteger(n)&&n>0&&n<=1000000&&(i===0||n>config.counts[i-1])))throw Error('Counts must be increasing integers1..1000000');
  if(!config.concurrencies.length||!config.concurrencies.every((n,i)=>Number.isSafeInteger(n)&&n>0&&n<=64&&(i===0||n>config.concurrencies[i-1]))||!Number.isSafeInteger(config.repetitions)||config.repetitions<1)throw Error('Invalid concurrency/repetitions');
  if(!Number.isSafeInteger(config.batchSize)||config.batchSize<1||config.batchSize>1000)throw Error('Invalid batch size');
  if(!Number.isSafeInteger(config.seed)||!Number.isSafeInteger(config.limit)||config.limit<1||config.limit>1000)throw Error('Invalid seed or result limit');
  if(!Number.isFinite(config.durationSeconds)||config.durationSeconds<0||config.durationSeconds>3600)throw Error('Duration must be 0..3600 seconds');
  if(!Number.isFinite(config.mergeWaitSeconds)||config.mergeWaitSeconds<0||config.mergeWaitSeconds>600)throw Error('Merge wait must be 0..600 seconds');
  return config;
}
export function gridScaleIdentity({fingerprints,generatorHash,seed}){
  return {descriptorHash:fingerprints.descriptorHash,definitionHash:fingerprints.definitionHash,computationHash:fingerprints.computationHash,generatorHash,seed,mappingHash:hash(precisionGridMapping({source:false})),sourceFields:SOURCE_FIELDS,syntheticPalette:'Actual rounded32 palette, including merged RGB tail; anchor utilities are never blended from source utilities.'};
}
export function validateGridScaleResume({checkpoint,metadata,identityHash,actual,nextBatchSize=checkpoint?.batchSize}){
  if(!checkpoint||checkpoint.identityHash!==identityHash||metadata?.identityHash!==identityHash)throw Error('Grid index/checkpoint identity mismatch');
  if(!Number.isSafeInteger(actual)||actual<checkpoint.nextIndex||actual>checkpoint.nextIndex+checkpoint.batchSize)throw Error('Grid index count is inconsistent with the checkpoint or a single partial bulk');
  if(actual>checkpoint.nextIndex&&nextBatchSize<checkpoint.batchSize)throw Error('Cannot replay a partial bulk with a smaller batch size');
  return true;
}
export async function settleGridFailure({result,context,save,settle=settleSearchQueue}){
  const observation=await settle();result.settling??=[];result.settling.push({...context,...observation});await save();
  if(!observation.settled)throw Error('Search activity did not settle after a failed grid measurement; refusing to continue');
  return observation;
}
async function resources(){
  const data=(await api('_nodes/stats/process,jvm,indices,thread_pool?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem,nodes.*.jvm.gc.collectors,nodes.*.indices.search,nodes.*.indices.merges.current,nodes.*.thread_pool.search')).body;
  return {at:new Date().toISOString(),nodes:data.nodes,serviceMemory:process.memoryUsage(),serviceCpu:process.cpuUsage()};
}
async function settleMerges(index,seconds){
  const started=performance.now();let current;
  do{current=(await api(index+'/_stats/merge')).body._all?.total?.merges?.current;
    if(current===0)return {elapsedMs:performance.now()-started,settled:true,current};
    if(performance.now()-started>=seconds*1000)return {elapsedMs:performance.now()-started,settled:false,current};
    await pause(1000);
  }while(true);
}
export async function dryRun({samples=1000}={}){
  if(!Number.isSafeInteger(samples)||samples<1||samples>100000)throw Error('Dry-run samples must be1..100000');
  const features=await loadFeatures(),encoder=createPrecisionGridEncoder({pinnedRgb:pinnedColors(features)}),started=performance.now();let bytes=0,utilities=0;const distinct=new Set();
  for(let i=0;i<samples;i++){
    const document=encoder.encode(syntheticFeature(features,i,{fields:SOURCE_FIELDS}));
    const encoded=JSON.stringify(document);bytes+=Buffer.byteLength(JSON.stringify({index:{_id:document.id}})+'\n'+encoded+'\n');utilities+=Object.keys(document.utilities).length;distinct.add(hash(document.utilities));
  }
  const elapsedMs=performance.now()-started;
  return {dryRun:true,noServiceRequests:true,samples,elapsedMs,documentsPerSecond:samples/(elapsedMs/1000),meanBytesPerBulkDocument:bytes/samples,meanUtilitiesPerDocument:utilities/samples,distinctQuantizedUtilityVectors:distinct.size,encoder:encoder.stats(),clientMemory:process.memoryUsage(),supportedQueries:SUPPORTED_WORKLOAD.length,totalQueries:WORKLOAD.length,limitations:['Generation/serialization only, not index or query performance. Different mixtures can share quantized utilities; these are not one million independent photographs.']};
}

export async function runPrecisionGridScale(configuration={}){
  const config=validateGridScaleConfiguration({...gridScaleConfiguration(),...configuration});
  if(new URL(BASE).port!=='19217')throw Error('Grid scale requires isolated OpenSearch port19217');
  const features=await loadFeatures(),corpus=await loadExpandedCorpus(),assetIds=new Set(corpus.map(asset=>asset.id));
  if(features.length!==corpus.length||new Set(features.map(feature=>feature.id)).size!==corpus.length||features.some(feature=>!assetIds.has(feature.id)))throw Error('Source corpus and descriptor IDs differ');
  // Archive the complete local module set, including transitive scorer imports.
  const sourceFiles=(await readdir(new URL('.',import.meta.url))).filter(name=>name.endsWith('.mjs')).sort();
  const fingerprints=await precisionGridFingerprints(),sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
  const identity=gridScaleIdentity({fingerprints,generatorHash:sourceHashes['scale-corpus.mjs'],seed:config.seed}),identityHash=hash(identity),checkpointFile=path.join(STORE,config.index+'.checkpoint.json');
  let checkpoint=await optionalJson(checkpointFile);
  if(checkpoint&&checkpoint.identityHash!==identityHash)throw Error('Existing grid checkpoint uses different descriptors/encoder/generator/mapping; choose a new index');
  const directory=config.resume??config.directory??checkpoint?.directory??path.join(STORE,'precision-grid-scale',new Date().toISOString().replaceAll(':','-'));
  const sourceDirectory=path.join(directory,'sources',hash(sourceHashes).slice(0,16));await mkdir(sourceDirectory,{recursive:true});
  for(const name of sourceFiles)await copyFile(fileURLToPath(new URL(name,import.meta.url)),path.join(sourceDirectory,name));
  let result=await optionalJson(path.join(directory,'scale.json'));
  if(result&&(result.identityHash!==identityHash||result.index!==config.index))throw Error('Resume run has a different index or source identity');
  const controlledFixtures=corpus.filter(asset=>asset.cohort==='controlled-fixture').length;
  result??={schemaVersion:1,engine:'opensearch',index:config.index,base:BASE,startedAt:new Date().toISOString(),identity,identityHash,fingerprints,sourceHashes,configuration:config,workload:WORKLOAD,unsupported:{[METHOD.id]:WORKLOAD.filter(item=>!supportsPrecisionGrid(METHOD,item.query).supported).map(item=>({queryId:item.id,reason:supportsPrecisionGrid(METHOD,item.query).reason}))},corpus:{...SYNTHETIC_PROVENANCE,sourceAssets:features.length,realPhotographs:features.length-controlledFixtures,controlledFixtures,sourceFeatureHash:fingerprints.descriptorHash},definition:PRECISION_GRID_DEFINITION,engineNotes:ENGINE_NOTES,latencyBoundary:'Query construction through complete decoded service result; warmups and every failure count against strict <1000ms viability. Percentiles use successful requests, with all failure counts and maximum latency separately reported.',indexing:[],warmups:[],profiles:[],skippedStages:[],invocations:[]};
  const invocationId=hash({at:new Date().toISOString(),config,sourceHashes}).slice(0,16);
  beginInvocation(result,{id:invocationId,at:new Date().toISOString(),configuration:config,sourceHashes,sourceDirectory});
  result.version=(await api('')).body.version;
  result.nodeConfiguration=(await api('_nodes/os,jvm,process?filter_path=nodes.*.name,nodes.*.os.allocated_processors,nodes.*.os.available_processors,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process')).body;
  const save=()=>atomicJson(path.join(directory,'scale.json'),result);
  let pendingWrites=Promise.resolve();
  const record=(filename,value)=>{pendingWrites=pendingWrites.then(()=>appendFile(path.join(directory,filename),JSON.stringify(value)+'\n'));};
  const saveCheckpoint=async()=>{checkpoint.updatedAt=new Date().toISOString();await atomicJson(checkpointFile,checkpoint);};
  console.log('PRECISION_GRID_SCALE_ARTIFACT '+path.join(directory,'scale.json'));
  let existingMapping;try{existingMapping=(await api(config.index+'/_mapping')).body[config.index]?.mappings;}catch(error){if(!error.message.includes('404'))throw error;}
  if(!existingMapping){
    if(checkpoint)throw Error('Checkpoint exists but grid index is missing; refusing implicit recreation');
    const mapping=precisionGridMapping({source:false});mapping.mappings._meta={experiment:'precision-grid-scale',identityHash,identity,...fingerprints};await api(config.index,{method:'PUT',body:mapping});
    checkpoint={schemaVersion:1,index:config.index,identityHash,identity,directory,nextIndex:0,completedStage:0,batchSize:config.batchSize};await saveCheckpoint();
  }else{
    await api(config.index+'/_refresh',{method:'POST'});
    validateGridScaleResume({checkpoint,metadata:existingMapping._meta,identityHash,actual:(await api(config.index+'/_count')).body.count,nextBatchSize:config.batchSize});
  }
  checkpoint.batchSize=config.batchSize;checkpoint.directory=directory;await saveCheckpoint();
  const encoder=createPrecisionGridEncoder({pinnedRgb:pinnedColors(features)});
  const trial=async(count,item,phase,concurrency,context={})=>{
    const started=performance.now();let row;
    try{
      const body=buildPrecisionGridQuery({query:item.query,filter:item.filter,limit:config.limit});body.timeout='950ms';
      const response=await searchIndex(config.index,body,{timeoutMs:5000}),elapsedMs=performance.now()-started;
      row={method:METHOD.id,count,queryId:item.id,phase,concurrency,elapsedMs,serviceTookMs:response.evidence.serviceTookMs,hits:response.hits,overOneSecond:elapsedMs>=1000};
    }catch(error){const elapsedMs=performance.now()-started;row={method:METHOD.id,count,queryId:item.id,phase,concurrency,elapsedMs,error:error.message,overOneSecond:elapsedMs>=1000};}
    row={invocationId,...context,...row};record('requests.jsonl',row);const {hits,...metrics}=row;return {...metrics,hitCount:hits?.length??0};
  };
  await save();
  try{
    for(const count of config.counts){
      if(checkpoint.nextIndex>count){result.skippedStages.push({count,actualAtLeast:checkpoint.nextIndex,reason:'Existing index is larger; no query result is labeled as this smaller size'});await save();continue;}
      if(checkpoint.nextIndex<count){
        const before=await resources(),started=performance.now(),from=checkpoint.nextIndex;let utilityCount=0,encodedDocuments=0;
        await api(config.index+'/_settings',{method:'PUT',body:{index:{refresh_interval:'-1'}}});
        while(checkpoint.nextIndex<count){
          const end=Math.min(count,checkpoint.nextIndex+config.batchSize),documents=[];
          for(let i=checkpoint.nextIndex;i<end;i++){const document=encoder.encode(syntheticFeature(features,i,{fields:SOURCE_FIELDS,seed:config.seed}));utilityCount+=Object.keys(document.utilities).length;encodedDocuments++;documents.push(document);}
          await bulkIndex(config.index,documents);checkpoint.nextIndex=end;await saveCheckpoint();
          if(end%10000===0||end===count)console.log('Indexed '+end+'/'+count+' precision-grid documents in '+Math.round((performance.now()-started)/1000)+'s');
        }
        await api(config.index+'/_refresh',{method:'POST'});
        const actual=(await api(config.index+'/_count')).body.count;if(actual!==count)throw Error('Grid count mismatch: '+actual+' vs '+count);
        const after=await resources();result.indexing.push({count,from,indexed:count-from,elapsedMs:performance.now()-started,cpuMs:cpuMs(after)-cpuMs(before),meanUtilitiesPerDocument:utilityCount/encodedDocuments,encoder:encoder.stats(),before,after});
        checkpoint.completedStage=count;await saveCheckpoint();await save();
      }
      if((await api(config.index+'/_count')).body.count!==count)throw Error('Grid count changed before profiling');
      const mergeStatus=await settleMerges(config.index,config.mergeWaitSeconds);result.lastMergeStatus={count,...mergeStatus};
      result.indexStats??=[];result.indexStats.push({count,at:new Date().toISOString(),stats:(await api(config.index+'/_stats/store,docs,segments')).body._all});await save();
      const incomplete=config.concurrencies.some(concurrency=>config.rerun||!result.profiles.some(profile=>profile.method===METHOD.id&&profile.count===count&&profile.concurrency===concurrency));if(!incomplete)continue;
      const warmupId=invocationId+':'+count+':'+METHOD.id,warmups=[];
      for(const item of SUPPORTED_WORKLOAD)warmups.push(await trial(count,item,'warmup',1,{warmupId}));
      result.warmups.push({id:warmupId,invocationId,at:new Date().toISOString(),count,method:METHOD.id,trials:warmups});await save();
      if(warmups.some(row=>row.error||row.elapsedMs>=1000))await settleGridFailure({result,save,context:{count,warmupId,phase:'after-failed-warmup'}});
      for(const concurrency of config.concurrencies){
        if(!config.rerun&&result.profiles.some(profile=>profile.method===METHOD.id&&profile.count===count&&profile.concurrency===concurrency))continue;
        const before=await resources(),samples=[before],profileId=warmupId+':c'+concurrency;let sampling=false,stopped=false,pendingSample=Promise.resolve();
        const timer=setInterval(()=>{if(sampling||stopped)return;sampling=true;pendingSample=resources().then(sample=>{samples.push(sample);record('resources.jsonl',{count,method:METHOD.id,concurrency,...sample});}).catch(error=>samples.push({at:new Date().toISOString(),error:error.message})).finally(()=>{sampling=false;});},1000);
        let measurement;
        try{measurement=await runWorkload({items:SUPPORTED_WORKLOAD,concurrency,repetitions:config.repetitions,durationMs:config.durationSeconds*1000,trial:(item,ordinal)=>trial(count,item,'timed',concurrency,{profileId,warmupId,ordinal})});}
        finally{stopped=true;clearInterval(timer);await pendingSample;}
        const {trials,elapsedMs,minimumRequests,durationMs}=measurement,after=await resources();samples.push(after);
        const profile={id:profileId,invocationId,warmupId,method:METHOD.id,index:config.index,count,concurrency,effectiveConcurrency:Math.min(concurrency,minimumRequests),elapsedMs,minimumRequests,requestedDurationMs:durationMs,measurement:'closed-loop',...summarizeTrials(trials,warmups),throughputPerSecond:trials.length/(elapsedMs/1000),cpuMs:cpuMs(after)-cpuMs(before),serviceCpuMs:((after.serviceCpu.user-before.serviceCpu.user)+(after.serviceCpu.system-before.serviceCpu.system))/1000,peakObservedHeapBytes:Math.max(...samples.map(heapBytes)),peakObservedServiceRssBytes:Math.max(...samples.map(sample=>sample.serviceMemory?.rss??0)),resourceSampleCount:samples.length,before,after,trials,resourceLimitations:'Whole-node CPU may include background merges and cached counters. Heap/RSS are sampled at1second plus boundaries. Resource polling and artifact writes add overhead. Shared host closed-loop clients; not an arrival-rate SLO guarantee.'};
        result.profiles.push(profile);await pendingWrites;await save();console.log(JSON.stringify({...profile,trials:undefined,before:undefined,after:undefined}));
        if(!profile.viableAtTestedLoad){result.skippedStages.push({count,method:METHOD.id,concurrencies:config.concurrencies.filter(n=>n>concurrency),reason:'Strict one-second criterion failed; higher concurrent load skipped'});await save();await settleGridFailure({result,save,context:{count,profileId,phase:'after-failed-profile'}});break;}
      }
    }
    await pendingWrites;result.finishedAt=new Date().toISOString();result.invocations.at(-1).finishedAt=result.finishedAt;result.encoder=encoder.stats();await save();return {directory,result};
  }catch(error){await pendingWrites;result.interruptions??=[];result.interruptions.push({at:new Date().toISOString(),error:error.stack??String(error),nextIndex:checkpoint.nextIndex});await save();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),sampleArgument=args.indexOf('--samples');
  if(args.includes('--dry-run'))console.log(JSON.stringify(await dryRun({samples:sampleArgument<0?1000:Number(args[sampleArgument+1])}),null,2));
  else await runPrecisionGridScale(gridScaleConfiguration(args));
}
