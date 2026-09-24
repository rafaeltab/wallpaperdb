// THROWAWAY PROTOTYPE: certified global joint area ranking with indexed union bounds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { api, bulk, recreateIndex, saveJson, metadataProperties, randomGenerator } from './global-common.mjs';
import { NATIVE_FAMILIES, NATIVE_PROPERTIES, toNativeDocument, tokenQuery } from './global-native.mjs';
import { JOINT_PROPERTIES, JOINT_PAIRS, JOINT_EPSILON, unionKey, toJointDocument, normalizeJointQuery, jointQuery, jointReference } from './global-joint.mjs';
import { openPit, closePit } from './global-bounded.mjs';

const complete=response=>{
  if(response.timed_out||response._shards?.failed>0)throw new Error('A partial or timed-out search cannot certify global results.');
};

/** Largest cost that might share or beat this float32 score, including midpoint ties. */
export function jointTieThreshold(value){
  const score=Math.fround(value);
  if(!Number.isFinite(score)||score<0||score>1)throw new Error('Joint score must be between zero and one.');
  if(score===0)return 1;
  const buffer=new ArrayBuffer(4),view=new DataView(buffer);
  view.setFloat32(0,score,false);
  view.setUint32(0,view.getUint32(0,false)-1,false);
  const previous=view.getFloat32(0,false);
  // Any higher error rounds below score. Extra allowance covers double arithmetic
  // and the joint scorer's own inclusive boundary convention.
  return Math.min(1,Math.max(0,1-(score+previous)/2)+2*JOINT_EPSILON);
}

export async function boundedJointSearch(index,input,options={}){
  if(typeof index!=='string'||!/^color-global-[a-z0-9_-]+$/.test(index))throw new Error('Only a named color-global- scratch index is allowed.');
  const started=performance.now();
  const colors=normalizeJointQuery(input),mode=options.mode??'target';
  if(!['target','minimum'].includes(mode))throw new Error('Unknown joint mode.');
  const size=options.size??20;
  if(!Number.isInteger(size)||size<1||size>10000)throw new Error('Page size must be between 1 and 10000.');
  if(options.qualityTieBreak)throw new Error('Joint bounded prototype supports score/id ordering only.');
  if(options.boundary!==undefined&&options.boundary!=='hard')throw new Error('Joint bounded prototype supports hard region membership only.');
  if(options.from!==undefined)throw new Error('Use search_after for joint bounded pagination.');
  const filter=options.filter??options.filters??[];
  if(!Array.isArray(filter))throw new Error('Metadata filters must be an array.');
  const queryFingerprint=createHash('sha256').update(JSON.stringify({index,colors,filter,mode})).digest('hex');
  if(options.queryFingerprint&&options.queryFingerprint!==queryFingerprint)throw new Error('Cursor belongs to a different joint query, mode, or filter.');
  if(options.threshold!==undefined&&(!Number.isFinite(options.threshold)||options.threshold<0||options.threshold>1))throw new Error('Joint threshold must be between 0 and 1.');
  const cursor=options.search_after;
  if(cursor!==undefined&&(!Array.isArray(cursor)||cursor.length<2||!Number.isFinite(cursor[0])||cursor[0]<0||cursor[0]>1||typeof cursor[1]!=='string'))throw new Error('search_after must be a returned joint-score/id cursor.');
  const suppliedPit=typeof options.pit==='string'?options.pit:options.pit?.id;
  if(cursor&&!suppliedPit)throw new Error('Joint pagination requires the previous PIT.');
  const keepAlive=typeof options.pit==='object'?(options.pit.keep_alive??'2m'):(options.keep_alive??'2m');
  let pitId=suppliedPit,createdPit=false;
  const timing={pitMs:0,seedMs:0,finalMs:0,totalMs:0,requests:0};
  const diagnostics={seedCount:null,seedThreshold:null,seedMaxCost:null,seedIds:[],iterations:[],maximumThreshold:1,eligibleTotalKnown:false};
  try{
    if(!pitId){const opened=await openPit(index,keepAlive);pitId=opened.pitId;createdPit=true;timing.pitMs=opened.wallMs;timing.requests++;}
    let threshold=options.threshold;
    if(threshold===undefined){
      const seed=tokenQuery(colors,{size,filter,pit:{id:pitId,keep_alive:keepAlive},stableSort:true,_source:false,track_total_hits:false});
      const fields=colors.map(c=>`covj_${c.family}`);
      if(colors.length===2)fields.push(`unionj_${unionKey(colors[0].family,colors[1].family)}`);
      seed.docvalue_fields=fields;seed.timeout=options.timeout??'15s';
      const response=await api('/_search?allow_partial_search_results=false',seed);
      timing.seedMs=response.wallMs;timing.requests++;complete(response.body);pitId=response.body.pit_id??pitId;
      const hits=response.body.hits.hits;
      diagnostics.seedCount=hits.length;diagnostics.seedIds=hits.map(h=>h._id);
      const references=hits.map(hit=>{
        const doc={id:hit._id};
        for(const field of fields){
          const value=hit.fields?.[field]?.[0];
          if(!Number.isFinite(value))throw new Error('Seed document lacks required joint coverage or union.');
          doc[field]=value;
        }
        return jointReference(doc,colors,{mode});
      });
      diagnostics.seedMaxCost=references.length?Math.max(...references.map(r=>r.cost)):null;
      threshold=hits.length<size?1:jointTieThreshold(Math.min(...references.map(r=>r.score)));
      diagnostics.seedThreshold=threshold;
    }
    for(;;){
      const body=jointQuery(colors,{size,mode,maxError:threshold,filters:filter,pit:{id:pitId,keep_alive:keepAlive},search_after:cursor,_source:options._source??false,track_total_hits:options.track_total_hits??false,profile:options.profile??false});
      body.timeout=options.timeout??'15s';
      const response=await api('/_search?allow_partial_search_results=false',body);
      timing.finalMs+=response.wallMs;timing.requests++;complete(response.body);pitId=response.body.pit_id??pitId;
      const hits=response.body.hits.hits;
      const tieThreshold=hits.length?jointTieThreshold(hits.at(-1)._score):null;
      diagnostics.iterations.push({threshold,minScore:body.min_score,hits:hits.length,tieThreshold,wallMs:response.wallMs,took:response.body.took,boundedTotal:response.body.hits.total??null});
      // A full page also needs every document tied with its last float32 score.
      // A cost bound alone can otherwise exclude an earlier ID in that tie bin.
      if(threshold===1||(hits.length===size&&threshold>=tieThreshold)){
        const exhausted=hits.length<size;
        timing.totalMs=performance.now()-started;
        return {hits,pitId,threshold,queryFingerprint,exhausted,next:exhausted?null:{pit:pitId,pitId,threshold,search_after:hits.at(-1).sort,queryFingerprint},diagnostics,timing,...(response.body.profile?{profile:response.body.profile}:{})};
      }
      threshold=hits.length===size?Math.min(1,Math.max(threshold+JOINT_EPSILON,tieThreshold)):Math.min(1,Math.max(1e-6,threshold*2));
    }
  }catch(error){
    if(createdPit&&pitId)await closePit(pitId).catch(()=>{});
    throw error;
  }
}

function featureDocument(id,masses,cohort='even'){
  const features=Object.fromEntries(NATIVE_FAMILIES.map(f=>[f.id,0]));
  features.dark=Math.min(1,masses[1]+masses[3]);features.blue=Math.min(1,masses[2]+masses[3]);
  const unions=Object.fromEntries(JOINT_PAIRS.map(([a,b])=>[unionKey(a,b),a==='blue'&&b==='dark'?Math.min(1,masses[1]+masses[2]+masses[3]):Math.min(1,features[a]+features[b])]));
  return {id,features,unions,cohort,partition:0};
}

export async function probe(){
  const index='color-global-joint-bounded-probe';
  await recreateIndex(index,{...metadataProperties,...NATIVE_PROPERTIES,...JOINT_PROPERTIES},{number_of_shards:3,refresh_interval:'-1'});
  const random=randomGenerator(271828);
  const source=Array.from({length:401},(_,i)=>{
    const weights=Array.from({length:4},()=>random()+.001),total=weights.reduce((a,b)=>a+b,0);
    return featureDocument(`p-${String(i).padStart(4,'0')}`,weights.map(w=>w/total),i<7?'few':i%2?'odd':'even');
  });
  for(let i=0;i<25;i++)source.push(featureDocument(`a-overlap-${String(i).padStart(2,'0')}`,[.6,0,0,.4]));
  source.push(featureDocument('z-disjoint-outside-seed',[.2,.4,.4,0]));
  for(const [id,dark] of [['a-float-worse',.600000015],['z-float-better',.6],['000-next-score-bin',.60000004]])source.push(featureDocument(id,[1-dark,dark,0,0],'float'));
  const mapped=doc=>({...toNativeDocument(doc),...toJointDocument(doc),cohort:doc.cohort,partition:doc.partition});
  await bulk(index,source.map(mapped));await api(`/${index}/_refresh`,{},'POST');
  const pits=new Set(),checks=[];
  const run=async(colors,options={})=>{const result=await boundedJointSearch(index,colors,options);pits.add(result.pitId);return result;};
  const oracle=(colors,mode='target',predicate=()=>true)=>source.filter(predicate).map(d=>({id:d.id,...jointReference(d,colors,{mode})})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const assertPage=(response,expected)=>{
    assert.deepEqual(response.hits.map(h=>h._id),expected.map(d=>d.id));
    assert.deepEqual(response.hits.map(h=>Math.fround(h._score)),expected.map(d=>d.score));
  };
  try{
    const colors=[{family:'dark',amount:.4},{family:'blue',amount:.4}];
    const first=await run(colors,{size:20});
    assertPage(first,oracle(colors).slice(0,20));
    assert.equal(first.diagnostics.seedIds.includes('z-disjoint-outside-seed'),false);
    assert.equal(first.hits[0]._id,'z-disjoint-outside-seed');
    checks.push({name:'Correct joint winner outside marginal token seed is recovered globally',passes:true,threshold:first.threshold});
    for(const mode of ['target','minimum'])for(const [filter,predicate] of [
      [[],()=>true],[[{term:{cohort:'odd'}}],d=>d.cohort==='odd'],[[{term:{cohort:'few'}}],d=>d.cohort==='few'],[[{term:{cohort:'absent'}}],()=>false],
    ]){
      const response=await run(colors,{size:20,mode,filter});
      assertPage(response,oracle(colors,mode,predicate).slice(0,20));
      checks.push({name:'Seeded first page matches full eligible joint oracle',mode,filter,passes:true,hits:response.hits.length});
    }
    const floatColors=[{family:'dark',amount:.4}],filter=[{term:{cohort:'float'}}];
    const floatCase=await run(floatColors,{size:1,threshold:.2,filter});
    assertPage(floatCase,oracle(floatColors,'target',d=>d.cohort==='float').slice(0,1));
    assert.equal(floatCase.hits[0]._id,'a-float-worse');
    assert.ok(floatCase.diagnostics.iterations.length>1);
    checks.push({name:'Cost outside initial threshold but tied float32 score keeps earlier id',passes:true,iterations:floatCase.diagnostics.iterations});
    const nextFloat=await run(floatColors,{size:1,filter,...floatCase.next});
    assertPage(nextFloat,oracle(floatColors,'target',d=>d.cohort==='float').slice(1,2));
    checks.push({name:'Float32 score ties paginate by id without omission',passes:true});
    for(const mode of ['target','minimum']){
      const expected=oracle(colors,mode);
      let current=await run(colors,{size:17,mode,threshold:0}),all=[],pages=0,widenings=0;
      for(;;){
        assertPage(current,expected.slice(all.length,all.length+17));
        all.push(...current.hits.map(h=>h._id));pages++;widenings+=current.diagnostics.iterations.length-1;
        if(current.exhausted)break;
        assert.ok(pages<100);
        current=await run(colors,{size:17,mode,...current.next});
      }
      assert.deepEqual(all,expected.map(d=>d.id));assert.equal(new Set(all).size,source.length);
      checks.push({name:'Threshold-zero pagination covers complete global joint order',mode,passes:true,documents:all.length,pages,widenings});
    }
    const snapshotColors=[{family:'dark',amount:.3333},{family:'blue',amount:.2222}];
    const snapshot=await run(snapshotColors,{size:20});
    const inserted=featureDocument('000-inserted-joint-best',[.4445,.3333,.2222,0]);
    await bulk(index,[mapped(inserted)]);await api(`/${index}/_refresh`,{},'POST');
    const old=await run(snapshotColors,{size:20,pit:snapshot.pitId,threshold:snapshot.threshold});
    assertPage(old,oracle(snapshotColors).slice(0,20));
    const fresh=await run(snapshotColors,{size:20});assert.equal(fresh.hits[0]._id,inserted.id);
    checks.push({name:'PIT excludes new perfect joint match until a new snapshot',passes:true});
    await assert.rejects(()=>boundedJointSearch(index,colors,{search_after:[.8,'id']}),/PIT/);
    await assert.rejects(()=>boundedJointSearch(index,colors,{pit:first.pitId,queryFingerprint:'wrong'}),/different joint query/);
    checks.push({name:'Unsafe joint cursor reuse rejected',passes:true});
    const output={generatedAt:new Date().toISOString(),version:(await api('/')).body.version,documents:source.length,shards:3,checks,exampleDiagnostics:first.diagnostics,exampleTiming:first.timing,limitations:['Exact global float32 score/id order for indexed hard-membership joint model with at most two families.','Fixed families and sampled pixels remain model limitations.','Correctness probe is not a production performance benchmark.']};
    await saveJson('global-joint-bounded-probe.json',output);
    console.log(JSON.stringify({documents:source.length,checks:checks.length,allPassed:true,pagination:checks.filter(c=>c.pages),exampleTiming:first.timing},null,2));
    return output;
  }finally{for(const pitId of pits)await closePit(pitId);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv.includes('--probe'))await probe();
