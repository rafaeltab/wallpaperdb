// Explicit user examples as service correctness checks, separate from human-image agreement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, bulkIndex, finishIndex } from './service.mjs';
import { executeSearch } from './registry.mjs';

test('refined service objective respects closed palettes, free remainder, exact amount and separate quality', {skip:process.env.COLOR_EXPLORATION_INTENT_INTEGRATION!=='1'}, async()=>{
  const index=`color-exploration-intent-${Date.now()}`;
  const properties={id:{type:'keyword'},cov_grayscale:{type:'integer'},cov_red:{type:'integer'},cov_green:{type:'integer'},quality_grayscale:{type:'float'},quality_red:{type:'float'},quality_green:{type:'float'}};
  await api(index,{method:'PUT',body:{settings:{number_of_shards:1,number_of_replicas:0},mappings:{properties}}});
  const doc=(id,gray,red,green,q=1)=>({id,cov_grayscale:gray*10000,cov_red:red*10000,cov_green:green*10000,quality_grayscale:1,quality_red:1,quality_green:q});
  await bulkIndex(index,[doc('gray90red10',.9,.1,0),doc('gray80red18blue2',.8,.18,0),doc('green20',0,0,.2),doc('green40',0,0,.4),doc('green60',0,0,.6),doc('green80edge',0,0,.8,.5)]);
  await finishIndex(index);
  const query=(targets)=>({mode:'proportions',targets:targets.map(([name,percent])=>({name,percent}))});
  const search=async(targets,eligibleIds)=>(await executeSearch({index,method:'feature-intent-balanced',query:query(targets),eligibleIds,limit:10})).hits;
  const colors=['gray90red10','gray80red18blue2'];
  assert.deepEqual((await search([['grayscale',80],['red',20]],colors)).map(h=>h.id),colors);
  assert.deepEqual((await search([['grayscale',80],['red',10]],colors)).map(h=>h.id),[...colors].reverse());
  assert.deepEqual((await search([['green',40]],['green20','green40','green60','green80edge'])).map(h=>h.id),['green40','green20','green60','green80edge']);
});
