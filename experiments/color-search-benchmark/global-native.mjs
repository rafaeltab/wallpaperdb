// THROWAWAY PROTOTYPE: globally rank fixed color-family area using native OpenSearch queries.
// Fixed marginal family areas are a different model from joint pixel transport.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { api, bulk, recreateIndex, saveJson, metadataProperties } from './global-common.mjs';

const family=(id,label,color,ranges)=>({id,label,color,ranges});
const hsl=(h,s,l)=>({space:'hsl',h,s,l});
const hsv=(h,s,v)=>({space:'hsv',h,s,v});
// Widths use ranges.mjs semantics: hue is a half-circle fraction, S/L/V absolute fractions.
// Families intentionally overlap (e.g. dark blue belongs to dark and blue).
export const NATIVE_FAMILIES=[
  family('dark','Dark, all hues','#000000',[hsv(1,1,.25)]),
  family('dark_gray','Dark gray, strict neutral','#000000',[hsl(1,.02,.1)]),
  family('grayscale','Grayscale, strict neutral','#000000',[hsl(1,.02,1)]),
  family('black','Near black, neutral','#101010',[hsv(1,.20,.13)]),
  family('gray','Mid gray, neutral','#808080',[hsl(1,.20,.20)]),
  family('white','Near white','#F0F0F0',[hsl(1,.25,.12)]),
  family('red','Red','#E03030',[hsl(.16,.55,.42)]),
  family('orange','Orange','#F08020',[hsl(.13,.55,.35)]),
  family('yellow','Yellow','#F0D030',[hsl(.12,.55,.35)]),
  family('green','Green','#208040',[hsl(.28,.45,.30)]),
  family('teal','Teal','#008080',[hsl(.15,.70,.24)]),
  family('cyan','Cyan','#20C0D0',[hsl(.16,.55,.35)]),
  family('blue','Blue','#2060D0',[hsl(.22,.55,.38)]),
  family('navy','Navy','#102040',[hsl(.20,.50,.15)]),
  family('purple','Purple','#8020C0',[hsl(.22,.55,.35)]),
  family('pink','Pink','#F080B0',[hsl(.18,.65,.24)]),
  family('brown','Brown','#805030',[hsl(.17,.42,.20)]),
  family('cream','Cream','#FFF0C0',[hsl(.18,.90,.15)]),
];
const familyIds=new Set(NATIVE_FAMILIES.map(f=>f.id));
export const NATIVE_PROPERTIES={
  id:{type:'keyword'},
  coverage_tokens:{type:'keyword',norms:false,doc_values:false},
  ...Object.fromEntries(NATIVE_FAMILIES.flatMap(f=>[
    [`cov_${f.id}`,{type:'integer'}],
    [`fine_${f.id}`,{type:'integer'}],
    [`quality_${f.id}`,{type:'integer'}],
  ])),
};
const unit=(value)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
export const coverageBucket=value=>{
  if(!unit(value))throw new Error('Coverage must be a fraction between 0 and 1.');
  return Math.round(value*100);
};

export function toNativeDocument(doc){
  if(typeof doc.id!=='string'||!doc.id)throw new Error('Native documents need a string id.');
  const result={id:doc.id,coverage_tokens:[]};
  for(const f of NATIVE_FAMILIES){
    const coverage=doc.features?.[f.id]??0;
    const bucket=coverageBucket(coverage);
    const qualityMass=doc.qualityMass?.[f.id]??0;
    if(!Number.isFinite(qualityMass)||qualityMass<0||qualityMass>coverage+1e-8)throw new Error(`Invalid quality mass for ${f.id}.`);
    result[`cov_${f.id}`]=bucket;
    result[`fine_${f.id}`]=Math.round(coverage*10000);
    result[`quality_${f.id}`]=coverage>0?Math.round(Math.min(1,qualityMass/coverage)*10000):0;
    result.coverage_tokens.push(`${f.id}:${bucket}`);
  }
  return result;
}

export function normalizeNativeQuery(colors){
  if(!Array.isArray(colors)||!colors.length||colors.length>10)throw new Error('Choose 1–10 fixed color families.');
  const seen=new Set();
  return colors.map(c=>{
    if(!familyIds.has(c.family)||seen.has(c.family))throw new Error('Family names must be known and unique.');
    seen.add(c.family);
    return {family:c.family,amount:c.amount,bucket:coverageBucket(c.amount)};
  });
}

function qualityFamily(colors,options){
  if(!options.qualityTieBreak)return null;
  const id=options.qualityTieBreak===true?(colors.length===1?colors[0].family:null):options.qualityTieBreak;
  if(!familyIds.has(id))throw new Error('Quality tie-break needs one selected family or an explicit family id.');
  return id;
}

function searchBody(query,colors,options){
  const quality=qualityFamily(colors,options);
  const sort=[{_score:'desc'},...(quality?[{[`quality_${quality}`]:'desc'}]:[]),...(options.stableSort===false?[]:[{id:'asc'}])];
  return {
    size:options.size??20,_source:options._source??false,
    track_total_hits:options.track_total_hits??false,
    query,sort,
    ...(options.profile?{profile:true}:{}),
    ...(options.pit?{pit:options.pit}:{}),
    ...(options.search_after?{search_after:options.search_after}:{}),
    ...(options.from!==undefined?{from:options.from}:{}),
  };
}

/** Full search body; native numeric decay, every metadata-matching parent is eligible. */
export function nativeQuery(input,options={}){
  const colors=normalizeNativeQuery(input);
  const {units,prefix}=precision(options);
  const query={function_score:{
    query:{bool:{filter:options.filter??[{match_all:{}}]}},
    functions:colors.map(c=>({linear:{[`${prefix}_${c.family}`]:{origin:Math.round(c.amount*units),scale:units/2,decay:.5,offset:0}},weight:units})),
    score_mode:'sum',boost_mode:'replace',
  }};
  return searchBody(query,colors,options);
}

/** Full search body; integer constant scores on postings, no scripts or candidate reranking. */
export function tokenQuery(input,options={}){
  const colors=normalizeNativeQuery(input);
  const should=colors.flatMap(c=>Array.from({length:101},(_,bucket)=>({constant_score:{
    filter:{term:{coverage_tokens:`${c.family}:${bucket}`}},boost:100-Math.abs(bucket-c.bucket),
  }})));
  const query={bool:{filter:options.filter??[],should,minimum_should_match:1}};
  return searchBody(query,colors,options);
}

function precision(options){
  if(options.precision!==undefined&&!['bucket','fine'].includes(options.precision))throw new Error('Precision must be bucket or fine.');
  return options.precision==='fine'?{units:10000,prefix:'fine'}:{units:100,prefix:'cov'};
}

function reference(doc,input,options={}){
  const colors=normalizeNativeQuery(input);
  const mapped=doc.coverage_tokens?doc:toNativeDocument(doc);
  const {units,prefix}=precision(options);
  const errors=colors.map(c=>Math.abs(mapped[`${prefix}_${c.family}`]-Math.round(c.amount*units)));
  const score=errors.reduce((sum,error)=>sum+units-error,0);
  const quality=qualityFamily(colors,options);
  const secondary=quality?[mapped[`quality_${quality}`]]:[];
  return {score,error:errors.reduce((sum,error)=>sum+error,0)/units,normalizedError:errors.reduce((sum,error)=>sum+error,0)/(units*colors.length),secondary,sort:[score,...secondary,...(options.stableSort===false?[]:[doc.id])]};
}
export const nativeReference=reference;
export const tokenReference=(doc,input,options={})=>reference(doc,input,{...options,precision:'bucket'});

export async function probe(){
  const index='color-global-native-probe';
  const version=(await api('/')).body.version;
  await recreateIndex(index,{...metadataProperties,...NATIVE_PROPERTIES},{number_of_shards:3,refresh_interval:'-1'});
  const source=[];
  for(let red=0;red<=100;red++)for(const green of [0,50,100])source.push({
    id:`probe-${String(red).padStart(3,'0')}-${green}`,
    features:{red:red/100,green:green/100,dark:(100-red)/100},
    qualityMass:{red:(red/100)*(.5+green/200)},cohort:red%2?'odd':'even',partition:red%4,
  });
  for(let i=0;i<31;i++)source.push({id:`fine-${String(i).padStart(3,'0')}`,features:{red:(6900+i*7)/10000,green:(1000+i*11)/10000,dark:(3100-i*7)/10000},qualityMass:{red:0},cohort:'even',partition:0});
  const docs=source.map(d=>({...toNativeDocument(d),cohort:d.cohort,partition:d.partition}));
  await bulk(index,docs);await api(`/${index}/_refresh`,{},'POST');
  const queries=[
    [{family:'red',amount:.7}],
    [{family:'red',amount:0}],
    [{family:'red',amount:1}],
    [{family:'red',amount:.4},{family:'green',amount:.6}],
    [{family:'red',amount:.7},{family:'dark',amount:.3}],
    [{family:'red',amount:.333},{family:'green',amount:.555},{family:'dark',amount:.112}],
  ];
  const checks=[];
  for(const [queryId,colors] of queries.entries())for(const filtered of [false,true])for(const method of ['native','token','native-fine']){
    const filter=filtered?[{term:{cohort:'even'}}]:[];
    const eligible=source.filter(d=>!filtered||d.cohort==='even');
    const options={size:400,filter,stableSort:true,track_total_hits:true,precision:method==='native-fine'?'fine':'bucket'};
    const expected=eligible.map(d=>({id:d.id,...reference(d,colors,options)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    const body=(method==='token'?tokenQuery:nativeQuery)(colors,options);
    const response=(await api(`/${index}/_search`,body)).body;
    assert.equal(response.hits.total.value,expected.length);
    assert.deepEqual(response.hits.hits.map(h=>h._id),expected.map(d=>d.id));
    const deviations=response.hits.hits.map((h,i)=>Math.abs(h._score-expected[i].score));
    assert.equal(Math.max(...deviations),0,'Scores must equal integer utility exactly, including ties');
    checks.push({queryId,method,filtered,documents:expected.length,maxScoreDeviation:0});
  }
  const colors=[{family:'red',amount:.7}];
  const qualityExpected=source.map(d=>({id:d.id,...reference(d,colors,{qualityTieBreak:true})})).sort((a,b)=>b.score-a.score||b.secondary[0]-a.secondary[0]||a.id.localeCompare(b.id));
  const qualityChecks=[];
  for(const method of ['native','token']){
    const body=(method==='native'?nativeQuery:tokenQuery)(colors,{size:400,qualityTieBreak:true});
    const response=(await api(`/${index}/_search`,body)).body;
    assert.deepEqual(response.hits.hits.map(h=>h._id),qualityExpected.map(d=>d.id));
    qualityChecks.push({method,passes:true,top:response.hits.hits.slice(0,3).map(h=>({id:h._id,score:h._score,sort:h.sort}))});
  }
  const profiles={};
  for(const method of ['native','token'])for(const stableSort of [false,true]){
    const body=(method==='native'?nativeQuery:tokenQuery)(queries[3],{size:10,profile:true,stableSort});
    const response=(await api(`/${index}/_search`,body)).body;
    profiles[`${method}-${stableSort?'stable':'score-only'}`]=response.profile;
  }
  let distanceFeatureError;
  try{await api(`/${index}/_search`,{query:{distance_feature:{field:'cov_red',origin:70,pivot:'10'}}});}
  catch(error){distanceFeatureError=String(error.message);}
  assert.ok(distanceFeatureError?.includes('integer')&&distanceFeatureError?.includes('distance_feature'));
  const result={generatedAt:new Date().toISOString(),version,documents:docs.length,families:NATIVE_FAMILIES.length,quantization:'bucket 0..100; fine numeric 0..10000',queryCases:queries,checks,qualityChecks,distanceFeatureError,profiles,notes:[`All ${docs.length} parents are eligible; no application candidate reranking.`,'Native and token scores exactly equal independent integer L1 utility in all complete rankings tested.','Small probe does not establish production speed or prove competitive skipping.']};
  await saveJson('global-native-probe.json',result);
  console.log(JSON.stringify({version,documents:docs.length,checks:checks.length,qualityChecks:qualityChecks.length,exactScoreAgreement:true,distanceFeatureRejected:true},null,2));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv.includes('--probe'))await probe();
