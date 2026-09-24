// Saved-file-only independent transport A/B reconciliation. No scorer/service imports.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const phases=['pit-open','seed','seed-score','global-final','pit-close'];
const count=(a,key)=>a.reduce((out,x)=>(out[x[key]]=(out[x[key]]??0)+1,out),{});
const entries=x=>Object.fromEntries(Object.entries(x).sort());
async function audit(name){
 const directory=path.join(root,name),hashes={};
 async function read(file){const b=await readFile(path.join(directory,file));hashes[file]=hash(b);return b.toString();}
 const d=JSON.parse(await read('diagnostic.json')),sources=JSON.parse(await read('source-snapshot.json'));
 const trials=(await read('trials.jsonl')).trimEnd().split('\n').map(JSON.parse),requests=(await read('requests.jsonl')).trimEnd().split('\n').map(JSON.parse),resources=(await read('resources.jsonl')).trimEnd().split('\n').map(JSON.parse);
 assert.equal(d.completed,true);assert.ok(d.finishedAt&&!d.error&&!d.recordingError);assert.equal(hash(sources),d.sourceHash);
 assert.equal(hash(await readFile(d.configuration.receipt)),d.receiptHash);
 assert.equal(d.configuration.method,'maxima');assert.equal(d.configuration.concurrency,16);assert.equal(d.configuration.durationMs,60000);
 assert.deepEqual(d.query,{mode:'vibe',targets:[{color:'#ff0000'}]});assert.equal(d.indexBefore.count,1e6);assert.deepEqual(d.indexBefore,d.indexAfter);
 assert.equal(trials.length,d.trials.completed);assert.equal(trials.length,d.trials.submitted);
 const sorted=[...trials].sort((a,b)=>a.id-b.id);sorted.forEach((t,i)=>assert.equal(t.id,i));
 assert.ok(sorted.every(t=>t.timeoutMs===1500&&Number.isFinite(t.elapsedMs)&&t.elapsedMs>=0&&t.overOneSecond===(t.elapsedMs>=1000)));
 const failed=trials.filter(t=>t.error),slow=trials.filter(t=>t.elapsedMs>=1000),strict=trials.filter(t=>t.error||t.elapsedMs>=1000);
 assert.equal(failed.length,d.trials.errors);assert.equal(slow.length,d.trials.overOneSecond);assert.equal(strict.length,d.trials.strictFailures);assert.equal(d.strictPassed,strict.length===0);
 assert.equal(hash(d.trials.hits),d.trials.hitsHash);assert.equal(d.trials.hits.length,20);
 assert.ok(trials.filter(t=>!t.error).every(t=>t.hitsHash===d.trials.hitsHash));
 const retained=trials.filter(t=>Boolean(t.error)||t.overOneSecond||t.id<32||t.id%1000===0);
 assert.ok(trials.every(t=>t.retainedStageTrace===(Boolean(t.error)||t.overOneSecond||t.id<32||t.id%1000===0)));
 assert.equal(retained.length,d.trials.tracing.retainedQueries);assert.equal(requests.length,d.trials.tracing.retainedServiceRequests);
 const groups=new Map(retained.map(t=>[t.id,[]]));
 for(const row of requests){assert.ok(groups.has(row.trialId));groups.get(row.trialId).push(row);assert.ok(Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0);assert.ok(phases.includes(row.phase));assert.equal(typeof row.success,'boolean');if(!row.success)assert.ok(row.error);}
 for(const t of retained){const rows=groups.get(t.id);rows.forEach((r,i)=>assert.equal(r.ordinal,i));if(!t.error)assert.deepEqual(rows.map(r=>r.phase),phases);assert.ok(t.executionEvidence);}
 const inferred=trials.length-retained.length;
 const counts=count(requests,'phase');for(const phase of phases)counts[phase]=(counts[phase]??0)+inferred;
 assert.deepEqual(entries(counts),entries(d.trials.phaseCounts));assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),d.trials.serviceRequests);
 const serviceFailed=requests.filter(r=>!r.success);
 assert.equal(serviceFailed.length,d.trials.serviceErrors);assert.deepEqual(entries(count(serviceFailed,'phase')),entries(d.trials.phaseErrors));
 assert.equal(d.observer.observerErrors,0);assert.deepEqual(entries(d.observer.phaseSends),entries(counts));
 assert.equal(d.observer.headerSends+d.observer.native.sends,d.trials.serviceRequests);
 assert.equal(d.observer.reusedSends+d.observer.observedSockets,d.observer.headerSends+d.observer.native.sends);
 assert.ok(d.observer.socketCloses<=d.observer.observedSockets);assert.ok(d.observer.socketErrorCloses<=d.observer.socketCloses);
 assert.deepEqual(resources[0],d.before);assert.deepEqual(resources.at(-1),d.after);assert.equal(d.httpEvidenceComplete,true);
 const nodeids=Object.keys(d.before.nodes);assert.deepEqual(Object.keys(d.after.nodes),nodeids);assert.equal(nodeids.length,1);
 const id=nodeids[0],before=d.before.nodes[id],after=d.after.nodes[id];
 const opened=after.http.total_opened-before.http.total_opened;assert.equal(opened,d.httpDeltas[id].totalOpened);
 const window=Date.parse(d.after.at)-Date.parse(d.before.at);assert.equal(window,d.httpObservationWindowMs);assert.equal(d.openedConnectionsPerSecond,opened/(window/1000));
 assert.ok(resources.every(r=>!r.error&&r.nodes?.[id]&&!r.tcp?.unavailable));
 assert.equal(before.indices.search.open_contexts,0);
 const errors=count(serviceFailed.map(r=>({code:r.error.cause?.code??r.error.code??r.error.name})),'code');
 const firstError=serviceFailed.length?serviceFailed[0]:null;
 return {name,inputHashes:hashes,sourceHash:d.sourceHash,receiptHash:d.receiptHash,configuration:d.configuration,query:d.query,parameters:d.parameters,runtime:d.runtime,index:d.indexBefore,
  completed:true,strictPassed:d.strictPassed,trials:trials.length,queryErrors:failed.length,overOneSecond:slow.length,strictFailures:strict.length,serviceRequests:d.trials.serviceRequests,serviceErrors:serviceFailed.length,errorCodes:errors,phaseErrors:d.trials.phaseErrors,elapsedMs:d.trials.elapsedMs,stopReason:d.trials.stopReason,hitsHash:d.trials.hitsHash,
  retainedStageQueries:retained.length,retainedServiceRows:requests.length,unretainedSuccessfulQueries:inferred,
  newHttpConnections:opened,httpObservationWindowMs:window,newConnectionsPerSecond:d.openedConnectionsPerSecond,newConnectionsPerQuery:opened/trials.length,observedSockets:d.observer.observedSockets,socketCloses:d.observer.socketCloses,
  nativeDeleteSends:d.observer.native.sends,nativeDeleteResponses:d.observer.native.responseHeaders,openContextsBefore:before.indices.search.open_contexts,openContextsAfter:after.indices.search.open_contexts,
  fdBefore:before.process.open_file_descriptors,fdAfter:after.process.open_file_descriptors,fdLimit:after.process.max_file_descriptors,
  timeWaitBefore:d.before.tcp.states['TIME-WAIT']??0,timeWaitAfter:d.after.tcp.states['TIME-WAIT']??0,resourceSamples:resources.length,
  firstRecordedServiceError:firstError?{at:firstError.at,phase:firstError.phase,trialId:firstError.trialId,error:firstError.error}:null};
}
const baseline=await audit('transport-maxima-fetch-v1'),pooled=await audit('transport-maxima-pooled-v1');
for(const key of ['sourceHash','receiptHash','query','parameters','runtime','index','hitsHash'])assert.deepEqual(baseline[key],pooled[key]);
for(const key of ['method','concurrency','durationMs','maximumRequests','stopErrors','base','index','sampleIntervalMs'])assert.deepEqual(baseline.configuration[key],pooled.configuration[key]);
assert.equal(baseline.configuration.transport,'fetch');assert.equal(pooled.configuration.transport,'pooled-delete');
assert.equal(baseline.strictPassed,false);assert.equal(pooled.strictPassed,true);assert.equal(pooled.nativeDeleteSends,pooled.trials);assert.equal(pooled.nativeDeleteResponses,pooled.trials);assert.equal(pooled.openContextsAfter,0);assert.equal(pooled.stopReason,'duration');
const hostFile=await readFile(path.join(root,'transport-host-before-v1.json')),host=JSON.parse(hostFile),range=host.sysctls['net.ipv4.ip_local_port_range'].split(/\s+/).map(Number);
const cooldownFile=await readFile(path.join(root,'transport-cooldown-after-fetch-v1.json')),cooldown=JSON.parse(cooldownFile);
assert.equal(cooldown.ready,true);assert.equal(cooldown.rows.at(-1).openContexts,0);assert.ok(cooldown.rows.at(-1).endpointTimeWait<100);
const report={schemaVersion:1,experiment:'favorite-transport-ab-independent-audit',at:new Date().toISOString(),fileOnly:true,verified:true,sourceSha256:hash(await readFile(fileURLToPath(import.meta.url))),baseline,pooled,
 hostEvidence:{file:'transport-host-before-v1.json',sha256:hash(hostFile),ephemeralPortRange:range,rangeCardinality:range[1]-range[0]+1,mutations:host.mutations},cooldownEvidence:{file:'transport-cooldown-after-fetch-v1.json',sha256:hash(cooldownFile),final:cooldown.rows.at(-1)},
 conclusion:'Pooled cleanup preserves every successful ranking hash while avoiding the default DELETE transport connection churn and the reproduced reset failures in this controlled comparison.',
 limitations:['Instrumented fixed-query diagnosis on one host; not a concurrency or arrival capacity qualification.','Baseline stops on its error budget after38.9s; pooled completes60s, so latency/throughput are not unbiased head-to-head performance estimates.','All compact queries and all failures are audited; only sampled successful stage traces exist. Unretained-success stage counts are reconciled with whole-run observer counters and the frozen five-stage executor.','The close-to-ephemeral-range failure onset supports port-pressure inference but does not identify the exact failing host/Docker namespace allocation without kernel/proxy error evidence.','Observer socketErrorCloses counts intentional Undici reset closures too; actual service failures are counted separately.','Existing7,491-error screen remains failed; this diagnostic does not replace it.']};
const output=path.join(root,'transport-ab-independent-audit-v1.json');await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,verified:true,baseline:{queries:baseline.trials,queryErrors:baseline.queryErrors,serviceErrors:baseline.serviceErrors,newConnections:baseline.newHttpConnections},pooled:{queries:pooled.trials,queryErrors:pooled.queryErrors,serviceErrors:pooled.serviceErrors,newConnections:pooled.newHttpConnections},sameHitsHash:baseline.hitsHash===pooled.hitsHash}));
