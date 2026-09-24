// Query compilation only. Positive precomputed utilities are scored by Lucene FeatureField.
import { interpretQuery, metadataFilter } from './query.mjs';

export const RANK_FEATURE_BASE_SCORE=1e-6;
export const RANK_FEATURE_METHODS=Object.freeze([
  {id:'rank-features-area',label:'Rank features: indexed target area',family:'rank-features',representation:'named-utility-profiles',approximate:false,profile:'area',limitations:['Image areas are quantized to1% buckets.','Additive target errors do not penalize unrequested colors jointly.','Picked colors, custom ranges, and accent products are unsupported.']},
  {id:'rank-features-vibe',label:'Rank features: target area and perceptual vibe',family:'rank-features',representation:'named-utility-profiles',approximate:false,profile:'vibe',limitations:['Image areas are quantized to1% buckets; vibe utility is quantized to1/255.','Additive target errors do not penalize unrequested colors jointly.','Picked colors, custom ranges, and accent products are unsupported.']},
]);
export function rankFeatureMethod(input='rank-features-vibe'){
  const id=typeof input==='string'?input:input.id;
  const method=RANK_FEATURE_METHODS.find(candidate=>candidate.id===id);
  if(!method)throw Error(`Unknown rank-feature method: ${id}`);return {...method,...(typeof input==='object'?input:{})};
}
export const utilityKey=(name,bucket)=>`area_${name}_${String(bucket).padStart(3,'0')}`;
export const vibeKey=name=>`vibe_${name}`;
export function supportsRankFeatures(methodInput,query){
  const method=rankFeatureMethod(methodInput),compiled=interpretQuery(query);
  if(!compiled.supported)return compiled;
  if(compiled.targets.some(t=>!t.name)||compiled.customRanges)return {supported:false,reason:'Indexed utility profiles require named color or vibe families; arbitrary colors/ranges are unsupported.'};
  if(compiled.special)return {supported:false,reason:'This additive prototype has no joint accent-product or palette-purity profile.'};
  return {supported:true,compiled,warnings:[...method.limitations,'Search is global over stored utility profiles; no fixed candidate subset is reranked.']};
}
export function buildRankFeatureQuery({method:methodInput='rank-features-vibe',query,limit=20,eligibleIds,excludedIds,filter,parameters={}}){
  if(Object.keys(parameters).length)throw Error('Rank-feature utility profiles have fixed indexed parameters; reindex to change them.');
  const method=rankFeatureMethod(methodInput),check=supportsRankFeatures(method,query);
  if(!check.supported)throw Error(check.reason);
  const compiled=check.compiled,clauses=[];
  const add=(key,boost)=>{if(boost>0)clauses.push({rank_feature:{field:`utilities.${key}`,linear:{},boost}});};
  for(const target of compiled.targets){
    if(compiled.mode==='vibe'&&method.profile==='vibe')add(vibeKey(target.name),1/(255*compiled.targets.length));
    else{
      const wanted=compiled.mode==='vibe'?100:Math.min(100,Math.max(0,target.amount*100));
      const low=Math.floor(wanted),high=Math.ceil(wanted),fraction=wanted-low;
      add(utilityKey(target.name,low),(1-fraction)/(100*compiled.targets.length));
      if(high!==low)add(utilityKey(target.name,high),fraction/(100*compiled.targets.length));
    }
  }
  return {size:limit,_source:false,track_total_hits:false,
    query:{bool:{filter:[metadataFilter({eligibleIds,excludedIds,filter,compiled})],
      must:[{constant_score:{filter:{match_all:{}},boost:RANK_FEATURE_BASE_SCORE}}],should:clauses,minimum_should_match:0}},
    sort:[{_score:'desc'},{id:'asc'}]};
}

// Correctness oracle only. Runtime search must use buildRankFeatureQuery in OpenSearch.
export function rankFeatureReference(feature,query,methodInput='rank-features-vibe'){
  const method=rankFeatureMethod(methodInput),check=supportsRankFeatures(method,query);
  if(!check.supported)throw Error(check.reason);
  const {compiled}=check;
  return RANK_FEATURE_BASE_SCORE+compiled.targets.reduce((sum,target)=>{
    const actual=feature.features?.[target.name]?.area??(feature[`cov_${target.name}`]??0)/10000;
    const quality=feature.features?.[target.name]?.quality??feature[`quality_${target.name}`]??0;
    if(compiled.mode==='vibe'&&method.profile==='vibe')return sum+Math.round(Math.pow(actual,.65)*quality*255)/255/compiled.targets.length;
    const bucket=Math.round(actual*100),wanted=compiled.mode==='vibe'?100:target.amount*100;
    return sum+(100-Math.abs(bucket-wanted))/100/compiled.targets.length;
  },0);
}
