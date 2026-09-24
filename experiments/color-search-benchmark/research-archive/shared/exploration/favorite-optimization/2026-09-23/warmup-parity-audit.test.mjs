import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdtemp,copyFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {configuration,verifyHitList,compareWarmups,verifyQueryBody,auditWarmupParity} from './warmup-parity-audit.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const options={method:'favorite-utility-sorted-docvalues',targets:1,count:100000,selectivity:'all'};
function row({elapsedMs=5,transport=false}={}){const hits=Array.from({length:20},(_,i)=>({id:'favorite-synthetic-'+String(i).padStart(9,'0'),score:transport?Math.fround(.9-i*.02):.9-i*.02}));return {hits,hitCount:20,hitsHash:hash(hits),elapsedMs};}
test('default scope is full million with all four methods and three filter selectivities',()=>{const c=configuration(['--directory','/tmp/a','--receipt','/tmp/r','--audit','/tmp/audit','--output','/tmp/out']);assert.equal(c.count,1000000);assert.equal(c.scope,'full');assert.equal(c.methods.length,4);assert.equal(c.selectivities.length,3);});
test('sorted transport preserves exact float32 while raw score differences remain visible',()=>{const r=compareWarmups(row(),row({transport:true}),options);assert.equal(r.status,'match');assert.equal(r.rawScoresIdentical,false);assert.equal(r.float32ScoresIdentical,true);assert.ok(r.maximumRawScoreDelta>0);});
test('native bounded scores cannot use the sort transport exception',()=>{assert.equal(compareWarmups(row(),row({transport:true}),{...options,method:'favorite-utility-bounded'}).status,'mismatch');});
test('missing/error hits remain unavailable and truncated lists cannot pass',()=>{assert.equal(compareWarmups(undefined,row(),options).status,'unavailable');assert.equal(compareWarmups(row(),{error:'timeout'},options).candidateError,'timeout');const short=row();short.hits.pop();short.hitCount=19;short.hitsHash=hash(short.hits);assert.throws(()=>verifyHitList(short,options));});
test('a complete ranking does not clear a strict latency failure',()=>{const result=compareWarmups(row(),row({elapsedMs:1000}),options);assert.equal(result.status,'match');assert.equal(result.candidateStrictPerformanceFailure,true);});
test('duplicate IDs, invalid scores, wrong filters and reversed ties fail evidence checks',()=>{for(const mutate of [r=>r.hits[1].id=r.hits[0].id,r=>r.hits[0].score=NaN,r=>{r.hits[0].score=r.hits[1].score;[r.hits[0].id,r.hits[1].id]=[r.hits[1].id,r.hits[0].id];}]){const r=row();mutate(r);r.hitsHash=hash(r.hits);assert.throws(()=>verifyHitList(r,options));}assert.throws(()=>verifyHitList(row(),{...options,selectivity:'tag1'}));});
test('saved query binding rejects hidden eligibility or unindexed utility fields',()=>{
 const body={size:20,_source:false,track_total_hits:false,timeout:'950ms',query:{bool:{filter:[{match_all:{}}],must:[{constant_score:{filter:{match_all:{}},boost:0}}],should:[{function_score:{query:{match_all:{}},field_value_factor:{field:'utilities.red',factor:1,modifier:'none',missing:0},boost_mode:'replace'}}],minimum_should_match:0}},sort:[{_score:'desc'},{id:'asc'}],stored_fields:'_none_',docvalue_fields:['id']};
 const context={method:'favorite-utility-numeric-docvalues',targets:1,selectivity:'all',mapping:{properties:{utilities:{properties:{red:{type:'float'}}}}}};
 verifyQueryBody(body,context);body.post_filter={match_none:{}};assert.throws(()=>verifyQueryBody(body,context));delete body.post_filter;body.query.bool.must_not=[{match_all:{}}];assert.throws(()=>verifyQueryBody(body,context));delete body.query.bool.must_not;context.mapping.properties.utilities.properties.red.index=false;assert.throws(()=>verifyQueryBody(body,context));
});
test('incomplete actual-campaign copy retains missing warmup cases without inventing parity',async()=>{
 const root=path.dirname(fileURLToPath(import.meta.url)),old=path.join(root,'fetch-full-100k-leaders-c1-v1'),dir=await mkdtemp(path.join(tmpdir(),'favorite-warmup-parity-'));
 try{
  for(const name of ['plan.json','source-snapshot.json'])await copyFile(path.join(old,name),path.join(dir,name));
  const campaign=JSON.parse(await readFile(path.join(old,'benchmark.json'),'utf8'));delete campaign.finishedAt;delete campaign.indexAfter;await writeFile(path.join(dir,'benchmark.json'),JSON.stringify(campaign));
  const raw=(await readFile(path.join(old,'requests.jsonl'),'utf8')).trim().split('\n').filter(line=>/"phase"\s*:\s*"warmup"/.test(line));raw.shift();await writeFile(path.join(dir,'requests.jsonl'),raw.join('\n')+'\n');
  const result=await auditWarmupParity({directory:dir,receipt:path.join(root,'points-full-100k-v1/index.json'),audit:path.join(dir,'absent-audit.json'),count:100000,scope:'full',methods:['favorite-utility-numeric-docvalues','favorite-utility-sorted-docvalues','favorite-utility-bounded'],selectivities:['all']});
  assert.equal(result.integrityPassed,true,JSON.stringify(result.errors));assert.equal(result.complete,false);assert.equal(result.parityPassed,null);assert.equal(result.coverage.expectedWarmups,12);assert.equal(result.coverage.observedWarmups,11);assert.ok(result.coverage.unavailable>0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
