// THROWAWAY. Native OpenSearch ranking over synthetic coverage/quality mixtures.
import { mkdir,readFile,writeFile,rename,appendFile,readdir,copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OVERLAP_METHODS,buildOverlapQuery,supportsOverlap } from './methods-overlap.mjs';
import { loadOverlapDocuments,overlapMapping,overlapFingerprints } from './overlap-index.mjs';
import { OVERLAP_DEFINITION } from './overlap-regions.mjs';
import { syntheticOverlapDocument,OVERLAP_SYNTHETIC_PROVENANCE } from './overlap-scale-corpus.mjs';
import { runWorkload,summarizeTrials,beginInvocation } from './rank-features-scale.mjs';
import { settleSearchQueue } from './arrival-load.mjs';
import { gridScaleConfiguration,validateGridScaleConfiguration,validateGridScaleResume } from './precision-grid-scale.mjs';
import { WORKLOAD } from './workload.mjs';
import { api,BASE,STORE,safeIndexName,bulkIndex,searchIndex,hash } from './service.mjs';

export const OVERLAP_SCALE_INDEX='color-exploration-overlap-scale-v1';
export const OVERLAP_WORKLOAD=[...WORKLOAD,
  {id:'picked-green40',query:{mode:'proportions',targets:[{color:'#22cc44',percent:40}]}},
  {id:'picked-redgreen50',query:{mode:'proportions',targets:[{color:'#ff2200',percent:50},{color:'#22cc44',percent:50}]}},
  {id:'picked-five-colors',query:{mode:'proportions',targets:['#ff2200','#ff8800','#ffff00','#22cc44','#2266ff'].map(color=>({color,percent:20}))}},
];
const optionalJson=async filename=>{try{return JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}};
const atomicJson=async(filename,value)=>{await writeFile(filename+'.tmp',JSON.stringify(value,null,2));await rename(filename+'.tmp',filename);};
const cpuMs=sample=>Object.values(sample?.nodes??{}).reduce((sum,node)=>sum+(node.process?.cpu?.total_in_millis??0),0);
const heapBytes=sample=>Object.values(sample?.nodes??{}).reduce((sum,node)=>sum+(node.jvm?.mem?.heap_used_in_bytes??0),0);
async function resources(){
  const data=(await api('_nodes/stats/process,jvm,indices,thread_pool?filter_path=nodes.*.process.cpu.total_in_millis,nodes.*.jvm.mem,nodes.*.jvm.gc.collectors,nodes.*.indices.search,nodes.*.indices.merges.current,nodes.*.thread_pool.search')).body;
  return {at:new Date().toISOString(),nodes:data.nodes,serviceMemory:process.memoryUsage(),serviceCpu:process.cpuUsage()};
}
async function settleMerges(index,seconds){
  const started=performance.now();let current;
  do{current=(await api(index+'/_stats/merge')).body._all?.total?.merges?.current;
    if(current===0||performance.now()-started>=seconds*1000)return {elapsedMs:performance.now()-started,settled:current===0,current};
    await new Promise(resolve=>setTimeout(resolve,1000));
  }while(true);
}
export async function runOverlapScale(configuration={}) {
  const config=validateGridScaleConfiguration({...gridScaleConfiguration(),index:OVERLAP_SCALE_INDEX,...configuration});
  safeIndexName(config.index);
  if(new URL(BASE).port!=='19217')throw Error('Overlap scale requires isolated OpenSearch port19217');
  const documents=await loadOverlapDocuments(),coverageFields=Object.keys(documents[0]).filter(key=>key.startsWith('cov_')).sort();
  if(documents.length!==545||new Set(documents.map(item=>item.id)).size!==545)throw Error('Expected complete545-source descriptor corpus');
  const fingerprints=await overlapFingerprints();
  const files=(await readdir(new URL('.',import.meta.url))).filter(name=>name.endsWith('.mjs')).sort();
  const sourceHashes=Object.fromEntries(await Promise.all(files.map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])));
  const mapping=overlapMapping({source:false});
  const identity={fingerprints,descriptorsHash:hash(documents),mappingHash:hash(mapping),generatorHash:sourceHashes['overlap-scale-corpus.mjs'],seed:config.seed},identityHash=hash(identity);
  const checkpointFile=path.join(STORE,config.index+'.checkpoint.json');let checkpoint=await optionalJson(checkpointFile);
  if(checkpoint&&checkpoint.identityHash!==identityHash)throw Error('Overlap descriptor/generator identity changed; choose a fresh index');
  const directory=config.resume??config.directory??checkpoint?.directory??path.join(STORE,'overlap-scale',new Date().toISOString().replaceAll(':','-'));
  const sourceDirectory=path.join(directory,'sources',hash(sourceHashes).slice(0,16));await mkdir(sourceDirectory,{recursive:true});
  for(const name of files)await copyFile(fileURLToPath(new URL(name,import.meta.url)),path.join(sourceDirectory,name));
  let result=await optionalJson(path.join(directory,'scale.json'));
  if(result&&(result.identityHash!==identityHash||result.index!==config.index))throw Error('Resume artifact identity mismatch');
  result??={schemaVersion:1,engine:'opensearch',index:config.index,base:BASE,startedAt:new Date().toISOString(),identity,identityHash,fingerprints,configuration:config,
    sourceHashes,sourceDirectory,workload:OVERLAP_WORKLOAD,unsupported:Object.fromEntries(OVERLAP_METHODS.map(method=>[method.id,OVERLAP_WORKLOAD.filter(item=>!supportsOverlap(method,item.query).supported).map(item=>({queryId:item.id,reason:supportsOverlap(method,item.query).reason}))])),
    corpus:{...OVERLAP_SYNTHETIC_PROVENANCE,sourceAssets:documents.length,realPhotographs:523,controlledFixtures:22},definition:OVERLAP_DEFINITION,
    engineNotes:['Native function_score queries use numeric doc values, decay functions and indexed coverage range predicates. No rank_feature/FeatureQuery or block-max pruning claim is made.','Exact global ordering for the stored formula, without application candidate reranking.'],latencyBoundary:'Compilation through decoded service response. Every failure and >=1000ms response including warmups fails the tested strict profile. Percentiles describe successful requests only.',
    indexing:[],warmups:[],profiles:[],skippedStages:[],invocations:[]};
  const invocationId=hash({at:new Date().toISOString(),config,sourceHashes}).slice(0,16);
  beginInvocation(result,{id:invocationId,at:new Date().toISOString(),configuration:config,sourceHashes,sourceDirectory});
  result.version=(await api('')).body.version;
  result.nodeConfiguration=(await api('_nodes/os,jvm,process?filter_path=nodes.*.name,nodes.*.os.allocated_processors,nodes.*.os.available_processors,nodes.*.jvm.mem.heap_max_in_bytes,nodes.*.process')).body;
  const save=()=>atomicJson(path.join(directory,'scale.json'),result);
  let pendingWrites=Promise.resolve();
  const record=(filename,value)=>{pendingWrites=pendingWrites.then(()=>appendFile(path.join(directory,filename),JSON.stringify(value)+'\n'));};
  const saveCheckpoint=async()=>{checkpoint.updatedAt=new Date().toISOString();await atomicJson(checkpointFile,checkpoint);};
  let existing;
  try{existing=(await api(config.index+'/_mapping')).body[config.index]?.mappings;}catch(error){if(!error.message.includes('404'))throw error;}
  if(!existing){
    if(checkpoint)throw Error('Checkpoint exists but index is missing');
    mapping.mappings._meta={experiment:'overlap-scale',identityHash,identity};await api(config.index,{method:'PUT',body:mapping});
    checkpoint={schemaVersion:1,index:config.index,identityHash,identity,directory,nextIndex:0,completedStage:0,batchSize:config.batchSize};
  }else{
    await api(config.index+'/_refresh',{method:'POST'});
    validateGridScaleResume({checkpoint,metadata:existing._meta,identityHash,actual:(await api(config.index+'/_count')).body.count,nextBatchSize:config.batchSize});
  }
  checkpoint.batchSize=config.batchSize;checkpoint.directory=directory;await saveCheckpoint();await save();
  console.log('OVERLAP_SCALE_ARTIFACT '+path.join(directory,'scale.json'));
  const trial=async(method,count,item,phase,concurrency,context={})=>{
    const started=performance.now();let row;
    try{
      const body=buildOverlapQuery({method,query:item.query,filter:item.filter,limit:config.limit});body.timeout='950ms';
      const response=await searchIndex(config.index,body,{timeoutMs:5000}),elapsedMs=performance.now()-started;
      const eligible=item.filter?.term?.partition===1?Math.floor(count/100):item.filter?.range?.partition?.lt===10?Math.floor(count/100)*10:count;
      if(response.hits.length!==Math.min(config.limit,eligible))throw Error(`Expected ${Math.min(config.limit,eligible)} globally ranked hits, received ${response.hits.length}`);
      row={method:method.id,count,queryId:item.id,phase,concurrency,elapsedMs,serviceTookMs:response.evidence.serviceTookMs,hits:response.hits,overOneSecond:elapsedMs>=1000};
    }catch(error){const elapsedMs=performance.now()-started;row={method:method.id,count,queryId:item.id,phase,concurrency,elapsedMs,error:error.message,overOneSecond:elapsedMs>=1000};}
    row={invocationId,...context,...row};record('requests.jsonl',row);const{hits,...metrics}=row;return {...metrics,hitCount:hits?.length??0};
  };
  const settle=async context=>{const observation=await settleSearchQueue();result.settling??=[];result.settling.push({...context,...observation});await save();if(!observation.settled)throw Error('Search queue did not settle');};
  try{
    for(const count of config.counts){
      if(checkpoint.nextIndex>count){result.skippedStages.push({count,actualAtLeast:checkpoint.nextIndex,reason:'Existing index larger; smaller size not measured'});await save();continue;}
      if(checkpoint.nextIndex<count){
        const before=await resources(),started=performance.now(),from=checkpoint.nextIndex;
        await api(config.index+'/_settings',{method:'PUT',body:{index:{refresh_interval:'-1'}}});
        while(checkpoint.nextIndex<count){
          const end=Math.min(count,checkpoint.nextIndex+config.batchSize),batch=[];
          for(let i=checkpoint.nextIndex;i<end;i++)batch.push(syntheticOverlapDocument(documents,i,{seed:config.seed,coverageFields}));
          await bulkIndex(config.index,batch);checkpoint.nextIndex=end;await saveCheckpoint();
          if(end%10000===0||end===count)console.log('Indexed '+end+'/'+count+' overlap documents in '+Math.round((performance.now()-started)/1000)+'s');
        }
        await api(config.index+'/_refresh',{method:'POST'});
        const actual=(await api(config.index+'/_count')).body.count;if(actual!==count)throw Error('Count mismatch '+actual+' vs '+count);
        const after=await resources();result.indexing.push({count,from,indexed:count-from,elapsedMs:performance.now()-started,cpuMs:cpuMs(after)-cpuMs(before),before,after});
        checkpoint.completedStage=count;await saveCheckpoint();await save();
      }
      if((await api(config.index+'/_count')).body.count!==count)throw Error('Count changed before profiling');
      result.lastMergeStatus={count,...await settleMerges(config.index,config.mergeWaitSeconds)};
      result.indexStats??=[];result.indexStats.push({count,at:new Date().toISOString(),stats:(await api(config.index+'/_stats/store,docs,segments')).body._all});await save();
      for(const method of OVERLAP_METHODS){
        if(!config.concurrencies.some(concurrency=>config.rerun||!result.profiles.some(profile=>profile.method===method.id&&profile.count===count&&profile.concurrency===concurrency)))continue;
        const items=OVERLAP_WORKLOAD.filter(item=>supportsOverlap(method,item.query).supported),warmupId=invocationId+':'+count+':'+method.id,warmups=[];
        for(const item of items)warmups.push(await trial(method,count,item,'warmup',1,{warmupId}));
        result.warmups.push({id:warmupId,invocationId,at:new Date().toISOString(),count,method:method.id,trials:warmups});await save();
        if(warmups.some(row=>row.error||row.elapsedMs>=1000))await settle({count,warmupId,phase:'after-failed-warmup'});
        for(const concurrency of config.concurrencies){
          if(!config.rerun&&result.profiles.some(profile=>profile.method===method.id&&profile.count===count&&profile.concurrency===concurrency))continue;
          const before=await resources(),samples=[before],profileId=warmupId+':c'+concurrency;let sampling=false,stopped=false,pendingSample=Promise.resolve();
          const timer=setInterval(()=>{if(sampling||stopped)return;sampling=true;pendingSample=resources().then(sample=>{samples.push(sample);record('resources.jsonl',{count,method:method.id,concurrency,...sample});}).catch(error=>samples.push({error:error.message})).finally(()=>{sampling=false;});},1000);
          let measurement;
          try{measurement=await runWorkload({items,concurrency,repetitions:config.repetitions,durationMs:config.durationSeconds*1000,trial:(item,ordinal)=>trial(method,count,item,'timed',concurrency,{profileId,warmupId,ordinal})});}
          finally{stopped=true;clearInterval(timer);await pendingSample;}
          const{trials,elapsedMs,minimumRequests,durationMs}=measurement,after=await resources();samples.push(after);
          const profile={id:profileId,invocationId,warmupId,method:method.id,index:config.index,count,concurrency,effectiveConcurrency:Math.min(concurrency,minimumRequests),elapsedMs,minimumRequests,requestedDurationMs:durationMs,measurement:'closed-loop',
            ...summarizeTrials(trials,warmups),throughputPerSecond:trials.length/(elapsedMs/1000),cpuMs:cpuMs(after)-cpuMs(before),serviceCpuMs:((after.serviceCpu.user-before.serviceCpu.user)+(after.serviceCpu.system-before.serviceCpu.system))/1000,
            peakObservedHeapBytes:Math.max(...samples.map(heapBytes)),peakObservedServiceRssBytes:Math.max(...samples.map(sample=>sample.serviceMemory?.rss??0)),resourceSampleCount:samples.length,before,after,trials,
            resourceLimitations:'Whole-node CPU includes background activity. Memory sampled once/second. Shared-host closed-loop test; not a production arrival-rate guarantee.'};
          result.profiles.push(profile);await pendingWrites;await save();console.log(JSON.stringify({...profile,trials:undefined,before:undefined,after:undefined}));
          if(!profile.viableAtTestedLoad){result.skippedStages.push({count,method:method.id,concurrencies:config.concurrencies.filter(value=>value>concurrency),reason:'Strict one-second criterion failed; higher concurrency skipped'});await save();await settle({count,profileId,phase:'after-failed-profile'});break;}
        }
      }
    }
    await pendingWrites;result.finishedAt=new Date().toISOString();result.invocations.at(-1).finishedAt=result.finishedAt;await save();return {directory,result};
  }catch(error){await pendingWrites;result.interruptions??=[];result.interruptions.push({at:new Date().toISOString(),error:error.stack??String(error),nextIndex:checkpoint.nextIndex});await save();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),configuration=gridScaleConfiguration(args);
  if(!args.includes('--index'))configuration.index=OVERLAP_SCALE_INDEX;
  await runOverlapScale(configuration);
}
