import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir,writeFile } from 'node:fs/promises';
import { FEATURE_NAMES } from './corpus-colors.mjs';
import { utilityKey,vibeKey } from './methods-rank-features.mjs';
import { api,bulkIndex,finishIndex,loadFeatures,loadExpandedCorpus,safeIndexName,STORE,hash } from './service.mjs';
export const RANK_FEATURE_INDEX='color-exploration-rank-feature-real-v1';
export const RANK_FEATURE_DEFINITION=Object.freeze({
  version:1,families:FEATURE_NAMES,areaBucketPercent:1,targetGridPercent:1,maximumFeaturesPerDocument:FEATURE_NAMES.length*102,
  targetUtility:'100−abs(round(area*100)−targetPercentBucket), integer0..100; zero features omitted',
  vibeUtility:'round(255*area^0.65*quality), integer0..255; zero features omitted',
  interpolation:'Linear interpolation of adjacent1% target profiles is exact for1%-quantized document areas, including fractional query percentages.',
  representation:'Integers1..255 are exactly representable with9significant bits; this avoids additional rank_feature precision loss.',
  limits:['No arbitrary color/range profiles.','No joint outside-palette penalty or accent-product model.','Global monochromatic/rainbow inputs are descriptor strengths, not literal areas.'],
});
const PROFILE_KEYS=Object.fromEntries(FEATURE_NAMES.map(name=>[name,Array.from({length:101},(_,bucket)=>utilityKey(name,bucket))]));
export function toRankFeatureDocument(feature){
  const utilities={};
  for(const name of FEATURE_NAMES){
    const area=feature.features?.[name]?.area??(feature[`cov_${name}`]??0)/10000;
    const quality=feature.features?.[name]?.quality??feature[`quality_${name}`]??0;
    if(!Number.isFinite(area)||area<0||area>1+1e-12||!Number.isFinite(quality)||quality<0||quality>1+1e-12)throw Error(`Invalid named feature: ${name}`);
    const actual=Math.round(area*100),keys=PROFILE_KEYS[name];
    for(let target=0;target<=100;target++){const utility=100-Math.abs(actual-target);if(utility>0)utilities[keys[target]]=utility;}
    const vibe=Math.round(255*Math.pow(area,.65)*quality);if(vibe>0)utilities[vibeKey(name)]=vibe;
  }
  return {id:feature.id,reference_id:feature.reference_id??feature.id,cohort:feature.cohort??'real',partition:feature.partition??0,utilities};
}
export function rankFeatureMapping({source=true,shards=1}={}){
  return {settings:{number_of_shards:shards,number_of_replicas:0,refresh_interval:'-1'},mappings:{_source:{enabled:source},properties:{
    id:{type:'keyword'},reference_id:{type:'keyword'},cohort:{type:'keyword'},partition:{type:'integer'},utilities:{type:'rank_features',positive_score_impact:true},
  }}};
}
export async function prepareRankFeatureIndex(index=RANK_FEATURE_INDEX){
  const features=await loadFeatures(),corpus=await loadExpandedCorpus();
  if(features.length!==corpus.length)throw Error('Expanded corpus/feature mismatch');
  const started=performance.now();
  // Fail if present: existing experiments are never replaced.
  await api(safeIndexName(index),{method:'PUT',body:rankFeatureMapping()});
  let positiveFeatures=0;
  for(let start=0;start<features.length;start+=25){
    const documents=features.slice(start,start+25).map(toRankFeatureDocument);
    positiveFeatures+=documents.reduce((sum,doc)=>sum+Object.keys(doc.utilities).length,0);
    await bulkIndex(index,documents);
  }
  const count=await finishIndex(index);if(count!==features.length)throw Error('Incomplete rank-feature index');
  const metadata={schemaVersion:1,index,count,createdAt:new Date().toISOString(),indexMs:performance.now()-started,positiveFeatures,averageFeatures:positiveFeatures/count,definition:RANK_FEATURE_DEFINITION,sourceHash:hash(corpus.map(a=>({id:a.id,sha256:a.sha256}))),version:(await api('')).body.version,stats:(await api(index+'/_stats/store,docs')).body._all};
  await mkdir(STORE,{recursive:true});await writeFile(path.join(STORE,index+'.json'),JSON.stringify(metadata,null,2));return metadata;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepareRankFeatureIndex(process.argv[2]),null,2));
