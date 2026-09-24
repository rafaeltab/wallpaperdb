import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const full=process.argv.includes('--full');
const output=process.argv[process.argv.indexOf('--output')+1];
assert.ok(process.argv.includes('--output')&&output);
const repository='/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7';
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const startedAt=new Date().toISOString(), files={},checks=[];
async function read(name){const bytes=await readFile(path.join(root,name));files[name]={bytes:bytes.length,sha256:hash(bytes)};return JSON.parse(bytes);}
const result={schemaVersion:1,fileOnly:true,startedAt,scope:full?'receipt-source-and-all-acknowledgement-records':'lightweight-receipt-and-source-bindings',files,checks,errors:[],complete:false};
try{
 const receipt=await read('points-full-1m-v1/index.json');
 const audit=await read('points-full-1m-v1-audit/audit.json');
 const status=await read('full-million-build-v1/status.json');
 const pipeline=await read('full-million-build-v1/plan.json');
 assert.equal(status.planSha256,files['full-million-build-v1/plan.json'].sha256);
 assert.ok(status.finishedAt);assert.deepEqual(status.phases.map(x=>[x.id,x.exitCode]),[['points-full-1m-index',0],['points-full-1m-audit',0]]);
 for(const x of [receipt,audit,status]){assert.ok(x.finishedAt);assert.ok(!x.error&&!x.interruptedAt);}
 assert.equal(receipt.indexed,1000000);assert.equal(receipt.generated,1000000);assert.equal(receipt.count,1000000);
 const config=receipt.configuration;
 assert.equal(config.scope,'full');assert.equal(config.mode,'scale');assert.equal(config.numericPoints,true);assert.equal(config.source,false);assert.equal(config.presets,'favorite');assert.deepEqual(config.encodings,['numeric']);assert.equal(config.bulkConcurrency,4);
 assert.equal(receipt.base,'http://127.0.0.1:19217');assert.equal(receipt.utilities,6138);assert.equal(receipt.encodingValueCounts.numeric,6138000000);
 assert.equal(hash(receipt.identity),receipt.identityHash);
 const snapshot=await read('points-full-1m-v1/source-snapshot.json');assert.equal(hash(snapshot),receipt.sourceSnapshotHash);
 for(const [name,text] of Object.entries(snapshot)){assert.equal(hash(text),receipt.identity.sourceHashes[name]);assert.equal(await readFile(path.join(repository,'experiments/color-search-benchmark',name),'utf8'),text);}
 const mapping=receipt.after.mapping[receipt.index].mappings, settings=receipt.after.settings[receipt.index].settings.index;
 assert.equal(settings.uuid,receipt.uuid);assert.equal(settings.number_of_shards,'1');assert.equal(settings.number_of_replicas,'0');assert.equal(mapping._source.enabled,false);
 for(const key of ['identityHash','planHash'])assert.equal(mapping._meta[key],receipt[key]);
 assert.equal(mapping._meta.count,1000000);assert.equal(mapping._meta.numericPoints,true);assert.equal(Object.keys(mapping.properties.utilities.properties).length,6138);
 for(const field of Object.values(mapping.properties.utilities.properties)){assert.equal(field.type,'float');assert.notEqual(field.index,false);assert.notEqual(field.doc_values,false);}
 const stats=receipt.after.stats.indices[receipt.index];assert.equal(stats.uuid,receipt.uuid);assert.equal(stats.primaries.docs.count,1000000);assert.equal(stats.primaries.docs.deleted,0);assert.equal(stats.primaries.merges.current,0);assert.equal(stats.primaries.translog.uncommitted_operations,0);assert.equal(receipt.settling.settled,true);
 for(const key of ['index','uuid','count','identityHash','planHash'])assert.equal(audit[key],receipt[key]);
 assert.equal(audit.receiptHash,files['points-full-1m-v1/index.json'].sha256);assert.equal(audit.parentSourceSnapshotHash,receipt.sourceSnapshotHash);assert.equal(audit.beforeFingerprintHash,audit.afterFingerprintHash);assert.equal(audit.verified,true);assert.equal(audit.sampleAudit.verified,true);assert.deepEqual(audit.sampleAudit.ordinals,[0,499999,999999]);assert.equal(audit.sampleAudit.utilitiesPerSample,6138);assert.equal(audit.sampleAudit.valuesCompared,18414);
 const scheduler=receipt.bulkScheduler;
 assert.equal(scheduler.acknowledgedDocuments,1000000);assert.equal(scheduler.acknowledgedBatches,receipt.bulkCount);assert.equal(scheduler.submittedBatches,receipt.bulkCount);assert.equal(scheduler.acknowledgedBytes,receipt.bulkBytes);assert.equal(scheduler.closed,true);assert.equal(scheduler.inFlight,0);assert.equal(scheduler.peakInFlight,4);
 for(const key of ['failedBatches','failedEvidenceBatches','failedServiceBatches','failedExecutorBatches','failedAcknowledgedBatches','failureCount'])assert.equal(scheduler[key],0);
 for(const key of ['bulkRetries','bulkAdmissionRejections','bulkRequestErrors','bulkAcknowledgementFailures','bulkScheduledRetryWaitMs'])assert.equal(receipt[key],0);
 assert.equal(receipt.bulkCount,47620);assert.equal(receipt.bulkAttempts,47620);assert.equal(receipt.bulkAttemptBytes,receipt.bulkBytes);
 checks.push('Completed pipeline phases, exact million count and unchanged 29-source archive/current-file binding','Identity, mapping, 6138 numeric-point/docvalue fields and index UUID agree','Stored-value audit is finished and hash-bound: 18414 values on three sampled ordinals','Scheduler and receipt counters reconcile with no failures/retries; full per-event reconciliation is separate');
 result.index={index:receipt.index,uuid:receipt.uuid,count:receipt.count,utilities:receipt.utilities,sourceCount:receipt.source.sourceCount,scope:config.scope,presets:config.presets,primaryShards:1,replicas:0};
 result.cost={indexingMs:receipt.indexingMs,elapsedMs:receipt.elapsedMs,indexingStartedAt:receipt.indexingStartedAt,indexingFinishedAt:receipt.indexingFinishedAt,finishedAt:receipt.finishedAt,primaryStoreBytes:stats.primaries.store.size_in_bytes,segments:stats.primaries.segments.count,bulkCount:receipt.bulkCount,bulkBytes:receipt.bulkBytes,serializedDocumentBytes:receipt.serializedDocumentBytes,bulkRetries:receipt.bulkRetries,documentsPerIndexingSecond:receipt.count/(receipt.indexingMs/1000),peakInFlightBytes:scheduler.peakInFlightBytes,merges:stats.primaries.merges};
 result.storedValueAudit={verified:true,valuesCompared:audit.sampleAudit.valuesCompared,ordinals:audit.sampleAudit.ordinals,notAllDocuments:true};
 if(full){
  const plan=await read('points-full-1m-v1/plan.json');assert.equal(hash(plan),receipt.planHash);
  const requested=await read('points-full-1m-v1/mapping-request.json');
  const baseMapping=structuredClone(requested);delete baseMapping.mappings._meta;assert.equal(hash(baseMapping),receipt.identity.mappingHash);
  const normalize=value=>{
   if(Array.isArray(value))return value.map(normalize);
   if(!value||typeof value!=='object')return value;
   const out={};for(const [key,child]of Object.entries(value))out[key]=normalize(child);
   if(out.type==='object'&&out.properties)delete out.type;
   if(out.type==='float'){if(out.index===true)delete out.index;if(out.doc_values===true)delete out.doc_values;}
   return out;
  };
  assert.deepEqual(normalize(mapping),normalize(requested.mappings));
  checks.push('Full archived plan and requested mapping hashes recomputed; actual mapping differs only by known float/object serialization defaults');
  const batches=new Map(), attempts=new Map(), scheduled=new Map();
  const stream=async(name,fn)=>{const p=path.join(root,'points-full-1m-v1',name),digest=createHash('sha256');const input=createReadStream(p);input.on('data',x=>digest.update(x));for await(const line of createInterface({input,crlfDelay:Infinity}))if(line)fn(JSON.parse(line));files['points-full-1m-v1/'+name]={sha256:digest.digest('hex')};};
  await stream('batches.jsonl',x=>{assert.ok(!batches.has(x.ordinal));batches.set(x.ordinal,x);});
  await stream('retries.jsonl',x=>{assert.equal(x.index,receipt.index);assert.equal(x.attempt,1);assert.ok(['started','accepted'].includes(x.phase));const key=x.batchOrdinal;let pair=attempts.get(key);if(!pair)attempts.set(key,pair={});assert.ok(!pair[x.phase]);pair[x.phase]=x;});
  await stream('scheduler.jsonl',x=>{assert.ok(['submitted','accepted'].includes(x.phase));let pair=scheduled.get(x.ordinal);if(!pair)scheduled.set(x.ordinal,pair={});assert.ok(!pair[x.phase]);pair[x.phase]=x;});
  assert.equal(batches.size,47620);assert.equal(attempts.size,47620);assert.equal(scheduled.size,47620);
  const ids=createHash('sha256');let ordinal=0,bytes=0;
  for(let i=1;i<=47620;i++){
   const batch=batches.get(i),a=attempts.get(i),s=scheduled.get(i);assert.ok(batch&&a?.started&&a.accepted&&s?.submitted&&s.accepted);
   assert.equal(a.started.stage,'request');assert.equal(a.accepted.stage,'acknowledgements');
   assert.deepEqual(a.started.ids,a.accepted.ids);assert.equal(a.accepted.acknowledged,batch.documents);assert.equal(a.started.ids.length,batch.documents);assert.equal(batch.firstId,a.started.ids[0]);assert.equal(batch.lastId,a.started.ids.at(-1));
   for(const id of a.started.ids){assert.equal(id,'favorite-synthetic-'+String(ordinal++).padStart(9,'0'));ids.update(id+'\n');}
   for(const x of [a.started,a.accepted]){assert.equal(x.bytes,batch.bytes);assert.equal(x.bodyHash,batch.bodyHash);}
   assert.equal(a.accepted.responseHash,batch.responseHash);
   for(const x of [s.submitted,s.accepted,s.accepted.acknowledgement])for(const key of ['ordinal','documents','bytes','firstId','lastId'])assert.equal(x[key],batch[key]);
   assert.equal(s.accepted.acknowledgement.responseHash,batch.responseHash);assert.equal(s.accepted.acknowledgement.bodyHash,batch.bodyHash);
   assert.equal(batch.retryEvidence.attempts,1);assert.equal(batch.retryEvidence.scheduledWaitMs,0);assert.equal(batch.oversizedSingleDocument,false);assert.ok(batch.bytes<=config.bulkBytes);bytes+=batch.bytes;
  }
  assert.equal(ordinal,1000000);assert.equal(bytes,receipt.bulkBytes);assert.equal(ids.digest('hex'),receipt.orderedIdsHash);
  result.acknowledgementReconciliation={verified:true,batches:batches.size,uniqueOrderedIds:ordinal,bytes,retries:0};
  checks.push('All started/accepted/scheduler/batch records agree; exact consecutive million unique IDs reproduce receipt ordered-ID hash');
 }else result.acknowledgementReconciliation={verified:false,pending:true,reason:'Deferred full log reconciliation to avoid host contention during active capacity measurements.'};
 result.verified=true;result.complete=full;
}catch(error){result.verified=false;result.errors.push(String(error.stack??error));}
result.limitations=['File-only review; no new OpenSearch requests.','Accepted bulk records contain response hashes and counters after the frozen runner validated every create status201; complete raw per-item HTTP responses were not retained, so this is reconciliation of acknowledgement evidence rather than reparsing every HTTP response.','This review does not regenerate a million utility documents; the compiled document digest is retained rather than independently reconstructed.','All 18414 sampled values passed the existing service audit; values on the other999997 documents are not independently read back.','Build/storage completion does not establish query latency or concurrent-user capacity.'];
result.finishedAt=new Date().toISOString();result.auditCodeSha256=hash(await readFile(fileURLToPath(import.meta.url)));
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,verified:result.verified,complete:result.complete,cost:result.cost,errors:result.errors}));process.exitCode=result.verified?0:1;
