// Offline descriptor/index preparation. Query-time scoring uses native rank_feature clauses.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir,readFile,writeFile,copyFile } from 'node:fs/promises';
import { rgbToLab } from './corpus-colors.mjs';
import { PRECISION_GRID,precisionGridKey,buildPrecisionGridQuery,precisionPaletteScore,gridDocumentScore } from './methods-precision-grid.mjs';
import { buildPrecisionTypedQuery } from './methods-precision-typed.mjs';
import { interpretQuery } from './query.mjs';
import { api,bulkIndex,finishIndex,loadFeatures,loadExpandedCorpus,searchIndex,safeIndexName,STORE,CORPUS_STORE,INDEX,hash } from './service.mjs';

export const PRECISION_GRID_INDEX='color-exploration-precision-grid-real-v1';
export const PRECISION_GRID_SOURCE_FILES=['methods-precision-grid.mjs','precision-grid-index.mjs','corpus-colors.mjs','query.mjs','methods-precision-typed.mjs','methods-direct-palette.mjs'];
export const PRECISION_GRID_DEFINITION=Object.freeze({...PRECISION_GRID,encoder:'Sparse per-RGB anchor contribution accumulation over actual RGB24 palette counts; exact anchor objective before u8 rounding.',cache:'Original RGB entries can be pinned; other RGB contributions use a bounded FIFO cache.'});
const KEYS=Array.from({length:PRECISION_GRID.anchorCount},(_,index)=>precisionGridKey(index));

export function createPrecisionGridEncoder({pinnedRgb=[],tailCacheLimit=8192}={}){
  if(!Number.isSafeInteger(tailCacheLimit)||tailCacheLimit<0)throw Error('Invalid RGB contribution cache limit');
  const pinned=new Set(pinnedRgb),originalCache=new Map(),tailCache=new Map(),areas=new Float64Array(PRECISION_GRID.anchorCount),qualities=new Float64Array(PRECISION_GRID.anchorCount),touched=[];
  let cacheHits=0,rgbCalculations=0,distanceCalculations=0,documents=0;
  function contributions(rgb){
    const cached=originalCache.get(rgb)??tailCache.get(rgb);if(cached){cacheHits++;return cached;}
    rgbCalculations++;
    const lab=rgbToLab([(rgb>>16)/255,((rgb>>8)&255)/255,(rgb&255)/255]);
    const bounds=lab.map((value,axis)=>[Math.max(0,Math.ceil((value-PRECISION_GRID.radius*(1+1e-9)-PRECISION_GRID.minimum[axis])/PRECISION_GRID.step[axis])),Math.min(16,Math.floor((value+PRECISION_GRID.radius*(1+1e-9)-PRECISION_GRID.minimum[axis])/PRECISION_GRID.step[axis]))]);
    const indexes=[],weights=[];
    for(let l=bounds[0][0];l<=bounds[0][1];l++)for(let a=bounds[1][0];a<=bounds[1][1];a++)for(let b=bounds[2][0];b<=bounds[2][1];b++){
      const dl=lab[0]-l*PRECISION_GRID.step[0],da=lab[1]-(PRECISION_GRID.minimum[1]+a*PRECISION_GRID.step[1]),db=lab[2]-(PRECISION_GRID.minimum[2]+b*PRECISION_GRID.step[2]);
      distanceCalculations++;const normalized=Math.sqrt(dl*dl+da*da+db*db)/PRECISION_GRID.radius;
      if(normalized<=1+1e-9){indexes.push(l*289+a*17+b);weights.push(1-(1-PRECISION_GRID.edgeWeight)*Math.min(1,normalized));}
    }
    const result={indexes:Uint16Array.from(indexes),weights:Float64Array.from(weights)};
    if(pinned.has(rgb))originalCache.set(rgb,result);
    else if(tailCacheLimit){if(tailCache.size>=tailCacheLimit)tailCache.delete(tailCache.keys().next().value);tailCache.set(rgb,result);}
    return result;
  }
  return {
    encode(feature){
      const total=feature.palette_total;
      if(!feature.id||!(total>0)||!Array.isArray(feature.palette32_packed)||feature.palette32_packed.length>32)throw Error('ID and valid packed Palette32 required');
      if(feature.palette32_packed.reduce((sum,value)=>sum+value%65536,0)!==total)throw Error('Palette counts do not match total');
      const utilities={};
      try{
        for(const packed of feature.palette32_packed){
          if(!Number.isSafeInteger(packed)||packed<0||packed>=16777216*65536||packed%65536===0)throw Error('Invalid RGB24 packed palette count');
          const rgb=Math.floor(packed/65536),count=packed%65536,{indexes,weights}=contributions(rgb);
          for(let i=0;i<indexes.length;i++){
            const index=indexes[i];if(areas[index]===0)touched.push(index);
            areas[index]+=count;qualities[index]+=count*weights[i];
          }
        }
        for(const index of touched){const utility=Math.round(PRECISION_GRID.quantization*qualities[index]/Math.max(areas[index],total*PRECISION_GRID.minimumSupport));if(utility>0)utilities[KEYS[index]]=utility;}
      }finally{for(const index of touched){areas[index]=0;qualities[index]=0;}touched.length=0;}
      documents++;
      return {id:feature.id,reference_id:feature.reference_id??feature.id,cohort:feature.cohort??'real',partition:feature.partition??0,tags:feature.tags??[],utilities};
    },
    stats(){return {documents,cacheHits,rgbCalculations,distanceCalculations,originalCacheSize:originalCache.size,tailCacheSize:tailCache.size,tailCacheLimit};},
  };
}
const defaultEncoder=createPrecisionGridEncoder();
export const toPrecisionGridDocument=(feature,{encoder=defaultEncoder}={})=>encoder.encode(feature);
export function precisionGridMapping({source=false,shards=1}={}){
  return {settings:{number_of_shards:shards,number_of_replicas:0,refresh_interval:'-1'},mappings:{_source:{enabled:source},properties:{id:{type:'keyword'},reference_id:{type:'keyword'},cohort:{type:'keyword'},partition:{type:'integer'},tags:{type:'keyword'},utilities:{type:'rank_features',positive_score_impact:true}}}};
}
export async function precisionGridFingerprints(){
  return {descriptorHash:hash(await readFile(path.join(CORPUS_STORE,'features.jsonl'))),definitionHash:hash(PRECISION_GRID_DEFINITION),sourceHashes:Object.fromEntries(await Promise.all(PRECISION_GRID_SOURCE_FILES.map(async name=>[name,hash(await readFile(new URL(name,import.meta.url)))])))};
}
export async function validatePrecisionGridIndex({index=PRECISION_GRID_INDEX,expectedIds}={}){
  safeIndexName(index);const ids=expectedIds??(await loadExpandedCorpus()).map(asset=>asset.id);
  if(!ids.length||new Set(ids).size!==ids.length||ids.length>10000)throw Error('Expected complete unique real corpus IDs, at most10000');
  const fingerprints=await precisionGridFingerprints();
  const mapping=(await api(index+'/_mapping')).body[index]?.mappings;
  if(mapping?._meta?.descriptorHash!==fingerprints.descriptorHash||mapping?._meta?.definitionHash!==fingerprints.definitionHash)throw Error('Precision-grid index descriptor/objective fingerprint mismatch');
  const response=(await api(index+'/_search',{method:'POST',body:{size:ids.length,_source:false,track_total_hits:true,sort:[{id:'asc'}],query:{match_all:{}}}})).body;
  if(response.timed_out||response._shards?.failed)throw Error('Precision-grid ID validation returned partial results');
  const actual=response.hits.hits.map(hit=>hit._id).sort(),expected=[...ids].sort();
  if(response.hits.total?.value!==ids.length||JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Precision-grid index does not contain exactly the expected corpus IDs');
  return {index,count:actual.length,completeIdsVerified:true,...fingerprints,indexMetadata:mapping._meta,definition:PRECISION_GRID_DEFINITION};
}
export async function preparePrecisionGridIndex(index=PRECISION_GRID_INDEX){
  const features=await loadFeatures(),corpus=await loadExpandedCorpus(),assets=new Map(corpus.map(asset=>[asset.id,asset]));
  if(features.length!==corpus.length||new Set(features.map(feature=>feature.id)).size!==corpus.length||features.some(feature=>!assets.has(feature.id)))throw Error('Grid corpus/feature IDs differ');
  const fingerprints=await precisionGridFingerprints(),mapping=precisionGridMapping();
  mapping.mappings._meta={experiment:'precision-grid',...fingerprints,definition:PRECISION_GRID_DEFINITION};
  const sourceDirectory=path.join(STORE,index+'-sources',hash(fingerprints.sourceHashes).slice(0,16));await mkdir(sourceDirectory,{recursive:true});
  for(const name of PRECISION_GRID_SOURCE_FILES)await copyFile(fileURLToPath(new URL(name,import.meta.url)),path.join(sourceDirectory,name));
  const encoder=createPrecisionGridEncoder({pinnedRgb:features.flatMap(feature=>feature.palette32_packed.map(value=>Math.floor(value/65536)))}),started=performance.now();let positiveUtilities=0;
  await api(safeIndexName(index),{method:'PUT',body:mapping});
  for(let offset=0;offset<features.length;offset+=25){
    const documents=features.slice(offset,offset+25).map(feature=>encoder.encode({...assets.get(feature.id),...feature}));
    positiveUtilities+=documents.reduce((sum,document)=>sum+Object.keys(document.utilities).length,0);await bulkIndex(index,documents);
  }
  await finishIndex(index);
  const validation=await validatePrecisionGridIndex({index,expectedIds:features.map(feature=>feature.id)});
  const result={schemaVersion:1,...validation,createdAt:new Date().toISOString(),indexMs:performance.now()-started,positiveUtilities,meanUtilities:positiveUtilities/features.length,encoder:encoder.stats(),sourceDirectory,version:(await api('')).body.version,stats:(await api(index+'/_stats/store,docs,segments')).body._all};
  await mkdir(STORE,{recursive:true});await writeFile(path.join(STORE,index+'.json'),JSON.stringify(result,null,2));return result;
}

export const PRECISION_GRID_DIAGNOSTIC_COLORS=['#ff2200','#4c8c72','#101010','#808080','#dd6600','#8030b0','#20b8d0','#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#ff80b0','#72563d','#d0d7e0','#304055'];
/** Service parity + representation-loss diagnostics; never part of a user search. */
export async function diagnosePrecisionGrid({index=PRECISION_GRID_INDEX,referenceIndex=INDEX,colors=PRECISION_GRID_DIAGNOSTIC_COLORS}={}){
  const features=await loadFeatures(),validation=await validatePrecisionGridIndex({index,expectedIds:features.map(feature=>feature.id)});
  const encoder=createPrecisionGridEncoder({pinnedRgb:features.flatMap(feature=>feature.palette32_packed.map(value=>Math.floor(value/65536)))}),documents=new Map(features.map(feature=>[feature.id,encoder.encode(feature)]));
  const percentile=(values,fraction)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*fraction)-1)]??null;
  const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  const queries=[];
  for(const color of colors){
    const query={swatchHex:color},lab=interpretQuery(query).targets[0].lab;
    const grid=await searchIndex(index,buildPrecisionGridQuery({query,limit:features.length}));
    const exact=await searchIndex(referenceIndex,buildPrecisionTypedQuery({query,limit:features.length}));
    if(grid.hits.length!==features.length||exact.hits.length!==features.length)throw Error('Precision diagnostic needs every corpus document from both services');
    const gridScores=new Map(grid.hits.map(hit=>[hit.id,hit.score])),exactScores=new Map(exact.hits.map(hit=>[hit.id,hit.score]));
    let gridServiceError=0,exactServiceError=0,maximumDifference=0,worstId=null;const errors=[],activeErrors=[],signed=[];
    for(const feature of features){
      const expectedGrid=gridDocumentScore(documents.get(feature.id),query),expectedExact=precisionPaletteScore(feature,lab);
      const actualGrid=gridScores.get(feature.id),actualExact=exactScores.get(feature.id);
      if(actualGrid==null||actualExact==null)throw Error('Missing diagnostic image ID');
      gridServiceError=Math.max(gridServiceError,Math.abs(actualGrid-expectedGrid));exactServiceError=Math.max(exactServiceError,Math.abs(actualExact-expectedExact));
      const delta=actualGrid-PRECISION_GRID.baseScore-actualExact,error=Math.abs(delta);errors.push(error);signed.push(delta);
      if(actualGrid>.05||actualExact>.05)activeErrors.push(error);
      if(error>maximumDifference){maximumDifference=error;worstId=feature.id;}
    }
    if(gridServiceError>3e-7||exactServiceError>3e-7)throw Error('Native score parity failure: grid='+gridServiceError+', exact='+exactServiceError);
    const gridTop=grid.hits.slice(0,20),exactTop=exact.hits.slice(0,20),exactIds=new Set(exactTop.map(hit=>hit.id)),cutoff=exactTop.at(-1).score;
    queries.push({color,documents:features.length,gridServiceError,exactServiceError,meanAbsoluteScoreError:mean(errors),meanActiveAbsoluteScoreError:mean(activeErrors),p95AbsoluteScoreError:percentile(errors,.95),maximumAbsoluteScoreError:maximumDifference,worstId,meanSignedScoreError:mean(signed),top20Recall:gridTop.filter(hit=>exactIds.has(hit.id)).length/20,top20AtExactCutoff:gridTop.filter(hit=>exactScores.get(hit.id)>=cutoff-1e-7).length/20,exactTop20Cutoff:cutoff,meanTop20UtilityLoss:Math.max(0,mean(exactTop.map(hit=>hit.score))-mean(gridTop.map(hit=>exactScores.get(hit.id)))),top1UtilityLoss:Math.max(0,exactTop[0].score-exactScores.get(gridTop[0].id)),gridTop20:gridTop,exactTop20:exactTop,gridEvidence:grid.evidence,exactEvidence:exact.evidence});
  }
  const result={schemaVersion:1,createdAt:new Date().toISOString(),index,referenceIndex,validation,definition:PRECISION_GRID_DEFINITION,queryCount:queries.length,summary:{maxGridServiceError:Math.max(...queries.map(row=>row.gridServiceError)),maxExactServiceError:Math.max(...queries.map(row=>row.exactServiceError)),meanTop20Recall:mean(queries.map(row=>row.top20Recall)),meanTop20AtExactCutoff:mean(queries.map(row=>row.top20AtExactCutoff)),meanTop20UtilityLoss:mean(queries.map(row=>row.meanTop20UtilityLoss)),maximumAbsoluteScoreError:Math.max(...queries.map(row=>row.maximumAbsoluteScoreError))},queries,
    limitations:['These are objective/representation diagnostics, not new human relevance judgments.','Top20 strict recall is sensitive to tied scores; exact-cutoff utility coverage is included separately.','The direct palette objective itself is a prototype using a lossy32-color representation.']};
  await mkdir(STORE,{recursive:true});await writeFile(path.join(STORE,index+'-diagnostics.json'),JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),diagnostic=args.includes('--diagnose');
  const result=diagnostic?await diagnosePrecisionGrid():await preparePrecisionGridIndex(args[0]??PRECISION_GRID_INDEX);
  console.log(JSON.stringify(diagnostic?{...result,queries:undefined}:result,null,2));
}
