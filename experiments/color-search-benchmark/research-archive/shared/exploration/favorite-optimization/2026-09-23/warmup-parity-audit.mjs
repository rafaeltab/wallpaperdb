// Independent file-only comparison. No scorer, query builder, search client or
// benchmark imports. Raw warmup hit lists are read without executing any query.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const clone = value => JSON.parse(JSON.stringify(value));
const baseline = 'favorite-utility-numeric-docvalues';
export const METHODS = [baseline, 'favorite-utility-sorted-docvalues', 'favorite-utility-bounded', 'favorite-utility-maxima-bounded'];
const BINDINGS = {
  [baseline]: ['./favorite-docvalue-fetch.mjs','buildFavoriteDocvalueQuery','searchFavoriteDocvalueUtilities'],
  'favorite-utility-sorted-docvalues': ['./favorite-docvalue-fetch.mjs','buildFavoriteDocvalueQuery','searchFavoriteDocvalueUtilities'],
  'favorite-utility-bounded': ['./favorite-bounded-utilities.mjs','buildFavoriteBoundedQuery','executeFavoriteBoundedUtilitySearch'],
  'favorite-utility-maxima-bounded': ['./favorite-maxima-bounded-utilities.mjs','buildFavoriteMaximaBoundedQuery','executeFavoriteMaximaBoundedUtilitySearch'],
};
const SHAPES = [
  { id:'picked-one-vibe', query:{mode:'vibe',targets:[{color:'#ff0000'}]} },
  { id:'picked-one-green40', query:{mode:'proportions',targets:[{color:'#22cc44',percent:40}]} },
  { id:'picked-two-portions', query:{mode:'proportions',targets:[{color:'#ff2200',percent:50},{color:'#22cc44',percent:50}]} },
  { id:'picked-five-portions', query:{mode:'proportions',targets:['#ff2200','#ff8800','#ffff00','#22cc44','#2266ff'].map(color=>({color,percent:20}))} },
];
export function configuration(args) {
  const values = {count:'1000000',scope:'full',methods:METHODS.join(','),selectivities:'all,partition10,tag1'};
  for(let i=0;i<args.length;i++) { const key=args[i],value=args[++i]; assert.ok(['--directory','--receipt','--audit','--output','--count','--scope','--methods','--selectivities'].includes(key)&&value&&!value.startsWith('--')); values[key.slice(2)]=value; }
  for(const key of ['directory','receipt','audit','output']) assert.ok(values[key], 'Provide --'+key);
  const methods=values.methods.split(','),selectivities=values.selectivities.split(','),count=Number(values.count);
  assert.ok(methods.includes(baseline)&&methods.length>=2&&new Set(methods).size===methods.length&&methods.every(m=>METHODS.includes(m)));
  assert.ok(selectivities.length&&new Set(selectivities).size===selectivities.length&&selectivities.every(s=>['all','partition10','tag1'].includes(s)));
  assert.ok([100000,1000000].includes(count)&&['full','projection'].includes(values.scope));
  return {...values,count,methods,selectivities,...Object.fromEntries(['directory','receipt','audit','output'].map(k=>[k,path.resolve(values[k])]))};
}
const expectedFilter = selectivity => selectivity==='all' ? undefined : selectivity==='partition10' ? {range:{partition:{lt:10}}} : {term:{tags:'synthetic-one-percent'}};
const metadataFilter = selectivity => selectivity==='all' ? [{match_all:{}}] : [{bool:{filter:[expectedFilter(selectivity)],must_not:[]}}];
export function verifyHitList(row, {count,selectivity,limit=20}) {
  if(row?.error) return {available:false,error:row.error};
  if(!row || !Array.isArray(row.hits)) return {available:false,error:'Missing complete warmup hit list'};
  const eligible=selectivity==='all'?count:selectivity==='partition10'?Math.floor(count/100)*10+Math.min(10,count%100):Math.floor(count/100)+Number(count%100>1);
  assert.equal(row.hits.length,Math.min(limit,eligible));assert.equal(row.hitCount,row.hits.length);assert.equal(row.hitsHash,hash(row.hits));
  const ids=new Set();let previous;
  for(const hit of row.hits) {
    assert.ok(typeof hit.id==='string'&&!ids.has(hit.id)&&Number.isFinite(hit.score)&&hit.score>=0);ids.add(hit.id);
    assert.match(hit.id,/^favorite-synthetic-\d{9}$/);const ordinal=Number(hit.id.slice(-9));assert.ok(ordinal<count);
    if(selectivity==='partition10')assert.ok(ordinal%100<10);if(selectivity==='tag1')assert.equal(ordinal%100,1);
    if(previous){assert.ok(Math.fround(previous.score)>=Math.fround(hit.score));if(Math.fround(previous.score)===Math.fround(hit.score))assert.ok(previous.id<hit.id);}
    previous=hit;
  }
  return {available:true,count:row.hits.length,strictPerformanceFailure:!Number.isFinite(row.elapsedMs)||row.elapsedMs<0||row.elapsedMs>=1000};
}
export function compareWarmups(reference, candidate, {method,targets,count,selectivity}) {
  const a=verifyHitList(reference,{count,selectivity}),b=verifyHitList(candidate,{count,selectivity});
  if(!a.available||!b.available)return {status:'unavailable',referenceError:a.error??null,candidateError:b.error??null};
  const identicalIds=same(reference.hits.map(h=>h.id),candidate.hits.map(h=>h.id));
  const pairs=identicalIds?reference.hits.map((h,i)=>[h.score,candidate.hits[i].score]):[];
  const float32ScoresIdentical=identicalIds&&pairs.every(([x,y])=>Object.is(Math.fround(x),Math.fround(y)));
  const rawScoresIdentical=identicalIds&&pairs.every(([x,y])=>Object.is(x,y)),sortTransport=method==='favorite-utility-sorted-docvalues'&&targets===1;
  return {status:identicalIds&&float32ScoresIdentical&&(rawScoresIdentical||sortTransport)?'match':'mismatch',count:a.count,
    identicalIds,float32ScoresIdentical,rawScoresIdentical,sortTransportAllowed:sortTransport,
    maximumRawScoreDelta:identicalIds?Math.max(0,...pairs.map(([x,y])=>Math.abs(x-y))):null,
    referenceStrictPerformanceFailure:a.strictPerformanceFailure,candidateStrictPerformanceFailure:b.strictPerformanceFailure,
    ...(identicalIds?{}:{referenceIds:reference.hits.map(h=>h.id),candidateIds:candidate.hits.map(h=>h.id)})};
}
function verifyCandidate(candidate,method) {
  assert.equal(candidate.method,method);const [module,builder,executor]=BINDINGS[method];
  assert.deepEqual(candidate.builder,{module,export:builder});assert.deepEqual(candidate.executor,{module,export:executor});
}
export function verifyQueryBody(body,{method,targets,selectivity,mapping}) {
  const keys=['size','_source','track_total_hits','timeout','query','sort'];
  if(method.includes('docvalues'))keys.push('stored_fields','docvalue_fields');
  if(method==='favorite-utility-sorted-docvalues'&&targets===1)keys.push('track_scores');
  assert.deepEqual(Object.keys(body).sort(),keys.sort());
  assert.equal(body.size,20);assert.equal(body._source,false);assert.equal(body.track_total_hits,false);assert.equal(body.timeout,'950ms');
  assert.deepEqual(Object.keys(body.query),['bool']);assert.deepEqual(Object.keys(body.query.bool).sort(),['filter','minimum_should_match','must','should']);
  assert.deepEqual(body.query.bool.filter,metadataFilter(selectivity));assert.equal(body.query.bool.minimum_should_match,0);
  assert.deepEqual(body.query.bool.must,[{constant_score:{filter:{match_all:{}},boost:0}}]);
  assert.equal(body.query.bool.should.length,targets);
  for(const term of body.query.bool.should) {
    const fs=term.function_score,factor=fs?.field_value_factor;assert.equal(Object.keys(term).length,1);
    assert.deepEqual(Object.keys(fs).sort(),['boost_mode','field_value_factor','query']);assert.deepEqual(Object.keys(factor).sort(),['factor','field','missing','modifier']);
    assert.deepEqual(fs.query,{match_all:{}});assert.equal(fs.boost_mode,'replace');assert.equal(factor.factor,1/targets);assert.equal(factor.modifier,'none');assert.equal(factor.missing,0);
    assert.match(factor.field,/^utilities\.[a-z0-9_]+$/);const field=mapping.properties.utilities.properties[factor.field.slice(10)];
    assert.equal(field?.type,'float');assert.notEqual(field.index,false);assert.notEqual(field.doc_values,false);
  }
  const native=clone(body);delete native.stored_fields;delete native.docvalue_fields;
  if(method.includes('docvalues')){assert.equal(body.stored_fields,'_none_');assert.deepEqual(body.docvalue_fields,['id']);}
  if(method==='favorite-utility-sorted-docvalues'&&targets===1) {
    assert.equal(body.track_scores,false);assert.deepEqual(body.sort,[{[body.query.bool.should[0].function_score.field_value_factor.field]:{order:'desc',missing:0}},{id:'asc'}]);
    delete native.track_scores;native.sort=[{_score:'desc'},{id:'asc'}];
  } else assert.deepEqual(body.sort,[{_score:'desc'},{id:'asc'}]);
  return native;
}
export async function auditWarmupParity(config) {
  const files={},errors=[],warnings=[],rows=[],captured=new Map();
  const read=async(key,filename)=>{const bytes=await readFile(filename);files[key]={path:filename,sha256:hash(bytes)};return JSON.parse(bytes);};
  const result={schemaVersion:1,experiment:'favorite-warmup-cross-method-parity',fileOnly:true,auditedAt:new Date().toISOString(),configuration:config,rows,errors,warnings,
    limitations:['Saved top20 warmups only, not every timed request, every query or a new all-document score proof.',
      'Cross-method parity is relative to the numeric OpenSearch service; shared baseline mistakes remain possible.',
      'Executor warmups retain stage/bound summaries, not each actual stage request body. Reference query/filter bindings and archived executor sources are verified; separate real-corpus trace proofs remain necessary.',
      'Single-target direct sort may serialize the same float32 utility differently. Raw score differences are recorded separately.',
      'Strict latency failures remain visible and are not cleared by ranking agreement. This adds no new performance measurement.']};
  let campaign;
  try {
    const plan=await read('plan',path.join(config.directory,'plan.json'));
    campaign=await read('benchmark',path.join(config.directory,'benchmark.json'));
    const sources=await read('sources',path.join(config.directory,'source-snapshot.json'));
    const receipt=await read('receipt',config.receipt);let capacityAudit;
    try{capacityAudit=await read('capacityAudit',config.audit);}catch(error){if(error.code!=='ENOENT')throw error;warnings.push('Raw capacity audit not available yet.');}
    assert.equal(campaign.experiment,'favorite-optimization-benchmark');assert.equal(campaign.planHash,hash(plan));
    assert.equal(campaign.sourceSnapshotHash,hash(sources));assert.equal(plan.sourceSnapshotHash,hash(sources));
    for(const [file,value] of Object.entries(campaign.sourceHashes))assert.equal(value,hash(sources[file]));
    for(const key of ['candidates','cases','queryPlans','configuration','indexFingerprints'])assert.ok(same(campaign[key],plan[key]),'Campaign/plan mismatch: '+key);
    if(capacityAudit){assert.equal(capacityAudit.hashes?.benchmark,hash(campaign));assert.equal(capacityAudit.hashes?.plan,hash(plan));assert.equal(capacityAudit.hashes?.archivedSources,hash(sources));}
    result.capacityEvidenceAccepted=capacityAudit?.accepted===true&&capacityAudit?.integrityPassed===true&&capacityAudit?.complete===true;
    if(!result.capacityEvidenceAccepted)warnings.push('Raw capacity evidence is not accepted as complete; parity remains provisional.');
    assert.equal(receipt.count,config.count);assert.equal(receipt.indexed,config.count);assert.ok(receipt.finishedAt&&!receipt.error&&!receipt.interruptedAt);
    assert.equal(receipt.configuration.scope,config.scope);assert.equal(receipt.configuration.numericPoints,true);assert.equal(receipt.configuration.source,false);
    assert.equal(receipt.configuration.presets,'favorite');assert.deepEqual(receipt.configuration.encodings,['numeric']);
    assert.equal(campaign.configuration.count,config.count);assert.ok(same(campaign.configuration.selectivities,config.selectivities));assert.equal(campaign.configuration.limit,20);
    assert.equal(receipt.uuid,receipt.after.settings[receipt.index].settings.index.uuid);
    const before=campaign.indexBefore.find(i=>i.index===receipt.index),after=campaign.indexAfter?.find(i=>i.index===receipt.index),fingerprint=plan.indexFingerprints.find(i=>i.index===receipt.index);
    assert.ok(before);result.index={index:receipt.index,count:config.count,scope:config.scope,uuid:receipt.uuid,utilityCount:Object.keys(before.mapping.properties.utilities.properties).length};
    for(const state of [before,...(after?[after]:[])]) {
      assert.equal(state.uuid,receipt.uuid);assert.equal(state.count,config.count);assert.equal(state.settings.uuid,receipt.uuid);
      assert.equal(state.settings.number_of_shards,'1');assert.equal(state.settings.number_of_replicas,'0');assert.equal(state.mapping._source.enabled,false);
      assert.equal(Object.keys(state.mapping.properties.utilities.properties).length,receipt.utilities);if(config.scope==='full')assert.equal(receipt.utilities,6138);
      assert.equal(state.mappingHash,hash(canonical(state.mapping)));assert.equal(state.metadataHash,hash(canonical(state.mapping._meta)));
      assert.equal(state.mapping._meta.scope,config.scope);assert.equal(state.mapping._meta.numericPoints,true);assert.equal(state.mapping._meta.identityHash,receipt.identityHash);
      assert.equal(state.mapping.properties.id.type,'keyword');assert.notEqual(state.mapping.properties.id.doc_values,false);
      for(const key of ['uuid','count','mappingHash','metadataHash','indexing'])assert.ok(same(state[key],fingerprint[key]),'Index generation differs: '+key);
      assert.equal(state.stats.indices[receipt.index].primaries.docs.count,config.count);
    }
    result.indexGenerationVerified=Boolean(after);if(!after)warnings.push('No final index generation: evidence is incomplete.');
    const byMethod=new Map();for(const method of config.methods){const selected=plan.candidates.filter(c=>c.method===method);assert.equal(selected.length,1,'Method absent/ambiguous: '+method);verifyCandidate(selected[0],method);assert.equal(selected[0].index,receipt.index);byMethod.set(method,selected[0]);}
    const reference=byMethod.get(baseline);for(const c of byMethod.values())assert.ok(same(c.parameters,reference.parameters),'Control settings differ');
    const expected=[];
    for(const shape of SHAPES)for(const selectivity of config.selectivities)for(const method of config.methods) {
      const candidate=byMethod.get(method),queryId=shape.id+(selectivity==='all'?'':'-'+selectivity),caseId=candidate.id+':'+queryId;
      const cases=plan.cases.filter(c=>c.id===caseId),bodies=plan.queryPlans.filter(q=>q.caseId===caseId);assert.equal(cases.length,1);assert.equal(bodies.length,1);
      const item=cases[0],queryPlan=bodies[0];assert.equal(item.candidateId,candidate.id);assert.equal(item.method,method);assert.equal(item.queryId,queryId);assert.equal(item.selectivity,selectivity);assert.equal(item.index,receipt.index);
      assert.ok(same(item.query,shape.query)&&same(item.parameters,reference.parameters)&&same(item.filter,expectedFilter(selectivity)),'Query/filter binding differs');
      assert.ok(same(item.builder,candidate.builder)&&same(item.executor,candidate.executor));assert.ok(same(queryPlan.executor,candidate.executor));assert.equal(queryPlan.index,receipt.index);assert.equal(queryPlan.candidateId,candidate.id);assert.equal(queryPlan.bodyHash,hash(queryPlan.body));
      const normalizedBody=verifyQueryBody(queryPlan.body,{method,targets:shape.query.targets.length,selectivity,mapping:before.mapping});
      expected.push({caseId,queryId,selectivity,method,candidateId:candidate.id,targets:shape.query.targets.length,normalizedBody});
    }
    for(const item of expected){const base=expected.find(e=>e.method===baseline&&e.queryId===item.queryId);assert.ok(same(item.normalizedBody,base.normalizedBody),'Native objective differs across methods');}
    const requests=path.join(config.directory,'requests.jsonl'),beforeStat=await stat(requests),digest=createHash('sha256'),stream=createReadStream(requests);stream.on('data',chunk=>digest.update(chunk));
    for await(const line of createInterface({input:stream,crlfDelay:Infinity})) {
      if(!/"phase"\s*:\s*"warmup"/.test(line))continue;
      const row=JSON.parse(line);if(!expected.some(e=>e.caseId===row.caseId))continue;
      assert.equal(row.phase,'warmup');assert.ok(!captured.has(row.caseId),'Repeated raw warmup case');captured.set(row.caseId,row);
    }
    const afterStat=await stat(requests);assert.equal(beforeStat.size,afterStat.size);assert.equal(beforeStat.mtimeMs,afterStat.mtimeMs);
    files.requests={path:requests,sha256:digest.digest('hex'),bytes:afterStat.size};
    let warmupErrors=0,strictFailures=0,completeLists=0;
    for(const item of expected) {
      const row=captured.get(item.caseId),groups=campaign.warmups.filter(w=>w.caseId===item.caseId);
      if(!row){warnings.push('Missing raw warmup: '+item.caseId);continue;}
      assert.equal(groups.length,1);assert.equal(groups[0].trials.length,1);
      for(const [key,value] of Object.entries(groups[0].trials[0]))assert.ok(same(row[key],value),'Raw/checkpoint warmup differs: '+key);
      for(const key of ['method','index','count','selectivity','candidateId','queryId'])assert.equal(row[key],key==='index'?receipt.index:key==='count'?config.count:item[key]);
      assert.ok(same(row.parameters,reference.parameters));assert.equal(row.concurrency,1);assert.equal(row.ordinal,0);
      const checked=verifyHitList(row,{count:config.count,selectivity:item.selectivity});if(checked.available)completeLists++;if(row.error)warmupErrors++;
      if(row.error||!Number.isFinite(row.elapsedMs)||row.elapsedMs<0||row.elapsedMs>=1000)strictFailures++;
      if(!row.error&&item.method.includes('bounded')) {
        const evidence=row.executionEvidence,phases=evidence?.stages?.map(s=>s.phase);assert.equal(evidence?.index,receipt.index);assert.equal(phases?.[0],'pit-open');assert.equal(phases?.at(-1),'pit-close');assert.ok(phases.includes('global-final'));
        assert.equal(evidence.globalBounds.completeCandidateCoverage,true);assert.equal(evidence.globalBounds.consistency,'point-in-time');
        if(item.method.includes('maxima'))assert.ok(evidence.globalBounds.maximaBounds&&Array.isArray(evidence.globalBounds.maximaBounds.thresholds));
      }
    }
    for(const item of expected.filter(e=>e.method!==baseline)) {
      const base=expected.find(e=>e.method===baseline&&e.queryId===item.queryId);
      rows.push({method:item.method,queryId:item.queryId,selectivity:item.selectivity,...compareWarmups(captured.get(base.caseId),captured.get(item.caseId),{...item,count:config.count})});
    }
    result.coverage={expectedWarmups:expected.length,observedWarmups:captured.size,completeHitLists:completeLists,warmupErrors,strictWarmupFailures:strictFailures,
      expectedComparisons:expected.length/config.methods.length*(config.methods.length-1),compared:rows.filter(r=>r.status!=='unavailable').length,unavailable:rows.filter(r=>r.status==='unavailable').length};
    result.complete=Boolean(campaign.finishedAt&&!campaign.interruption&&!campaign.error&&after&&result.capacityEvidenceAccepted);
    result.completeHitEvidence=completeLists===expected.length;result.controlParameters=reference.parameters;
  } catch(error){errors.push(String(error.stack??error));}
  result.integrityPassed=errors.length===0;result.mismatches=rows.filter(r=>r.status==='mismatch').length;
  result.parityPassed=result.mismatches?false:result.integrityPassed&&result.complete&&result.completeHitEvidence?true:null;
  result.rawScoresIdentical=result.parityPassed===true?rows.every(r=>r.rawScoresIdentical):null;
  result.maximumRawScoreDelta=rows.some(r=>Number.isFinite(r.maximumRawScoreDelta))?Math.max(...rows.map(r=>r.maximumRawScoreDelta??0)):null;
  result.files=files;result.auditCodeSha256=hash(await readFile(fileURLToPath(import.meta.url)));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=configuration(process.argv.slice(2)),result=await auditWarmupParity(config);
  await writeFile(config.output,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({output:config.output,index:result.index,complete:result.complete,integrityPassed:result.integrityPassed,parityPassed:result.parityPassed,coverage:result.coverage,rawScoresIdentical:result.rawScoresIdentical,maximumRawScoreDelta:result.maximumRawScoreDelta,errors:result.errors}));
  if(!result.integrityPassed||result.parityPassed===false)process.exitCode=1;else if(result.parityPassed!==true)process.exitCode=2;
}
