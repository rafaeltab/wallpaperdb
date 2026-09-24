// File-only independent replay; does not import an experiment scorer or service client.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const repository='/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark';
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const normalizeMapping=value=>Array.isArray(value)?value.map(normalizeMapping):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key,v])=>!((['index','doc_values'].includes(key)&&v===true)||(key==='type'&&v==='object'&&value.properties))).map(([key,v])=>[key,normalizeMapping(v)])):value;
const inputHashes={};
async function read(relative){const bytes=await readFile(path.join(root,relative));inputHashes[relative]=hash(bytes);return JSON.parse(bytes);}
const auditRoot='points-full-1m-v1-audit';
const receipt=await read('points-full-1m-v1/index.json');
const audit=await read(auditRoot+'/audit.json');
const inputs=await read(auditRoot+'/inputs.json');
const status=await read('full-million-build-v1/status.json');
assert.equal(status.planSha256,hash(await readFile(path.join(root,'full-million-build-v1/plan.json'))));
assert.ok(status.finishedAt);assert.ok(status.phases.every(p=>p.finishedAt&&p.exitCode===0));
assert.equal(receipt.generated,1e6);assert.equal(receipt.indexed,1e6);assert.equal(receipt.count,1e6);
assert.ok(receipt.finishedAt&&!receipt.error);assert.equal(receipt.utilities,6138);
assert.equal(receipt.configuration.scope,'full');assert.equal(receipt.configuration.presets,'favorite');
assert.deepEqual(receipt.configuration.encodings,['numeric']);assert.equal(receipt.configuration.numericPoints,true);assert.equal(receipt.configuration.source,false);
assert.equal(hash(receipt.identity),receipt.identityHash);
const artifacts={};
for(const [key,entry] of Object.entries(inputs.parentFiles)){
 const archived=await readFile(path.join(root,auditRoot,entry.archived));
 const original=await readFile(entry.filename);
 assert.equal(hash(archived),entry.hash);assert.equal(hash(original),entry.hash);
 inputHashes[auditRoot+'/'+entry.archived]=hash(archived);artifacts[key]=JSON.parse(archived);
}
assert.deepEqual(artifacts.receipt,receipt);
assert.equal(hash(artifacts.plan),receipt.planHash);assert.equal(receipt.identity.planHash,receipt.planHash);
assert.equal(artifacts.plan.utilityCount,6138);assert.equal(artifacts.plan.descriptors.length,6138);
assert.equal(hash(artifacts.snapshot),receipt.sourceSnapshotHash);
assert.deepEqual(Object.fromEntries(Object.entries(artifacts.snapshot).map(([name,text])=>[name,hash(text)])),receipt.identity.sourceHashes);
const auditSources=await read(auditRoot+'/source-snapshot.json');
assert.equal(hash(auditSources),audit.sourceSnapshotHash);assert.equal(audit.parentSourceSnapshotHash,receipt.sourceSnapshotHash);
for(const [name,text] of Object.entries(artifacts.snapshot))assert.equal(auditSources[name],text);
for(const [name,text] of Object.entries(auditSources))assert.equal(await readFile(path.join(repository,name),'utf8'),text);
const {_meta,...plainMapping}=artifacts.mapping.mappings;
assert.equal(hash({...artifacts.mapping,mappings:plainMapping}),receipt.identity.mappingHash);
for(const key of ['identityHash','planHash'])assert.equal(_meta[key],receipt[key]);
assert.equal(_meta.sourceDocumentsHash,receipt.source.selectedDocumentsHash);
assert.equal(_meta.sourceIdentityHash,inputs.sourceIdentityHash);
assert.equal(_meta.utilityDefinitionVersion,2);assert.equal(_meta.compiledEncoderVersion,1);
const expected=await read(auditRoot+'/expected-samples.json');
assert.equal(hash(expected),audit.sampleAudit.valuesHash);
assert.deepEqual(expected.map(x=>x.id),['favorite-synthetic-000000000','favorite-synthetic-000499999','favorite-synthetic-000999999']);
assert.equal(expected.length,3);assert.ok(expected.every(d=>Object.keys(d.utilities).length===6138));
const keys=Object.keys(expected[0].utilities).sort();
const utilityMapping=artifacts.mapping.mappings.properties.utilities.properties;
assert.deepEqual(Object.keys(utilityMapping).sort(),keys);
for(const spec of Object.values(utilityMapping)){assert.equal(spec.type,'float');assert.notEqual(spec.index,false);assert.notEqual(spec.doc_values,false);}
let fingerprint;
for(const name of ['index-before.json','index-after.json']){
 const state=await read(auditRoot+'/'+name),index=receipt.index;
 const settings=state.settings[index].settings.index, mapping=state.mapping[index].mappings;
 assert.equal(settings.uuid,receipt.uuid);assert.equal(settings.number_of_shards,'1');assert.equal(settings.number_of_replicas,'0');
 assert.equal(state.count.count,1e6);assert.equal(state.count._shards.failed,0);
 assert.equal(hash(canonical(normalizeMapping(mapping))),hash(canonical(normalizeMapping(artifacts.mapping.mappings))),'Mapping differs after only implicit object/true-index/doc-values normalization');
 const primary=state.statistics.indices[index].primaries;
 const generation=[primary.docs.count,primary.docs.deleted,primary.indexing.index_total,primary.indexing.delete_total];
 assert.deepEqual(generation,[1e6,0,1e6,0]);
 const current={uuid:receipt.uuid,count:1e6,generation,mapping:state.mapping,settings:state.settings};
 if(fingerprint)assert.deepEqual(current,fingerprint);fingerprint=current;
 assert.equal(hash(canonical(current)),audit[name==='index-before.json'?'beforeFingerprintHash':'afterFingerprintHash']);
}
assert.equal(audit.uuid,receipt.uuid);assert.equal(audit.count,1e6);assert.equal(audit.receiptHash,inputHashes['points-full-1m-v1/index.json']);
assert.equal(audit.identityHash,receipt.identityHash);assert.equal(audit.planHash,receipt.planHash);
assert.equal(audit.readOnly,true);assert.equal(audit.verified,true);assert.ok(audit.finishedAt&&!audit.error);
const raw=await readFile(path.join(root,auditRoot,'batches.jsonl'),'utf8');inputHashes[auditRoot+'/batches.jsonl']=hash(raw);
assert.ok(raw.endsWith('\n'));
const batches=raw.trimEnd().split('\n').map(JSON.parse),seen=new Set();let compared=0;
const metadata=['id','reference_id','cohort','partition','tags'];
for(const [ordinal,batch] of batches.entries()){
 assert.equal(batch.ordinal,ordinal);assert.equal(hash(batch.request),batch.requestHash);assert.equal(hash(batch.response),batch.responseHash);
 assert.equal(batch.request.size,3);assert.equal(batch.request._source,false);assert.equal(batch.request.stored_fields,'_none_');
 assert.deepEqual(batch.request.query,{ids:{values:expected.map(d=>d.id)}});
 assert.deepEqual(batch.request.docvalue_fields,[...metadata,...batch.utilityFields]);
 assert.equal(batch.response.timed_out,false);assert.equal(batch.response._shards.failed,0);
 assert.deepEqual(batch.response.hits.total,{value:3,relation:'eq'});assert.equal(batch.response.hits.hits.length,3);
 assert.deepEqual(batch.response.hits.hits.map(h=>h.fields.id[0]),expected.map(d=>d.id));
 for(const field of batch.utilityFields){assert.ok(!seen.has(field));seen.add(field);assert.ok(keys.includes(field.slice(10)));}
 for(const [i,hit] of batch.response.hits.hits.entries()){
  const wanted=expected[i];assert.equal(hit._index,receipt.index);assert.ok(!Object.hasOwn(hit,'_source'));
  for(const name of metadata)assert.deepEqual(hit.fields[name],name==='tags'?[...new Set(wanted[name])].sort():[wanted[name]]);
  for(const field of batch.utilityFields){const [actual,...extra]=hit.fields[field];assert.equal(extra.length,0);assert.ok(Number.isFinite(actual)&&actual>=0&&actual<=1);assert.equal(Math.fround(actual),wanted.utilities[field.slice(10)]);compared++;}
 }
}
assert.deepEqual([...seen].sort(),keys.map(k=>'utilities.'+k));assert.equal(compared,18414);assert.equal(batches.length,82);
assert.equal(audit.sampleAudit.valuesCompared,compared);assert.equal(audit.sampleAudit.completedBatches,batches.length);assert.equal(audit.sampleAudit.verified,true);
const output={schemaVersion:1,experiment:'favorite-full-million-bindings-independent-audit',at:new Date().toISOString(),fileOnly:true,verified:true,
 sourceSha256:hash(await readFile(fileURLToPath(import.meta.url))),index:receipt.index,uuid:receipt.uuid,documents:receipt.count,
 sourceFilesChecked:Object.keys(auditSources).length,parentSourceFilesChecked:Object.keys(artifacts.snapshot).length,
 checkedOrdinals:[0,499999,999999],utilitiesPerSample:6138,valuesCompared:compared,rawBatches:batches.length,inputHashes,
 limitations:['This replays all saved returned values against the archived original-encoder oracle for three sampled documents; it is not an all-document value audit.','No scorer execution, query request, or service mutation was performed.','Ingestion acknowledgement and scheduler reconciliation is audited separately.']};
const filename=path.join(root,'full-million-bindings-independent-v1.json');await writeFile(filename,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:filename,...Object.fromEntries(['verified','documents','sourceFilesChecked','valuesCompared','rawBatches'].map(k=>[k,output[k]]))}));
