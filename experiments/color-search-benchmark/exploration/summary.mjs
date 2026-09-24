// Read-only synthesis of saved evidence. This module never queries OpenSearch.
import { createReadStream } from 'node:fs';
import { readdir,readFile,stat,mkdir,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { METHODS } from './registry.mjs';
import { STORE,CORPUS_STORE } from './service.mjs';
import { PRECISION_GRID_INDEX } from './precision-grid-index.mjs';

const cache=new Map();
const BAD_INTEGRATION_RUN='2026-09-20T01-05-55.159Z-0406f877';
const BASELINE_UNSNAPSHOTTED_RUN='2026-09-20T00-51-14.799Z';
const feedbackDrop=new Set(['hits','trials','samplesMs','notes','observations','discrepancies','orderGroups','availableImageIds','resources']);
const scaleDrop=new Set(['hits']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const pct=value=>finite(value)?(value*100).toFixed(1)+'%':'—';
const ms=value=>finite(value)?value.toFixed(value<10?2:1)+' ms':'—';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const md=value=>String(value??'').replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
const reportLink=(base,id)=>base.replace(/\/$/,'')+'/'+encodeURIComponent(id)+'/report.html';
const engineName=engine=>engine==='clickhouse'?'ClickHouse':'OpenSearch';
export function feedbackBackendReason(method,execution){
  const declared=method.engine??'opensearch',kind=String(execution?.kind??'').toLowerCase();
  const actual=['opensearch','clickhouse'].find(engine=>kind===engine||kind.startsWith(engine+'-'));
  if(!actual)return 'Does not execute ranking in a supported real search service.';
  return actual===declared?null:`Execution backend ${actual} does not match the registered ${declared} engine.`;
}
async function directories(root){try{return (await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>path.join(root,entry.name)).sort();}catch(error){if(error.code==='ENOENT')return [];throw error;}}

/** Streaming JSON projection: skip bulky named values before constructing JS objects.
 * Replacing discarded values with null preserves object/array syntax. Scalar metrics,
 * configurations, case coverage and source hashes remain untouched. */
export function createJsonPruner(dropKeys){
  let quoted=false,escaped=false,token='',lastString=null,waiting=false,skipping=null,depth=0,skipQuoted=false,skipEscaped=false;
  return {
    feed(chunk){
      let output='';
      for(let index=0;index<chunk.length;index++){
        const c=chunk[index];
        if(skipping){
          if(skipping==='scalar'){
            if(!/[\s,}\]]/.test(c))continue;
            skipping=null;index--;continue;
          }
          if(skipQuoted){
            if(skipEscaped)skipEscaped=false;
            else if(c==='\\')skipEscaped=true;
            else if(c==='"'){skipQuoted=false;if(skipping==='string')skipping=null;}
            continue;
          }
          if(c==='"')skipQuoted=true;
          else if(c==='['||c==='{')depth++;
          else if(c===']'||c==='}'){depth--;if(depth===0)skipping=null;}
          continue;
        }
        if(waiting){
          if(/\s/.test(c))continue;
          output+='null';waiting=false;
          if(c==='['||c==='{'){skipping='composite';depth=1;skipQuoted=false;}
          else if(c==='"'){skipping='string';skipQuoted=true;skipEscaped=false;}
          else skipping='scalar';
          continue;
        }
        output+=c;
        if(quoted){
          if(token!==null){token+=c;if(token.length>128)token=null;}
          if(escaped)escaped=false;
          else if(c==='\\')escaped=true;
          else if(c==='"'){quoted=false;lastString=token===null?null:JSON.parse(token);}
          continue;
        }
        if(c==='"'){quoted=true;escaped=false;token='"';lastString=null;}
        else if(c===':'){waiting=dropKeys.has(lastString);lastString=null;}
        else if(!/\s/.test(c))lastString=null;
      }
      return output;
    },
    finish(){if(quoted||waiting||skipping==='composite'||skipping==='string')throw Error('Artifact ended inside a JSON value');},
  };
}
async function readProjected(filename,kind){
  const info=await stat(filename),version=info.size+':'+info.mtimeMs,previous=cache.get(filename);
  if(previous?.version===version)return {value:previous.value,mtime:info.mtime.toISOString(),cached:true};
  try{
    const parser=createJsonPruner(kind==='feedback'?feedbackDrop:scaleDrop),parts=[];
    for await(const chunk of createReadStream(filename,{encoding:'utf8',highWaterMark:128*1024}))parts.push(parser.feed(chunk));
    parser.finish();
    const projected=JSON.parse(parts.join(''));
    const value=kind==='feedback'?compactFeedback(projected):kind==='arrival'?compactArrival(projected,filename):compactScale(projected,filename);
    cache.set(filename,{version,value});return {value,mtime:info.mtime.toISOString()};
  }catch(error){
    if(previous)return {value:previous.value,mtime:info.mtime.toISOString(),warning:'Using the last complete saved snapshot while '+filename+' is being written: '+error.message};
    throw error;
  }
}
function compactFeedback(run){
  const caseMetric=metric=>metric?{status:metric.status,metricPolicy:metric.metricPolicy,allPairs:metric.allPairs,withoutUncertain:metric.withoutUncertain,eligibility:metric.eligibility,coverageFraction:metric.coverage?.fraction}:null;
  return {id:run.id,createdAt:run.createdAt,label:run.label,dataset:run.dataset,workload:run.workload,configuration:run.configuration,environment:run.environment,runnerSourceHashes:run.runnerSourceHashes,
    candidates:(run.candidates??[]).map(candidate=>({id:candidate.id,label:candidate.label,configuration:candidate.configuration,execution:candidate.execution,sourceHashes:candidate.sourceHashes,metadata:candidate.metadata,setup:candidate.setup,summary:candidate.summary,
      cases:(candidate.cases??[]).map(item=>({caseId:item.caseId,category:item.category,status:item.status,reason:item.reason,accuracy:caseMetric(item.accuracy),timedAccuracy:caseMetric(item.timedAccuracy)}))}))};
}
function compactScale(run,filename){
  const warmups=run.warmups??[];
  const engine=run.engine??'opensearch';
  const backendMetadata=run.finalMetadata??run.settling?.at(-1)?.metadata??run.indexing?.at(-1)?.metadata;
  const topology=run.topology??run.nodeConfiguration??(engine==='clickhouse'&&backendMetadata?{engine:'MergeTree',nodes:1,hostname:backendMetadata.hostname,containerLimits:backendMetadata.containerLimits}:undefined);
  return {filename,engine,table:run.table,startedAt:run.startedAt,finishedAt:run.finishedAt,configuration:run.configuration,version:run.version??backendMetadata?.version,topology,corpus:run.corpus,sourceHashes:run.sourceHashes,sourceSnapshot:run.sourceSnapshot,sourceSnapshotHash:run.sourceSnapshotHash,invocations:run.invocations,indexing:run.indexing?.map(({before,after,...item})=>item),indexStats:run.indexStats,
    provenanceLimitation:!run.sourceHashes||filename.includes(BASELINE_UNSNAPSHOTTED_RUN)?'Source hashes and full source snapshots were not captured at this baseline run’s start. Later working files cannot establish its original exact source.':run.sourceSnapshot?'Source hashes and an archived source snapshot are recorded.':run.invocations?.some(item=>item.sourceDirectory)?'Source hashes and archived invocation sources are recorded.':'Source hashes recorded; no archived source directory is identified in this artifact.',
    profiles:(run.profiles??[]).map((profile,ordinal)=>{
      const firstPass=(profile.warmupId?warmups.find(item=>item.id===profile.warmupId):warmups.filter(item=>item.count===profile.count&&(item.method===profile.method||(engine==='clickhouse'&&!item.method))).at(-1))?.trials??[];
      const warmupErrors=firstPass.length?firstPass.filter(item=>item.error).length:profile.warmupErrors??null;
      const warmupOverOneSecond=firstPass.length?firstPass.filter(item=>item.overOneSecond||item.elapsedMs>=1000).length:profile.warmupOverOneSecond??null;
      const errors=Math.max(profile.errors??0,profile.trials?.filter(item=>item.error).length??0);
      const overOneSecond=Math.max(profile.overOneSecond??0,profile.trials?.filter(item=>item.overOneSecond||item.elapsedMs>=1000).length??0);
      const failed=errors>0||overOneSecond>0||profile.maxMs>=1000||(warmupErrors??0)>0||(warmupOverOneSecond??0)>0;
      const complete=profile.requests>0&&finite(profile.p95Ms)&&finite(profile.maxMs)&&warmupErrors!==null&&warmupOverOneSecond!==null;
      return {method:profile.method,engine:profile.engine??engine,maxThreadsPerRequest:profile.maxThreadsPerRequest??run.configuration?.maxThreadsPerRequest,index:profile.index,table:profile.table??run.table,backendVersion:profile.before?.version??run.version??backendMetadata?.version,count:profile.count,concurrency:profile.concurrency,effectiveConcurrency:profile.effectiveConcurrency??Math.min(profile.concurrency,profile.requests),requests:profile.requests,p50Ms:profile.p50Ms,p95Ms:profile.p95Ms,p99Ms:profile.p99Ms,maxMs:profile.maxMs,errors,overOneSecond,warmupErrors,warmupOverOneSecond,
        warmupSamples:firstPass.length,warmupMaxMs:firstPass.length?Math.max(...firstPass.map(item=>item.elapsedMs).filter(finite)):null,status:failed?'fail':complete?'pass':'incomplete',
        elapsedMs:profile.elapsedMs,requestedDurationMs:profile.requestedDurationMs??run.configuration?.durationMs,measurement:profile.measurement,percentilePolicy:profile.percentilePolicy,warmupId:profile.warmupId,invocationId:profile.invocationId,throughputPerSecond:profile.throughputPerSecond,cpuMs:profile.cpuMs,serviceCpuMs:profile.serviceCpuMs,peakObservedHeapBytes:profile.peakObservedHeapBytes,peakObservedServiceRssBytes:profile.peakObservedServiceRssBytes,observedServerRssBytes:profile.maximumObservedServerRssBytes,observedServiceRssBytes:profile.maximumObservedServiceRssBytes,resourceLimitations:profile.resourceLimitations,
        capturedAt:profile.after?.at??profile.before?.at??run.startedAt,ordinal,artifact:filename,
        errorsByQuery:(profile.trials??[]).filter(item=>item.error||item.overOneSecond||item.elapsedMs>=1000).map(item=>({queryId:item.queryId,error:item.error,elapsedMs:item.elapsedMs})),
      };
    })};
}
function compactArrival(run,filename){
  return {filename,startedAt:run.startedAt,finishedAt:run.finishedAt,configuration:run.configuration,topology:run.topology,corpus:run.corpus,latencyBoundary:run.latencyBoundary,limitations:run.limitations,sourceSnapshotHash:run.sourceSnapshotHash,sourceSnapshot:run.sourceSnapshot,
    profiles:(run.profiles??[]).map(profile=>{
      const warmups=profile.warmups??[],trials=profile.trials??[];
      const errors=Math.max(profile.errors??0,trials.filter(item=>item.error).length),overOneSecond=Math.max(profile.overOneSecond??0,trials.filter(item=>item.elapsedMs>=1000).length),clientRejected=Math.max(profile.clientRejected??0,trials.filter(item=>item.clientRejected).length);
      const warmupErrors=warmups.length?warmups.filter(item=>item.error).length:profile.warmupErrors??null,warmupOverOneSecond=warmups.length?warmups.filter(item=>item.elapsedMs>=1000).length:profile.warmupOverOneSecond??null;
      const failed=errors>0||overOneSecond>0||clientRejected>0||profile.maxMs>=1000||(warmupErrors??0)>0||(warmupOverOneSecond??0)>0;
      const complete=profile.requests>0&&finite(profile.p95Ms)&&finite(profile.maxMs)&&warmupErrors!==null&&warmupOverOneSecond!==null;
      return {method:profile.method,index:profile.index,count:profile.count,rate:profile.rate,durationMs:profile.durationMs,elapsedMs:profile.elapsedMs,requests:profile.requests,p95Ms:profile.p95Ms,maxMs:profile.maxMs,errors,overOneSecond,clientRejected,warmupErrors,warmupOverOneSecond,warmupMaxMs:warmups.length?Math.max(...warmups.map(item=>item.elapsedMs)):null,status:failed?'fail':complete?'pass':'incomplete',queryIds:(profile.workload??[]).map(item=>item.id),maxInFlight:profile.maxInFlight,peakInFlight:profile.peakInFlight,maximumSchedulerDelayMs:profile.maximumSchedulerDelayMs,artifact:filename,sourceSnapshotHash:run.sourceSnapshotHash,capturedAt:profile.after?.at??run.startedAt};
    })};
}
function evidenceRecord(run,candidate,reportBase){
  const coverage=candidate.summary?.coverage??{},accuracy=candidate.summary?.accuracy??{},performance=candidate.summary?.performance??{};
  return {methodId:candidate.configuration?.method??candidate.metadata?.id??candidate.id,candidateId:candidate.id,label:candidate.label,runId:run.id,runLabel:run.label,createdAt:run.createdAt,reportUrl:reportLink(reportBase,run.id),
    configuration:candidate.configuration,workload:run.workload,execution:candidate.execution,sourceHashes:candidate.sourceHashes,runnerSourceHashes:run.runnerSourceHashes,descriptorHashes:candidate.setup?.descriptorHashes,corpusSize:run.dataset?.corpusSize,corpusHash:run.dataset?.corpusHash,datasetHash:run.dataset?.hash,
    coverage,accuracy:accuracy.allPairs,withoutUncertain:accuracy.withoutUncertain,categories:accuracy.categories,eligibilityViolations:accuracy.eligibilityViolations,
    top20PairCoverage:candidate.summary?.timedAccuracy?.allPairs?.pairCoverage,top20AssessedPairs:candidate.summary?.timedAccuracy?.allPairs?.assessedPairs,performance,cases:candidate.cases,limitations:candidate.metadata?.limitations??[],
    sensitivity:Boolean(candidate.configuration?.baseId||candidate.id!==(candidate.configuration?.method??candidate.id)||Object.keys(candidate.configuration?.parameters??{}).length||/sweep|sensitivity/i.test(run.label??''))};
}
function sameCases(record,baseline){
  if(!baseline)return {available:false,reason:'No compatible HSV baseline is saved.'};
  const selected=baseline.cases.filter(item=>item.status==='ok'&&item.accuracy?.status==='complete'&&finite(item.accuracy?.allPairs?.agreement));
  const actual=new Map(record.cases.map(item=>[item.caseId,item]));
  const common=selected.filter(item=>actual.get(item.caseId)?.status==='ok'&&actual.get(item.caseId)?.accuracy?.status==='complete'&&finite(actual.get(item.caseId)?.accuracy?.allPairs?.agreement));
  if(record.datasetHash!==baseline.datasetHash||record.corpusHash!==baseline.corpusHash)return {available:false,assessed:common.length,total:selected.length,reason:'Dataset or corpus fingerprints differ from the HSV baseline.'};
  if(common.length!==selected.length||!selected.length)return {available:false,assessed:common.length,total:selected.length,reason:'This method does not completely assess all HSV baseline cases; no partial-subset score is substituted.'};
  const candidateAgreement=mean(selected.map(item=>actual.get(item.caseId).accuracy.allPairs.agreement)),baselineAgreement=mean(selected.map(item=>item.accuracy.allPairs.agreement));
  return {available:true,assessed:common.length,total:selected.length,candidateAgreement,baselineAgreement,delta:candidateAgreement-baselineAgreement,caseIds:selected.map(item=>item.caseId),baselineRunId:baseline.runId};
}
function concurrencyText(profile){const clients=profile.effectiveConcurrency!==profile.concurrency?'C'+profile.effectiveConcurrency+' (requested '+profile.concurrency+')':'C'+profile.concurrency;return clients+(profile.maxThreadsPerRequest?' · '+profile.maxThreadsPerRequest+' threads/query':'');}
function profileCells(profile){return [concurrencyText(profile),ms(profile.p95Ms),ms(profile.maxMs),String(profile.errors),String(profile.overOneSecond),ms(profile.warmupMaxMs),`${profile.warmupErrors??'?'} / ${profile.warmupOverOneSecond??'?'}`,profile.status.toUpperCase()];}
const statusLabel=profile=>profile.status==='pass'?'PASS at this tested load':profile.status==='fail'?'FAIL: observed error or ≥1 second':'NOT YET VERIFIED';
const compareText=comparison=>comparison.available?pct(comparison.candidateAgreement)+' vs '+pct(comparison.baselineAgreement)+' ('+(comparison.delta>=0?'+':'')+(comparison.delta*100).toFixed(1)+' pp)':(comparison.assessed??0)+'/'+(comparison.total??20)+' cases; unavailable';
const millionText=profiles=>profiles.length?profiles.map(profile=>concurrencyText(profile)+': '+ms(profile.p95Ms)+' p95; '+statusLabel(profile)+'; '+profile.errors+' errors, '+profile.overOneSecond+' timed ≥1s, '+(profile.warmupErrors??'?')+' warmup errors, '+(profile.warmupOverOneSecond??'?')+' warmup ≥1s').join(' / '):'NOT YET TESTED';

export async function renderFindings({corpusStore=CORPUS_STORE,explorationStore=STORE,reportBaseUrl='http://zerotwo:8224'}={}){
  if(!['http:','https:'].includes(new URL(reportBaseUrl).protocol))throw Error('Report links require an HTTP(S) base URL');
  const warnings=[],runs=[];
  for(const directory of await directories(path.join(corpusStore,'runs'))){
    try{const read=await readProjected(path.join(directory,'run.json'),'feedback');runs.push(read.value);if(read.warning)warnings.push(read.warning);}
    catch(error){if(error.code!=='ENOENT')warnings.push('Skipped an incomplete/unreadable feedback artifact '+directory+': '+error.message);}
  }
  runs.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const scaleRuns=[];
  for(const root of ['scale','rank-feature-scale','clickhouse-scale','precision-grid-scale','overlap-scale'])for(const directory of await directories(path.join(explorationStore,root))){
    try{const read=await readProjected(path.join(directory,'scale.json'),'scale');scaleRuns.push(read.value);if(read.warning)warnings.push(read.warning);}
    catch(error){if(error.code!=='ENOENT')warnings.push('Skipped an incomplete/unreadable scale artifact '+directory+': '+error.message);}
  }
  const arrivalRuns=[];
  for(const directory of await directories(path.join(explorationStore,'arrival-load'))){
    try{const read=await readProjected(path.join(directory,'load.json'),'arrival');arrivalRuns.push(read.value);if(read.warning)warnings.push(read.warning);}
    catch(error){if(error.code!=='ENOENT')warnings.push('Skipped an incomplete/unreadable arrival-load artifact '+directory+': '+error.message);}
  }
  const manifest=JSON.parse(await readFile(path.join(corpusStore,'expanded-corpus.json'),'utf8'));
  const corpusCount=manifest.assets?.length??manifest.length,fixtureCount=manifest.summary?.controlledFixtures??manifest.assets?.filter(asset=>asset.cohort==='controlled-fixture').length??0,registered=new Map(METHODS.map(method=>[method.id,method])),records=[],rejected=[],sensitivities=[];
  for(const run of runs)for(const candidate of run.candidates??[]){
    const record=evidenceRecord(run,candidate,reportBaseUrl);
    if(!registered.has(record.methodId))continue;
    let reason=null;
    if(run.id===BAD_INTEGRATION_RUN)reason='Invalid first round4 integration attempt: zero supported cases; superseded by corrected integration.';
    else if(record.corpusSize!==corpusCount)reason='Does not use the complete current expanded corpus.';
    else if(feedbackBackendReason(registered.get(record.methodId),record.execution))reason=feedbackBackendReason(registered.get(record.methodId),record.execution);
    else if(!(record.coverage.ok>0))reason='No supported completed case; cannot establish accuracy.';
    else if((record.coverage.error??0)>0||(record.performance.failures??0)>0)reason='Feedback execution contains errors; retained as an excluded attempt.';
    else if(!finite(record.accuracy?.queryMacroAgreement))reason='No assessed preference pairs; no accuracy value is substituted.';
    if(reason){rejected.push({methodId:record.methodId,runId:run.id,reportUrl:record.reportUrl,reason});continue;}
    if(record.sensitivity)sensitivities.push(record);else records.push(record);
  }
  const latest=new Map(records.map(record=>[record.methodId,record])),baseline=latest.get('hsv-cosine-ann');
  const precisionComparison=await precisionEvidence(latest,explorationStore,warnings);
  const profileMap=new Map();
  for(const scale of scaleRuns)for(const profile of scale.profiles){
    const key=[profile.method,profile.count,profile.concurrency,profile.maxThreadsPerRequest??''].join(':'),previous=profileMap.get(key);
    if(!previous||String(profile.capturedAt)>String(previous.capturedAt)||profile.capturedAt===previous.capturedAt&&profile.ordinal>previous.ordinal)profileMap.set(key,profile);
  }
  const rows=METHODS.map(method=>{
    const record=latest.get(method.id),profiles=[...profileMap.values()].filter(profile=>profile.method===method.id).sort((a,b)=>a.count-b.count||a.concurrency-b.concurrency);
    return {id:method.id,label:method.label,family:method.family,objectiveApproximation:method.objectiveApproximation??record?.execution?.objectiveApproximation??false,engine:method.engine??'opensearch',representation:method.representation,retrieval:record?.execution?.retrieval??(method.approximate?'approximate':'exact-stored-objective'),record:record??null,comparison:record?sameCases(record,baseline):{available:false,reason:'No valid default run saved.'},scaleProfiles:profiles,million:profiles.filter(profile=>profile.count===1000000),largestTestedCount:profiles.length?Math.max(...profiles.map(profile=>profile.count)):null};
  });
  const summary={schemaVersion:1,generatedAt:new Date().toISOString(),corpus:{count:corpusCount,...manifest.summary},registryCount:METHODS.length,validDefaultMethods:rows.filter(row=>row.record).length,caseCount:baseline?.coverage.total??37,baseline:baseline?{methodId:baseline.methodId,runId:baseline.runId,reportUrl:baseline.reportUrl,agreement:baseline.accuracy.queryMacroAgreement,supportedCases:baseline.coverage.ok}:null,
    caveats:['Development preference evidence from one observer, including a quickly completed 24-case batch. These are not population relevance scores or independent samples.','Unsupported cases and unjudged wallpapers are not scored as wrong. Pairwise agreement is reported only for assessed judgments, with coverage retained.',`The full ${corpusCount}-asset corpus contains ${corpusCount-fixtureCount} real wallpapers and ${fixtureCount} controlled fixtures. Newly imported ZIP wallpapers remain unjudged.`,'Agreement uses a larger diagnostic result window; small-corpus latency uses 20 results. Sparse judged-pair coverage in those 20 results limits conclusions about their user-visible quality.','Million-document tests use synthetic descriptor mixtures, not one million independently sourced wallpapers. They measure execution, not new human accuracy.','Strict scale PASS requires no errors or observations at or above one second in warmups and timed requests. It applies only to the recorded workload, hardware and concurrency.','OpenSearch CPU counters can stay unchanged during short blocks because statistics are cached. A zero delta does not establish zero CPU usage.','There is no combined accuracy/speed leaderboard or declared overall winner.'],
    methods:rows,precisionComparison,sensitivities:sensitivities.map(record=>({...record,comparison:sameCases(record,baseline)})),excludedAttempts:rejected,feedbackRuns:runs.map(run=>({id:run.id,label:run.label,createdAt:run.createdAt,corpusSize:run.dataset?.corpusSize,candidates:run.candidates.length,reportUrl:reportLink(reportBaseUrl,run.id)})),scaleRuns:scaleRuns.map(({profiles,...run})=>({...run,profilesRecorded:profiles.length})),arrivalProfiles:arrivalRuns.flatMap(run=>run.profiles),arrivalRuns:arrivalRuns.map(({profiles,...run})=>({...run,profilesRecorded:profiles.length})),warnings};
  const markdown=renderMarkdown(summary);
  const history='<details><summary>All saved feedback reports ('+summary.feedbackRuns.length+')</summary><ul>'+summary.feedbackRuns.map(run=>'<li><a href="'+esc(run.reportUrl)+'">'+esc(run.label??run.id)+'</a><br><code>'+esc(run.id)+'</code> · '+esc(run.corpusSize)+' assets · '+run.candidates+' configurations</li>').join('')+'</ul></details>';
  const html=renderHtml(summary).replace('<h2 id="million">',renderPrecisionHtml(summary.precisionComparison)+'<h2 id="million">').replace('<h2 id="sensitivity">',renderArrivalHtml(summary)+'<h2 id="sensitivity">').replace('</main>',history+'</main>');return {html,markdown,summary};
}
async function precisionEvidence(latest,explorationStore,warnings){
  const candidate=latest.get('rank-features-precision-grid'),reference=latest.get('palette-precision-typed');
  if(!candidate||!reference)return {available:false,reason:'Both the grid and continuous palette precision feedback are required.'};
  const comparison=sameCases(candidate,reference);
  const cases=(comparison.caseIds??[]).map(id=>({id,grid:candidate.cases.find(item=>item.caseId===id).accuracy.allPairs.agreement,continuous:reference.cases.find(item=>item.caseId===id).accuracy.allPairs.agreement}));
  const result={...comparison,candidateRunId:candidate.runId,referenceRunId:reference.runId,cases};
  const filename=path.join(explorationStore,PRECISION_GRID_INDEX+'-diagnostics.json');
  try{
    const raw=JSON.parse(await readFile(filename,'utf8'));
    if(raw.validation?.descriptorHash!==candidate.descriptorHashes?.features||raw.validation?.computationHash!==candidate.descriptorHashes?.gridComputation)throw Error('Diagnostic descriptor/computation fingerprints differ from the saved grid feedback.');
    result.diagnostics={artifact:filename,index:raw.index,queryCount:raw.queryCount,summary:raw.summary};
  }catch(error){if(error.code!=='ENOENT')warnings.push('Precision-grid diagnostics unavailable: '+error.message);}
  return result;
}
function precisionDescription(comparison){
  if(!comparison?.available)return comparison?.reason??'No shared precision comparison is saved.';
  return `${comparison.assessed} identical complete development cases: interpolated grid ${pct(comparison.candidateAgreement)} versus continuous palette ${pct(comparison.baselineAgreement)} query-macro agreement. This small, single-observer set does not establish general superiority.`;
}
function precisionDiagnosticText(diagnostics){
  if(!diagnostics)return 'No matching grid interpolation diagnostics saved.';
  const d=diagnostics.summary;
  return `${diagnostics.queryCount} color queries: mean top20 overlap with the continuous palette order ${pct(d.meanTop20Recall)}; mean top20 utility loss ${d.meanTop20UtilityLoss.toFixed(5)}; maximum individual score difference ${d.maximumAbsoluteScoreError.toFixed(4)}. These compare scoring formulas, not human relevance. Range boundaries can produce substantial score changes.`;
}
function precisionMarkdown(comparison){
  if(!comparison?.available)return [];
  return ['','## Precision grid versus continuous palette','',precisionDescription(comparison),'',precisionDiagnosticText(comparison.diagnostics),'','| Case | Interpolated grid | Continuous palette |','| --- | ---: | ---: |',...comparison.cases.map(item=>'| '+[item.id,pct(item.grid),pct(item.continuous)].map(md).join(' | ')+' |'),'','Grid run: `'+comparison.candidateRunId+'`; continuous reference: `'+comparison.referenceRunId+'`.'];
}
function renderPrecisionHtml(comparison){
  if(!comparison?.available)return '';
  return '<h2 id="precision-comparison">Precision grid versus continuous palette</h2><p><strong>Interpolated color score · global indexed ranking.</strong> '+esc(precisionDescription(comparison))+'</p><p>'+esc(precisionDiagnosticText(comparison.diagnostics))+'</p>'+table(['Case','Interpolated grid','Continuous palette'],comparison.cases.map(item=>'<tr><th>'+esc(item.id)+'</th><td>'+pct(item.grid)+'</td><td>'+pct(item.continuous)+'</td></tr>').join(''))+'<p>Grid run: <code>'+esc(comparison.candidateRunId)+'</code>; continuous reference: <code>'+esc(comparison.referenceRunId)+'</code>.</p>';
}
function scaleProvenance(run){
  return {engine:run.engine,version:run.version,table:run.table,topology:run.topology,configuration:run.configuration,sourceSnapshot:run.sourceSnapshot,sourceSnapshotHash:run.sourceSnapshotHash};
}
function resourceEvidence(profile){
  return {engine:profile.engine,index:profile.index,table:profile.table,backendVersion:profile.backendVersion,documents:profile.count,concurrency:profile.concurrency,requests:profile.requests,elapsedMs:profile.elapsedMs,maxThreadsPerRequest:profile.maxThreadsPerRequest,percentilePolicy:profile.percentilePolicy,backendCpuMs:profile.cpuMs,serviceCpuMs:profile.serviceCpuMs,peakObservedHeapBytes:profile.peakObservedHeapBytes,peakObservedServiceRssBytes:profile.peakObservedServiceRssBytes,observedServerRssBytes:profile.observedServerRssBytes,observedServiceRssBytes:profile.observedServiceRssBytes,limitations:profile.resourceLimitations,artifact:profile.artifact};
}
function renderMarkdown(summary){
  const lines=['# Color-query findings','',`Generated ${summary.generatedAt}. ${summary.validDefaultMethods}/${summary.registryCount} registered methods have valid default feedback results on ${summary.corpus.count} assets.`,
    '',...summary.caveats.map(text=>'- '+text),'','## Development accuracy and small-corpus speed','',`The same-case column uses all ${summary.baseline?.supportedCases??20} cases supported by HSV cosine. A partial intersection is not substituted. Agreement is query-macro pairwise agreement, not a relevance grade.`,
    '','| Method / engine / family | Retrieval | Supported | Agreement | Without uncertain pairs | Same cases vs HSV | Judged pair coverage in top20 | Small p95 | Report |','| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | --- |'];
  for(const row of summary.methods){const r=row.record;lines.push('| '+[`${row.label} / ${engineName(row.engine)} / ${row.family}`,row.objectiveApproximation?'Interpolated color score · global indexed ranking':row.retrieval,r?`${r.coverage.ok}/${r.coverage.total}`:'Not tested',r?pct(r.accuracy.queryMacroAgreement):'—',r?pct(r.withoutUncertain?.queryMacroAgreement):'—',compareText(row.comparison),r?pct(r.top20PairCoverage):'—',r?ms(r.performance.p95Ms):'—',r?`[${r.runId}](${r.reportUrl})`:'—'].map(md).join(' | ')+' |');}
  lines.push(...precisionMarkdown(summary.precisionComparison));
  lines.push('','## Million-document status','','No result is inferred from a different method, smaller corpus, or concurrency.','', '| Method | Million-document evidence | Largest tested corpus |','| --- | --- | ---: |');
  for(const row of summary.methods)lines.push('| '+[row.label,millionText(row.million),row.largestTestedCount??'Not yet tested'].map(md).join(' | ')+' |');
  lines.push('','## Scale profiles','', '| Method | Documents | Concurrency | p95 | Maximum | Errors | Timed ≥1s | Warmup maximum | Warmup errors / ≥1s | Strict result |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for(const row of summary.methods)for(const profile of row.scaleProfiles)lines.push('| '+[row.label,profile.count,...profileCells(profile)].map(md).join(' | ')+' |');
  lines.push('','## Scheduled arrival load','','Arrival-to-result latency includes dispatch delay. All outcomes, including failures and rejections, contribute to percentiles; original closed-loop baseline percentiles include successful requests only. Rejections are failures. These rate profiles remain separate from closed-loop concurrency measurements; query subsets and duration are retained.','', '| Method | Documents | Requests/sec | Seconds | Requests | p95 | Maximum | Errors / rejected | Timed ≥1s | Warmup errors / ≥1s | Strict result | Query subset |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |');
  for(const profile of summary.arrivalProfiles)lines.push('| '+arrivalCells(profile).map(md).join(' | ')+' |');
  if(!summary.arrivalProfiles.length)lines.push('','No arrival-load results saved yet.');
  for(const run of summary.arrivalRuns)lines.push('','Artifact: `'+run.filename+'`. Source snapshot: `'+(run.sourceSnapshot??'not recorded')+'`; '+(run.finishedAt?'finished '+run.finishedAt:'in progress / no completion marker')+'.');
  lines.push('','## Parameter sensitivity','','These configurations reuse the development judgments. They are kept separate from default methods and do not provide held-out validation.','', '| Candidate | Parameters | Supported | Agreement | Without uncertain pairs | p95 | Report |','| --- | --- | ---: | ---: | ---: | ---: | --- |');
  for(const r of summary.sensitivities)lines.push('| '+[r.candidateId,JSON.stringify(r.configuration.parameters),`${r.coverage.ok}/${r.coverage.total}`,pct(r.accuracy.queryMacroAgreement),pct(r.withoutUncertain?.queryMacroAgreement),ms(r.performance.p95Ms),`[${r.runId}](${r.reportUrl})`].map(md).join(' | ')+' |');
  lines.push('','## Provenance','');
  for(const row of summary.methods)if(row.record){const r=row.record;lines.push(`### ${row.label}`,'',`Run: [${r.runId}](${r.reportUrl}). Candidate: ${r.candidateId}.`,'','```json',JSON.stringify({configuration:r.configuration,workload:r.workload,execution:r.execution,datasetHash:r.datasetHash,corpusHash:r.corpusHash,sourceHashes:r.sourceHashes,descriptorHashes:r.descriptorHashes},null,2),'```','');}
  lines.push('### Scale artifacts','');for(const scale of summary.scaleRuns)lines.push('- `'+scale.filename+'`: '+(scale.finishedAt?'Finished '+scale.finishedAt:'In progress / no completion marker')+'. '+scale.provenanceLimitation,'','```json',JSON.stringify(scaleProvenance(scale),null,2),'```','');
  lines.push('','### Excluded attempts','');for(const rejected of summary.excludedAttempts)lines.push(`- ${rejected.methodId}, [${rejected.runId}](${rejected.reportUrl}): ${rejected.reason}`);
  lines.push('','### All saved feedback reports','');for(const run of summary.feedbackRuns)lines.push(`- [${run.label??run.id}](${run.reportUrl}): ${run.id}; ${run.corpusSize} assets; ${run.candidates} configurations.`);
  if(summary.warnings.length)lines.push('','### Read warnings','',...summary.warnings.map(warning=>'- '+warning));
  return lines.join('\n')+'\n';
}
function arrivalCells(profile){return [profile.method,profile.count,profile.rate,profile.durationMs/1000,profile.requests,ms(profile.p95Ms),ms(profile.maxMs),profile.errors+' / '+profile.clientRejected,profile.overOneSecond,(profile.warmupErrors??'?')+' / '+(profile.warmupOverOneSecond??'?'),statusLabel(profile),profile.queryIds.join(', ')];}
function renderArrivalHtml(summary){
  const headers=['Method','Documents','Requests/sec','Seconds','Requests','p95','Maximum','Errors / rejected','Timed ≥1s','Warmup errors / ≥1s','Strict result','Query subset'];
  return '<h2 id="arrival">Scheduled arrival load</h2><p>Arrival-to-result latency includes client dispatch delay. All outcomes, including failures and rejections, contribute to percentiles; original closed-loop baseline percentiles include successful requests only. Rejected arrivals count as failures. These profiles are separate from closed-loop concurrency measurements; rate, duration and query subset all matter.</p>'+(summary.arrivalProfiles.length?table(headers,summary.arrivalProfiles.map(profile=>'<tr>'+arrivalCells(profile).map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')):'<p>No arrival-load results saved yet.</p>')+'<ul>'+summary.arrivalRuns.map(run=>'<li><code>'+esc(run.filename)+'</code> · '+esc(run.finishedAt?'Finished '+run.finishedAt:'In progress / no completion marker')+'<br>Source snapshot: <code>'+esc(run.sourceSnapshot??'not recorded')+'</code></li>').join('')+'</ul>';
}
function renderHtml(summary){
  const headers=['Method / engine / family','Retrieval','Supported cases','Agreement','Without uncertain pairs','Same cases vs HSV','Judged-pair coverage in top20','Small-corpus p95','Saved report'];
  const methodRows=summary.methods.map(row=>{const r=row.record;return '<tr><th scope="row"><a href="#'+esc(row.id)+'">'+esc(row.label)+'</a><small>'+esc(engineName(row.engine))+' · '+esc(row.family)+' · '+esc(row.representation)+'</small></th><td>'+esc(row.objectiveApproximation?'Interpolated color score · global indexed ranking':row.retrieval==='approximate'?'ANN':'Exact stored objective')+'</td><td>'+(r?esc(r.coverage.ok+'/'+r.coverage.total):'Not tested')+'</td><td>'+pct(r?.accuracy?.queryMacroAgreement)+'</td><td>'+pct(r?.withoutUncertain?.queryMacroAgreement)+'</td><td title="'+esc(row.comparison.reason??'Identical complete query set and dataset/corpus fingerprints')+'">'+esc(compareText(row.comparison))+'</td><td>'+pct(r?.top20PairCoverage)+'</td><td>'+ms(r?.performance?.p95Ms)+'</td><td>'+(r?'<a href="'+esc(r.reportUrl)+'">'+esc(r.runLabel)+'</a>':'—')+'</td></tr>';}).join('');
  const millionRows=summary.methods.map(row=>'<tr><th scope="row">'+esc(row.label)+'</th><td>'+(row.million.length?row.million.map(profile=>'<div class="status '+profile.status+'"><strong>'+esc(concurrencyText(profile))+' · '+esc(statusLabel(profile))+'</strong><br>'+esc(ms(profile.p95Ms)+' p95; '+ms(profile.maxMs)+' max; '+profile.errors+' errors; '+profile.overOneSecond+' timed ≥1s; '+(profile.warmupErrors??'?')+' warmup errors; '+(profile.warmupOverOneSecond??'?')+' warmup ≥1s')+'</div>').join(''):'<span class="pending">Not yet tested</span>')+'</td><td>'+esc(row.largestTestedCount?.toLocaleString('en-US')??'Not yet tested')+'</td></tr>').join('');
  const sensitivityRows=summary.sensitivities.map(r=>'<tr><th scope="row">'+esc(r.candidateId)+'</th><td><code>'+esc(JSON.stringify(r.configuration.parameters))+'</code></td><td>'+esc(r.coverage.ok+'/'+r.coverage.total)+'</td><td>'+pct(r.accuracy.queryMacroAgreement)+'</td><td>'+pct(r.withoutUncertain?.queryMacroAgreement)+'</td><td>'+ms(r.performance.p95Ms)+'</td><td><a href="'+esc(r.reportUrl)+'">'+esc(r.runLabel)+'</a></td></tr>').join('');
  const details=summary.methods.map(row=>{const r=row.record;return '<details id="'+esc(row.id)+'"><summary>'+esc(row.label)+'</summary>'+(r?'<p>Saved candidate <code>'+esc(r.candidateId)+'</code> in <a href="'+esc(r.reportUrl)+'">'+esc(r.runId)+'</a>.</p><p>Pair coverage: '+pct(r.accuracy.pairCoverage)+'; completely assessed cases: '+esc(r.accuracy.completeCases)+'; eligibility violations: '+esc(r.eligibilityViolations??0)+'.</p><ul>'+r.limitations.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul><h3>Recorded configuration and source evidence</h3><pre>'+esc(JSON.stringify({configuration:r.configuration,workload:r.workload,execution:r.execution,datasetHash:r.datasetHash,corpusHash:r.corpusHash,sourceHashes:r.sourceHashes,descriptorHashes:r.descriptorHashes},null,2))+'</pre>':'<p>No valid default feedback result.</p>')+(row.scaleProfiles.length?'<h3>Scale measurements</h3>'+table(['Documents','Concurrency','p95','Maximum','Errors','Timed ≥1s','Warmup maximum','Warmup errors / ≥1s','Strict result'],row.scaleProfiles.map(profile=>'<tr>'+[profile.count.toLocaleString('en-US'),...profileCells(profile)].map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join(''))+'<details><summary>Backend and resource observations</summary><p>CPU counters are milliseconds over each measured block. Memory fields name the measured process and metric; missing values were not recorded.</p><pre>'+esc(JSON.stringify(row.scaleProfiles.map(resourceEvidence),null,2))+'</pre></details><p>Artifacts:</p><ul>'+[...new Set(row.scaleProfiles.map(profile=>profile.artifact))].map(file=>'<li><code>'+esc(file)+'</code></li>').join('')+'</ul>':'<p>Scale measurements have not yet been saved for this method.</p>')+'</details>';}).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Color-query findings</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f5f7fa;color:#182234;margin:0}main{max-width:1600px;margin:auto;padding:28px}h1,h2,h3{line-height:1.2}h1{margin-bottom:8px}a{color:#164fb5}small{display:block;color:#5c6878}.lede{max-width:1000px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.card{background:white;border:1px solid #dbe1ea;border-radius:10px;padding:15px 22px}.card strong{display:block;font-size:24px}.notice{background:#eef3ff;border-left:4px solid #315ab0;padding:12px 20px;margin:24px 0}.scroll{overflow:auto;border:1px solid #d7dfe8;border-radius:8px;margin:16px 0;background:white}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;border-bottom:1px solid #e0e6ed;padding:11px;vertical-align:top}thead th{background:#edf1f7;white-space:nowrap}tbody th{min-width:210px}td{min-width:85px}td:nth-child(6){min-width:170px}tbody tr:hover{background:#f7faff}.status{padding:8px;border-radius:6px;margin:4px 0}.pass{background:#eaf5ed}.fail{background:#fff0eb}.incomplete,.pending{color:#7a5800}.pending{background:#fff6d9;padding:4px 8px;border-radius:4px}details{background:white;border:1px solid #dbe1ea;border-radius:8px;padding:14px 18px;margin:12px 0}summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;border-radius:5px;padding:15px;font-size:12px}code{font-size:12px;overflow-wrap:anywhere}.muted{color:#586476}nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}li{margin:6px 0}@media(max-width:600px){main{padding:16px}.card{padding:10px 14px}.notice{padding:10px 14px}table{font-size:13px}th,td{padding:9px}}</style></head><body><main><a href="/">← Visual prototypes</a><h1>Color-query findings</h1><p class="lede">Saved development accuracy and service performance, kept separate. No overall winner is declared. Refresh this page to include newly saved experiments.</p><p class="muted">Generated '+esc(summary.generatedAt)+'</p><div class="cards"><div class="card"><strong>'+summary.registryCount+'</strong>Registered methods</div><div class="card"><strong>'+summary.validDefaultMethods+'</strong>Valid default feedback results</div><div class="card"><strong>'+summary.corpus.count+'</strong>Corpus assets</div><div class="card"><strong>'+summary.caseCount+'</strong>Logical judgment cases</div></div><nav><a href="#accuracy">Accuracy and small-corpus speed</a><a href="#million">Million-document status</a><a href="#sensitivity">Parameter sensitivity</a><a href="#evidence">Evidence and limitations</a></nav><div class="notice"><strong>How to read these results</strong><ul>'+summary.caveats.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul></div><h2 id="accuracy">Development accuracy and small-corpus speed</h2><p>Each assessed query contributes equally to pairwise agreement. The same-case column compares all '+esc(summary.baseline?.supportedCases??20)+' HSV-supported cases; incomplete intersections are left unavailable. Unsupported cases and unjudged images are never assigned zero relevance.</p>'+table(headers,methodRows)+'<h2 id="million">Million-document status</h2><p>PASS requires every recorded warmup and timed request to finish below one second with no errors. Missing million-document results remain untested, even when a smaller corpus was fast. C1/C4/C16 indicate concurrent clients.</p>'+table(['Method','Million-document measurements','Largest corpus tested'],millionRows)+'<h2 id="sensitivity">Parameter sensitivity</h2><p>These '+summary.sensitivities.length+' configurations reuse the development judgments and remain separate from registered defaults. Differences are exploratory sensitivity, not held-out validation.</p><details><summary>Show parameter configurations</summary>'+table(['Candidate','Parameters','Supported','Agreement','Without uncertain pairs','p95','Report'],sensitivityRows)+'</details><h2 id="evidence">Evidence and limitations</h2>'+details+'<h3>Scale artifact provenance</h3><ul>'+summary.scaleRuns.map(run=>'<li><code>'+esc(run.filename)+'</code><br>'+esc(run.finishedAt?'Finished '+run.finishedAt:'In progress / no completion marker')+'; '+run.profilesRecorded+' saved profiles.<br>'+esc(run.provenanceLimitation)+'<details><summary>'+esc(engineName(run.engine))+' backend and captured configuration</summary><pre>'+esc(JSON.stringify(scaleProvenance(run),null,2))+'</pre></details></li>').join('')+'</ul><details><summary>Excluded attempts ('+summary.excludedAttempts.length+')</summary><ul>'+summary.excludedAttempts.map(item=>'<li>'+esc(item.methodId)+' — <a href="'+esc(item.reportUrl)+'">'+esc(item.runId)+'</a>: '+esc(item.reason)+'</li>').join('')+'</ul></details>'+(summary.warnings.length?'<details open><summary>Artifact read warnings</summary><ul>'+summary.warnings.map(warning=>'<li>'+esc(warning)+'</li>').join('')+'</ul></details>':'')+'</main></body></html>';
}
function table(headers,rows){return '<div class="scroll"><table><thead><tr>'+headers.map(header=>'<th scope="col">'+esc(header)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=await renderFindings();await mkdir(STORE,{recursive:true});
  for(const [extension,contents] of [['html',output.html],['md',output.markdown],['json',JSON.stringify(output.summary,null,2)]]){const filename=path.join(STORE,'findings.'+extension);await writeFile(filename+'.tmp',contents);await rename(filename+'.tmp',filename);}
  console.log(JSON.stringify({methods:output.summary.registryCount,validDefaultMethods:output.summary.validDefaultMethods,sensitivityConfigurations:output.summary.sensitivities.length,warnings:output.summary.warnings.length,html:path.join(STORE,'findings.html'),markdown:path.join(STORE,'findings.md')},null,2));
}
