import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery } from './methods.mjs';
import { buildFastQuery, FAST_METHODS, typedHistogramScript } from './methods-fast.mjs';
import { INDEX, searchIndex } from './service.mjs';

const QUERIES=[
  {text:'red'},
  {mode:'proportions',targets:[{name:'green',percent:40}]},
  {mode:'proportions',targets:[{name:'grayscale',percent:80},{name:'red',percent:20}]},
  {mode:'proportions',targets:[{name:'red',percent:20},{name:'orange',percent:20},{name:'yellow',percent:20},{name:'green',percent:20},{name:'blue',percent:20}]},
  {text:'mostly grayscale with red accents'},
];
test('typed optimization preserves query parameters, filters and sort',()=>{
  for(const method of FAST_METHODS)for(const query of QUERIES){
    const input={query,limit:37,eligibleIds:['a','b'],excludedIds:['b']};
    const slow=buildQuery({...input,method:method.baseMethod}),fast=buildFastQuery({...input,method:method.id});
    assert.notEqual(slow.query.script_score.script.source,fast.query.script_score.script.source);
    fast.query.script_score.script.source=slow.query.script_score.script.source;
    assert.deepEqual(fast,slow);
  }
});
test('typed source limits target specialization and avoids per-cell params access',()=>{
  assert.throws(()=>typedHistogramScript({targets:[],palette:false}),/1\.\.10/);
  const source=typedHistogramScript({targets:[.4,.6],palette:false});
  const loop=source.slice(source.indexOf('for (int i ='),source.indexOf('if (params.special'));
  assert.equal(loop.includes('params.'),false);
  assert.match(loop,/weights1.get\(cell\)/);
});
test('typed service queries preserve all545scores and ordered hits', {skip:process.env.COLOR_EXPLORATION_FAST_INTEGRATION!=='1'},async()=>{
  for(const method of FAST_METHODS)for(const query of QUERIES){
    const slow=await searchIndex(INDEX,buildQuery({method:method.baseMethod,query,limit:1000}));
    const fast=await searchIndex(INDEX,buildFastQuery({method:method.id,query,limit:1000}));
    assert.equal(slow.hits.length,545);
    assert.deepEqual(fast.hits,slow.hits,`${method.id}: ${JSON.stringify(query)}`);
  }
});
