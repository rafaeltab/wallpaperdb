// THROWAWAY PROTOTYPE: exact global fine-area ranking with certified indexed bounds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { api, bulk, recreateIndex, saveJson, metadataProperties } from './global-common.mjs';
import { NATIVE_PROPERTIES, toNativeDocument, normalizeNativeQuery, nativeQuery, tokenQuery, nativeReference } from './global-native.mjs';

const validIndex=index=>{
  if(typeof index!=='string'||!/^color-global-[a-z0-9_-]+$/.test(index))throw new Error('Only a named color-global- scratch index is allowed.');
};
const complete=response=>{
  if(response.timed_out||response._shards?.failed>0)throw new Error('A partial or timed-out search cannot certify global results.');
};

export async function openPit(index,keepAlive='2m'){
  validIndex(index);
  const response=await api(`/${index}/_search/point_in_time?keep_alive=${encodeURIComponent(keepAlive)}&allow_partial_pit_creation=false`,{},'POST');
  complete(response.body);
  if(typeof response.body.pit_id!=='string')throw new Error('OpenSearch did not return a PIT id.');
  return {pitId:response.body.pit_id,wallMs:response.wallMs};
}

export async function closePit(pitId){
  if(typeof pitId!=='string'||!pitId)throw new Error('A PIT id is required.');
  return (await api('/_search/point_in_time',{pit_id:[pitId]},'DELETE')).body;
}

/**
 * Returns a globally exact next page for the indexed fine marginal-L1 objective.
 * Caller owns the returned PIT and must keep query/filter/cursor together.
 * Threshold is a starting hint only; even a deliberately undersized hint is safe.
 */
export async function boundedSearch(index,input,options={}){
  validIndex(index);
  const started=performance.now();
  const colors=normalizeNativeQuery(input);
  const size=options.size??20;
  if(!Number.isInteger(size)||size<1||size>10000)throw new Error('Page size must be an integer from 1 to 10000.');
  if(options.qualityTieBreak)throw new Error('Bounded prototype supports area score and id ordering only.');
  if(options.from!==undefined)throw new Error('Use search_after for bounded pagination.');
  const filter=options.filter??[];
  if(!Array.isArray(filter))throw new Error('filter must be an array of native query clauses.');
  const queryFingerprint=createHash('sha256').update(JSON.stringify({index,colors,filter})).digest('hex');
  if(options.queryFingerprint&&options.queryFingerprint!==queryFingerprint)throw new Error('Cursor belongs to a different query or metadata filter.');
  const maximumThreshold=colors.length*10000;
  if(maximumThreshold>=2**24)throw new Error('Integer score would exceed exact float32 range.');
  if(options.threshold!==undefined&&(!Number.isInteger(options.threshold)||options.threshold<0))throw new Error('Threshold must be a nonnegative integer fine-area error.');
  const cursor=options.search_after;
  if(cursor!==undefined&&(!Array.isArray(cursor)||cursor.length<2||!Number.isInteger(cursor[0])||cursor[0]<0||cursor[0]>maximumThreshold||typeof cursor[1]!=='string'))throw new Error('search_after must be a returned fine score/id sort cursor.');
  const suppliedPit=typeof options.pit==='string'?options.pit:options.pit?.id;
  if(cursor&&!suppliedPit)throw new Error('Pagination requires the PIT returned with the previous page.');
  const keepAlive=typeof options.pit==='object'?(options.pit.keep_alive??'2m'):(options.keep_alive??'2m');
  let pitId=suppliedPit,createdPit=false;
  const timing={pitMs:0,seedMs:0,finalMs:0,totalMs:0,requests:0};
  const diagnostics={seedCount:null,seedThreshold:null,seedIds:[],iterations:[],maximumThreshold,eligibleTotalKnown:false};
  try{
    if(!pitId){const opened=await openPit(index,keepAlive);pitId=opened.pitId;createdPit=true;timing.pitMs=opened.wallMs;timing.requests++;}
    let threshold=options.threshold===undefined?undefined:Math.min(maximumThreshold,options.threshold);
    if(threshold===undefined){
      const seed=tokenQuery(colors,{size,filter,pit:{id:pitId,keep_alive:keepAlive},stableSort:true,_source:false,track_total_hits:false});
      seed.timeout=options.timeout??'15s';
      seed.docvalue_fields=colors.map(c=>`fine_${c.family}`);
      const response=await api('/_search?allow_partial_search_results=false',seed);
      timing.seedMs+=response.wallMs;timing.requests++;complete(response.body);
      pitId=response.body.pit_id??pitId;
      const hits=response.body.hits.hits;
      diagnostics.seedCount=hits.length;
      diagnostics.seedIds=hits.map(hit=>hit._id);
      const errors=hits.map(hit=>colors.reduce((sum,c)=>{
        const value=hit.fields?.[`fine_${c.family}`]?.[0];
        if(!Number.isInteger(value)||value<0||value>10000)throw new Error('Seed document lacks a valid fine coverage field.');
        return sum+Math.abs(value-Math.round(c.amount*10000));
      },0));
      threshold=hits.length<size?maximumThreshold:Math.max(...errors);
      diagnostics.seedThreshold=threshold;
    }
    for(;;){
      const bounds=colors.map(c=>({range:{[`fine_${c.family}`]:{gte:Math.max(0,Math.round(c.amount*10000)-threshold),lte:Math.min(10000,Math.round(c.amount*10000)+threshold)}}}));
      const body=nativeQuery(colors,{size,filter:[...filter,...bounds],precision:'fine',pit:{id:pitId,keep_alive:keepAlive},search_after:cursor,stableSort:true,_source:options._source??false,track_total_hits:options.track_total_hits??false,profile:options.profile??false});
      body.min_score=maximumThreshold-threshold;
      body.timeout=options.timeout??'15s';
      const response=await api('/_search?allow_partial_search_results=false',body);
      timing.finalMs+=response.wallMs;timing.requests++;complete(response.body);
      pitId=response.body.pit_id??pitId;
      const hits=response.body.hits.hits;
      diagnostics.iterations.push({threshold,minScore:body.min_score,hits:hits.length,wallMs:response.wallMs,took:response.body.took,boundedTotal:response.body.hits.total??null});
      if(hits.length===size||threshold===maximumThreshold){
        const exhausted=hits.length<size;
        const searchAfter=hits.at(-1)?.sort??cursor??null;
        timing.totalMs=performance.now()-started;
        return {hits,pitId,threshold,queryFingerprint,exhausted,next:exhausted?null:{pit:pitId,pitId,threshold,search_after:searchAfter,queryFingerprint},diagnostics,timing,...(response.body.profile?{profile:response.body.profile}:{})};
      }
      threshold=Math.min(maximumThreshold,Math.max(1,threshold*2));
    }
  }catch(error){
    if(createdPit&&pitId)await closePit(pitId).catch(()=>{});
    throw error;
  }
}

export async function probe(){
  const index='color-global-bounded-probe';
  await recreateIndex(index,{...metadataProperties,...NATIVE_PROPERTIES},{number_of_shards:3,refresh_interval:'-1'});
  const source=Array.from({length:401},(_,i)=>({id:`p-${String(i).padStart(4,'0')}`,features:{red:((i*23)%10001)/10000,green:((i*41)%10001)/10000,dark:1-((i*23)%10001)/10000},cohort:i<7?'few':i%2?'odd':'even',partition:i%3}));
  for(let i=0;i<25;i++)source.push({id:`a-coarse-away-${String(i).padStart(2,'0')}`,features:{red:.7049,green:.2,dark:.2951},cohort:'even',partition:0});
  source.push(
    {id:'z-exact-outside-seed',features:{red:.7,green:.2,dark:.3},cohort:'even',partition:0},
    {id:'a-inclusive-left',features:{red:.6999,green:.2,dark:.3001},cohort:'even',partition:0},
    {id:'b-inclusive-right',features:{red:.7001,green:.2,dark:.2999},cohort:'even',partition:0},
  );
  await bulk(index,source.map(d=>({...toNativeDocument(d),cohort:d.cohort,partition:d.partition})));
  await api(`/${index}/_refresh`,{},'POST');
  const pits=new Set();
  const run=async(colors,options={})=>{const result=await boundedSearch(index,colors,options);pits.add(result.pitId);return result;};
  const oracle=(colors,predicate=()=>true)=>source.filter(predicate).map(doc=>({id:doc.id,...nativeReference(doc,colors,{precision:'fine'})})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const assertPage=(response,expected)=>{
    assert.deepEqual(response.hits.map(h=>h._id),expected.map(d=>d.id));
    assert.deepEqual(response.hits.map(h=>h._score),expected.map(d=>d.score));
  };
  const checks=[];
  try{
    const red=[{family:'red',amount:.7}];
    const first=await run(red,{size:20});
    assertPage(first,oracle(red).slice(0,20));
    assert.equal(first.diagnostics.seedIds.includes('z-exact-outside-seed'),false);
    assert.equal(first.hits[0]._id,'z-exact-outside-seed');
    checks.push({name:'Fine global winner absent from coarse seed is recovered',passes:true,threshold:first.threshold,seedCount:first.diagnostics.seedCount});
    for(const [colors,predicate,filter] of [
      [[{family:'red',amount:.4},{family:'green',amount:.6}],()=>true,[]],
      [[{family:'red',amount:.3333},{family:'dark',amount:.6667}],d=>d.cohort==='odd',[{term:{cohort:'odd'}}]],
      [[{family:'red',amount:0}],d=>d.cohort==='few',[{term:{cohort:'few'}}]],
      [[{family:'red',amount:1}],()=>false,[{term:{cohort:'absent'}}]],
    ]){
      const response=await run(colors,{size:20,filter});
      assertPage(response,oracle(colors,predicate).slice(0,20));
      checks.push({name:'Seeded first page agrees with complete eligible oracle',colors,filter,passes:true,hits:response.hits.length,threshold:response.threshold});
    }
    const inclusive=await run(red,{size:3,threshold:1});
    assertPage(inclusive,oracle(red).slice(0,3));
    assert.equal(inclusive.diagnostics.iterations.length,1);
    assert.equal(inclusive.hits.filter(h=>h._score===9999).length,2);
    checks.push({name:'min_score and range endpoints retain exact threshold ties',passes:true,threshold:1});
    const tiny=await run(red,{size:20,threshold:0});
    assertPage(tiny,oracle(red).slice(0,20));
    assert.ok(tiny.diagnostics.iterations.length>1);
    checks.push({name:'Undersized initial threshold widens before returning a page',passes:true,thresholds:tiny.diagnostics.iterations.map(i=>i.threshold)});
    const paginationColors=[{family:'red',amount:.4},{family:'green',amount:.6}];
    const expected=oracle(paginationColors);
    let current=await run(paginationColors,{size:17,threshold:0}),collected=[],pages=0,widenings=0;
    for(;;){
      const offset=collected.length;
      assertPage(current,expected.slice(offset,offset+17));
      collected.push(...current.hits.map(h=>h._id));pages++;widenings+=current.diagnostics.iterations.length-1;
      if(current.exhausted)break;
      assert.ok(pages<100);
      current=await run(paginationColors,{size:17,...current.next});
    }
    assert.deepEqual(collected,expected.map(d=>d.id));assert.equal(new Set(collected).size,source.length);
    checks.push({name:'All documents paginate exactly once in global fine order',passes:true,documents:collected.length,pages,widenings});
    const snapshotColors=[{family:'red',amount:.3333}];
    const snapshot=await run(snapshotColors,{size:20});
    const inserted={id:'000-inserted-exact-best',features:{red:.3333},cohort:'even',partition:0};
    await bulk(index,[{...toNativeDocument(inserted),cohort:inserted.cohort,partition:0}]);
    await api(`/${index}/_refresh`,{},'POST');
    const sameSnapshot=await run(snapshotColors,{size:20,pit:snapshot.pitId,threshold:snapshot.threshold});
    assertPage(sameSnapshot,oracle(snapshotColors).slice(0,20));
    assert.equal(sameSnapshot.hits.some(h=>h._id===inserted.id),false);
    const fresh=await run(snapshotColors,{size:20});
    assert.equal(fresh.hits[0]._id,inserted.id);
    checks.push({name:'PIT excludes a newly inserted global best; new PIT includes it',passes:true});
    await assert.rejects(()=>boundedSearch(index,red,{search_after:[9999,'id']}),/PIT/);
    await assert.rejects(()=>boundedSearch(index,red,{pit:first.pitId,queryFingerprint:'wrong'}),/different query/);
    checks.push({name:'Unsafe cursor reuse is rejected',passes:true});
    const output={generatedAt:new Date().toISOString(),version:(await api('/')).body.version,documentsBeforeConcurrentInsert:source.length,shards:3,checks,exampleDiagnostics:{seeded:first.diagnostics,widened:tiny.diagnostics},timingExample:first.timing,limitations:['Exactness is for fine indexed independent-family L1, not full-resolution pixels or joint transport.','This probe checks correctness, not production speed.','Bounded hit totals are not original metadata-eligible totals.']};
    await saveJson('global-bounded-probe.json',output);
    console.log(JSON.stringify({documents:source.length,checks:checks.length,allPassed:true,pagination:checks.find(c=>c.pages),exampleTiming:first.timing},null,2));
    return output;
  }finally{for(const pitId of pits)await closePit(pitId);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv.includes('--probe'))await probe();
