// Query compilation only. Document scoring at query time runs in OpenSearch.
import { interpretQuery,metadataFilter } from './query.mjs';
import { rgbToLab } from './corpus-colors.mjs';

export const PRECISION_GRID=Object.freeze({version:1,side:17,anchorCount:4913,minimum:[0,-.4,-.4],maximum:[1,.4,.4],step:[1/16,.8/16,.8/16],radius:.12,edgeWeight:.5,minimumSupport:.05,quantization:255,baseScore:1e-6,
  objective:'qualityMass / max(matchingArea, 0.05), using radius0.12 OKLab and edge quality0.5',
  indexedObjective:'Each anchor evaluates the exact RGB24 palette objective, then rounds255*score to an integer. Query linearly combines up to8 neighboring anchor utilities.',
  retrieval:'Exact global OpenSearch ranking for the quantized/interpolated indexed formula; the continuous palette objective and image pixels are approximated.',
});
const limitations=[
  'Only one picked color with default radius0.12, edge quality0.5 and5% minimum support; proportions and explicit range controls are unsupported.',
  'Trilinear interpolation and integer utility quantization approximate the continuous palette objective. Global retrieval remains exact for that indexed formula.',
  'Palette32 is already a lossy summary of the image. Hard support boundaries can increase interpolation error.',
  'No model is trained; utilities are calculated deterministically from the stored palette.',
];
export const PRECISION_GRID_METHODS=Object.freeze([{id:'rank-features-precision-grid',label:'Native indexed picked-color grid',engine:'opensearch',searchKind:'precision-grid',family:'native-precision-grid',representation:'palette32-oklab-grid17-u8',approximate:false,objectiveApproximation:true,limitations}]);
export const precisionGridKey=index=>'p'+index;
export function precisionGridAnchor(index){
  if(!Number.isSafeInteger(index)||index<0||index>=PRECISION_GRID.anchorCount)throw Error('Invalid precision-grid anchor');
  const indexes=[Math.floor(index/289),Math.floor(index/17)%17,index%17];
  return indexes.map((value,axis)=>PRECISION_GRID.minimum[axis]+value*PRECISION_GRID.step[axis]);
}
export function precisionGridWeights(lab){
  if(!Array.isArray(lab)||lab.length!==3||lab.some((value,axis)=>!Number.isFinite(value)||value<PRECISION_GRID.minimum[axis]-1e-9||value>PRECISION_GRID.maximum[axis]+1e-9))throw Error('Picked color lies outside the fixed OKLab grid');
  const axes=lab.map((value,axis)=>{
    const coordinate=Math.max(0,Math.min(16,(value-PRECISION_GRID.minimum[axis])/PRECISION_GRID.step[axis]));
    const lower=Math.min(15,Math.floor(coordinate)),fraction=coordinate-lower;
    return [[lower,1-fraction],[lower+1,fraction]].filter(([,weight])=>weight>0);
  });
  const result=[];
  for(const [l,lw]of axes[0])for(const[a,aw]of axes[1])for(const[b,bw]of axes[2]){
    const index=l*289+a*17+b;result.push({index,key:precisionGridKey(index),weight:lw*aw*bw});
  }
  return result;
}
export function supportsPrecisionGrid(method,query,options={}){
  const id=typeof method==='string'?method:method?.id;
  if(id!=='rank-features-precision-grid')return {supported:false,reason:'Unknown precision-grid method'};
  if(Object.keys(options.parameters??{}).length)return {supported:false,reason:'The indexed precision grid has fixed scoring parameters; custom parameters are unsupported.'};
  const compiled=interpretQuery(query);
  if(!compiled.supported)return compiled;
  if(compiled.mode!=='vibe'||compiled.special||compiled.targets.length!==1||compiled.targets[0].name)return {supported:false,reason:'The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.'};
  const target=compiled.targets[0];
  if(compiled.explicitRanges||target.ranges.length!==1||target.ranges[0].space!=='oklab'||target.ranges[0].distance!==PRECISION_GRID.radius||target.edgeWeight!==PRECISION_GRID.edgeWeight)return {supported:false,reason:'The precision grid uses fixed default radius0.12 and edge quality0.5; explicit ranges and changed edge values are unsupported.'};
  try{precisionGridWeights(target.lab);}catch(error){return {supported:false,reason:error.message};}
  return {supported:true,compiled,warnings:limitations};
}
export function buildPrecisionGridQuery({method='rank-features-precision-grid',query,limit=20,eligibleIds,excludedIds,filter,parameters={}}){
  const check=supportsPrecisionGrid(method,query,{parameters});if(!check.supported)throw Error(check.reason);
  const clauses=precisionGridWeights(check.compiled.targets[0].lab).map(cell=>({rank_feature:{field:'utilities.'+cell.key,linear:{},boost:cell.weight/PRECISION_GRID.quantization}}));
  return {size:limit,_source:false,track_total_hits:false,sort:[{_score:'desc'},{id:'asc'}],query:{bool:{filter:[metadataFilter({eligibleIds,excludedIds,filter,compiled:check.compiled})],should:[{constant_score:{filter:{match_all:{}},boost:PRECISION_GRID.baseScore}},...clauses],minimum_should_match:1}}};
}

/** Correctness oracle only; never used to filter or rank documents for a user request. */
export function precisionPaletteScore(feature,anchorLab){
  const total=feature.palette_total;
  if(!(total>0)||!Array.isArray(feature.palette32_packed))throw Error('Packed palette and positive total required');
  let area=0,qualityMass=0;
  for(const packed of feature.palette32_packed){
    const rgb=Math.floor(packed/65536),count=packed%65536,lab=rgbToLab([(rgb>>16)/255,((rgb>>8)&255)/255,(rgb&255)/255]);
    const distance=Math.sqrt(lab.reduce((sum,value,axis)=>sum+(value-anchorLab[axis])**2,0)),normalized=distance/PRECISION_GRID.radius;
    if(normalized<=1+1e-9){area+=count;qualityMass+=count*(1-(1-PRECISION_GRID.edgeWeight)*Math.min(1,normalized));}
  }
  return qualityMass/Math.max(area,total*PRECISION_GRID.minimumSupport);
}
/** Indexed-formula oracle only, used for all-document service parity checks. */
export function gridDocumentScore(document,query){
  const check=supportsPrecisionGrid('rank-features-precision-grid',query);if(!check.supported)throw Error(check.reason);
  return PRECISION_GRID.baseScore+precisionGridWeights(check.compiled.targets[0].lab).reduce((sum,cell)=>sum+cell.weight*(document.utilities[cell.key]??0)/PRECISION_GRID.quantization,0);
}
