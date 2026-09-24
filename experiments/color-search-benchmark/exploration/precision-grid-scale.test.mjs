import test from 'node:test';
import assert from 'node:assert/strict';
import { gridScaleConfiguration,validateGridScaleConfiguration,gridScaleIdentity,validateGridScaleResume,settleGridFailure,SOURCE_FIELDS,SUPPORTED_WORKLOAD } from './precision-grid-scale.mjs';

test('grid scale covers the seven shared picked colors with enough requests for sixteen workers',()=>{
  const config=gridScaleConfiguration([]);validateGridScaleConfiguration(config);
  assert.equal(SUPPORTED_WORKLOAD.length,7);
  assert.ok(SUPPORTED_WORKLOAD.length*config.repetitions>=16);
  assert.deepEqual(SOURCE_FIELDS,['palette32_packed','palette_total']);
  assert.throws(()=>validateGridScaleConfiguration({...config,counts:[1000,1000]}),/Counts/);
  assert.throws(()=>validateGridScaleConfiguration({...config,counts:[]}),/Counts/);
  assert.throws(()=>validateGridScaleConfiguration({...config,limit:0}),/limit/);
  assert.throws(()=>validateGridScaleConfiguration({...config,concurrencies:[16,1]}),/concurrency/);
});

test('grid scale identity binds actual encoder, source descriptors, generator and seed',()=>{
  const input={fingerprints:{descriptorHash:'d',definitionHash:'f',computationHash:'c'},generatorHash:'g',seed:42};
  const identity=gridScaleIdentity(input);
  for(const field of ['descriptorHash','definitionHash','computationHash'])assert.notDeepEqual(identity,gridScaleIdentity({...input,fingerprints:{...input.fingerprints,[field]:'changed'}}));
  assert.notDeepEqual(identity,gridScaleIdentity({...input,generatorHash:'changed'}));
  assert.notDeepEqual(identity,gridScaleIdentity({...input,seed:43}));
});

test('grid resume rejects stale encoder/index identity and incompatible cardinality',()=>{
  const checkpoint={identityHash:'a',nextIndex:1000,batchSize:50};
  assert.equal(validateGridScaleResume({checkpoint,metadata:{identityHash:'a'},identityHash:'a',actual:1025}),true);
  assert.throws(()=>validateGridScaleResume({checkpoint,metadata:{identityHash:'b'},identityHash:'a',actual:1000}),/identity/);
  assert.throws(()=>validateGridScaleResume({checkpoint:{...checkpoint,identityHash:'b'},metadata:{identityHash:'a'},identityHash:'a',actual:1000}),/identity/);
  for(const actual of [999,1051])assert.throws(()=>validateGridScaleResume({checkpoint,metadata:{identityHash:'a'},identityHash:'a',actual}),/count/);
  assert.throws(()=>validateGridScaleResume({checkpoint:null,metadata:{identityHash:'a'},identityHash:'a',actual:1000}),/identity/);
  assert.throws(()=>validateGridScaleResume({checkpoint,metadata:{identityHash:'a'},identityHash:'a',actual:1025,nextBatchSize:10}),/smaller batch/);
});

test('a failed profile must save idle evidence or stop before the next stage',async()=>{
  const result={};let saves=0;
  await settleGridFailure({result,context:{count:1000,phase:'failed-profile'},save:async()=>saves++,settle:async()=>({settled:true,samples:[{active:0,queued:0}]})});
  assert.equal(saves,1);assert.equal(result.settling[0].count,1000);
  await assert.rejects(()=>settleGridFailure({result,context:{count:10000},save:async()=>saves++,settle:async()=>({settled:false,samples:[{active:1,queued:4}]})}),/did not settle/);
  assert.equal(saves,2);assert.equal(result.settling[1].settled,false);
});
