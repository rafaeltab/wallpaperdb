// Central execution boundary: compile locally; the declared search service returns final order.
import { METHODS as BASE_METHODS, getMethod as baseMethod, supports as baseSupports, buildQuery } from './methods.mjs';
import { BOUNDED_METHOD, searchBounded } from './methods-bounded.mjs';
import { FAST_METHODS, supportsFast, buildFastQuery } from './methods-fast.mjs';
import { searchIndex } from './service.mjs';
import { interpretQuery } from './query.mjs';
import { TRANSPORT_METHOD, supportsTransport, buildTransportQuery } from './methods-transport.mjs';
import { DIRECT_PALETTE_METHODS, supportsDirectPalette, buildDirectPaletteQuery } from './methods-direct-palette.mjs';
import { RANK_FEATURE_METHODS, supportsRankFeatures, buildRankFeatureQuery } from './methods-rank-features.mjs';
import { RANK_FEATURE_INDEX } from './rank-features-index.mjs';
import { INDEX } from './service.mjs';
import { RELATIVE_METHOD, isRelativeAccentQuery, supportsRelative, buildRelativeQuery } from './methods-relative.mjs';
import { PALETTE_BOUNDED_METHOD, supportsPaletteBounded, searchPaletteBounded } from './methods-palette-bounded.mjs';
import { PRECISION_TYPED_METHODS, supportsPrecisionTyped, buildPrecisionTypedQuery, searchPrecisionTypedBounded } from './methods-precision-typed.mjs';
import { PRECISION_PRECOMPUTED_METHODS, supportsPrecisionPrecomputed, buildPrecisionPrecomputedQuery, searchPrecisionPrecomputedBounded } from './methods-precision-precomputed.mjs';
import { NATIVE_REFINED_METHODS, supportsNativeRefined, buildNativeRefinedQuery } from './methods-native-refined.mjs';
import { CLICKHOUSE_METHOD, supportsClickHouse, searchClickHouse } from './methods-clickhouse.mjs';
import { PRECISION_GRID_METHODS, supportsPrecisionGrid, buildPrecisionGridQuery } from './methods-precision-grid.mjs';
import { PRECISION_GRID_INDEX } from './precision-grid-index.mjs';

const refinement=(id,label,delegate,representation)=>({id,label,delegate,representation,family:'intent-refinement',approximate:false,intentBalanced:true,
  limitations:['Partial queries have no outside-color penalty; closed palettes retain one.','Quality and excess-area weights are development parameters, not population-calibrated preferences.']});
export const REFINEMENTS=Object.freeze([
  refinement('feature-intent-balanced','Named features: free remainder + graded quality','feature-composition-exact','named-features'),
  refinement('histogram-intent-balanced','Fine histogram: free remainder + graded quality','histogram-composition-typed','rgb4096'),
  refinement('feature-intent-bounded','Named features: refined objective + exact bounds','feature-composition-bounded','named-features'),
  {...refinement('hybrid-intent-bounded','Named indexed bounds + precise histogram queries',null,'hybrid'),hybrid:true,
    limitations:['Routes named queries to exact bounded features and custom colors/ranges to the fine histogram service script.','Both paths return global service rankings; the custom-range path can remain expensive.']},
]);
const WIDER_ANN=Object.freeze(['hsv-cosine-ann','rgb-cosine-ann'].map(id=>({...baseMethod(id),id:id.replace('-ann','-k500-ann'),label:baseMethod(id).label+' (k=500)',delegate:id,defaultParameters:{k:500},limitations:[...baseMethod(id).limitations,'Requests 500 ANN neighbors and returns 20; recall is measured, not guaranteed.']})));
const INDEXED_HYBRID={...RELATIVE_METHOD,id:'hybrid-indexed-precision',label:'Relative accents + exact indexed named/precise color search',searchKind:'indexed-hybrid',
  limitations:[...RELATIVE_METHOD.limitations,'Picked OKLab swatches use exact palette-cell bounds; other custom ranges use direct palette scoring.']};
const INDEXED_TYPED_HYBRID={...INDEXED_HYBRID,id:'hybrid-indexed-typed',label:'Relative accents + typed exact indexed precision',searchKind:'indexed-typed-hybrid',
  limitations:[...INDEXED_HYBRID.limitations,'The picked-color scorer uses a behavior-preserving typed Painless specialization.']};
const INDEXED_PRECOMPUTED_HYBRID={...INDEXED_HYBRID,id:'hybrid-indexed-precomputed',label:'Relative accents + indexed OKLab precision',searchKind:'indexed-precomputed-hybrid',
  limitations:[...INDEXED_HYBRID.limitations,'Picked-color quality uses stored OKLab coordinates rounded to 1e-6; original RGB arithmetic resolves range-edge membership.']};
export const METHODS = Object.freeze([...BASE_METHODS, BOUNDED_METHOD, ...FAST_METHODS, TRANSPORT_METHOD, ...REFINEMENTS, ...DIRECT_PALETTE_METHODS, ...RANK_FEATURE_METHODS, RELATIVE_METHOD, ...WIDER_ANN,PALETTE_BOUNDED_METHOD,INDEXED_HYBRID,...PRECISION_TYPED_METHODS,INDEXED_TYPED_HYBRID,...PRECISION_PRECOMPUTED_METHODS,INDEXED_PRECOMPUTED_HYBRID,...NATIVE_REFINED_METHODS,CLICKHOUSE_METHOD,...PRECISION_GRID_METHODS]);
export function indexForMethod(input,index=INDEX){const method=getMethod(input);return index===INDEX?(method.searchKind==='precision-grid'?PRECISION_GRID_INDEX:method.family==='rank-features'?RANK_FEATURE_INDEX:index):index;}
export function getMethod(input) {
  const id=typeof input==='string'?input:input?.id;
  const method=METHODS.find(m=>m.id===id);
  if(!method)throw Error(`Unknown method: ${id}`);
  return {...method,...(typeof input==='object'?input:{})};
}
export function supports(input,query,options={}) {
  const method=getMethod(input);
  if(method.engine==='clickhouse')return supportsClickHouse(query,options);
  if(method.searchKind==='precision-grid')return supportsPrecisionGrid(method,query,options);
  if(method.searchKind==='native-refined')return supportsNativeRefined(method,query,options);
  if(['precision-precomputed','precision-bounded-precomputed'].includes(method.searchKind))return supportsPrecisionPrecomputed(query);
  if(method.searchKind==='indexed-precomputed-hybrid')return supports('hybrid-relative-accents',query,options);
  if(['precision-typed','precision-bounded-typed'].includes(method.searchKind))return supportsPrecisionTyped(query);
  if(method.searchKind==='indexed-typed-hybrid')return supports('hybrid-relative-accents',query,options);
  if(method.searchKind==='palette-bounded')return supportsPaletteBounded(query);
  if(method.searchKind==='indexed-hybrid')return supports('hybrid-relative-accents',query,options);
  if(method.searchKind==='relative')return isRelativeAccentQuery(query)?supportsRelative(query):supports(supports('feature-composition-exact',query,options).supported?method.fallbackNamed:method.fallbackCustom,query,options);
  if(method.family==='rank-features')return supportsRankFeatures(method,query,options);
  if(method.searchKind==='direct-palette')return supportsDirectPalette(query);
  if(method.hybrid)return supports(supports('feature-composition-exact',query,options).supported?'feature-composition-bounded':'histogram-composition-typed',query,options);
  if(method.delegate)return supports(method.delegate,query,options);
  if(method.searchKind==='transport')return supportsTransport(query);
  if(method.searchKind==='bounded')return baseSupports('feature-composition-exact',query,options);
  if(method.baseMethod)return supportsFast(method,query,options);
  return baseSupports(method,query,options);
}
export async function executeSearch({index,seedIndex,table,method:input,query,limit=20,eligibleIds,excludedIds,filter,parameters={},signal,timeoutMs=10000,serviceTimeout}) {
  const method=getMethod(input);
  if(method.engine==='clickhouse')return searchClickHouse({table,query,limit,eligibleIds,excludedIds,filter,parameters,signal,timeoutMs,serviceTimeout});
  index=indexForMethod(method,index);
  if(method.searchKind==='indexed-precomputed-hybrid')return executeSearch({index,seedIndex,method:supportsPrecisionPrecomputed(query).supported?'palette-precision-bounded-precomputed':'hybrid-relative-accents',query,limit,eligibleIds,excludedIds,filter,parameters,signal,timeoutMs,serviceTimeout});
  if(method.searchKind==='precision-bounded-precomputed')return searchPrecisionPrecomputedBounded({index,seedIndex,query,limit,eligibleIds,excludedIds,filter,parameters,signal,
    search:(index,body,options)=>searchIndex(index,{...body,...(serviceTimeout?{timeout:serviceTimeout}:{})},{...options,timeoutMs})});
  if(method.searchKind==='indexed-typed-hybrid')return executeSearch({index,seedIndex,method:supportsPrecisionTyped(query).supported?'palette-precision-bounded-typed':'hybrid-relative-accents',query,limit,eligibleIds,excludedIds,filter,parameters,signal,timeoutMs,serviceTimeout});
  if(method.searchKind==='precision-bounded-typed')return searchPrecisionTypedBounded({index,seedIndex,query,limit,eligibleIds,excludedIds,filter,parameters,signal,
    search:(index,body,options)=>searchIndex(index,{...body,...(serviceTimeout?{timeout:serviceTimeout}:{})},{...options,timeoutMs})});
  if(method.searchKind==='indexed-hybrid')return executeSearch({index,seedIndex,method:supportsPaletteBounded(query).supported?'palette-precision-bounded':'hybrid-relative-accents',query,limit,eligibleIds,excludedIds,filter,parameters,signal,timeoutMs,serviceTimeout});
  if(method.searchKind==='palette-bounded')return searchPaletteBounded({index,seedIndex,query,limit,eligibleIds,excludedIds,filter,parameters,signal,
    search:(index,body,options)=>searchIndex(index,{...body,...(serviceTimeout?{timeout:serviceTimeout}:{})},{...options,timeoutMs})});
  if(method.searchKind==='relative'&&!isRelativeAccentQuery(query))return executeSearch({index,seedIndex,method:supports('feature-composition-exact',query,{eligibleIds,excludedIds}).supported?method.fallbackNamed:method.fallbackCustom,query,limit,eligibleIds,excludedIds,filter,parameters,signal,timeoutMs,serviceTimeout});
  if(method.intentBalanced){
    const compiled=interpretQuery(query);
    if(!compiled.supported)throw Error(compiled.reason);
    const delegate=method.hybrid?(supports('feature-composition-exact',query,{eligibleIds,excludedIds}).supported?'feature-composition-bounded':'histogram-composition-typed'):method.delegate;
    const tuned={areaPower:0.65,qualityPenalty:0.1,excessPenalty:1.5,...parameters,outsidePenalty:compiled.remainder>0?0:parameters.outsidePenalty??6};
    const result=await executeSearch({index,seedIndex,method:delegate,query,limit,eligibleIds,excludedIds,filter,parameters:tuned,signal,timeoutMs,serviceTimeout});
    return {...result,evidence:{...result.evidence,requestedMethod:method.id,executedMethod:delegate,effectiveParameters:tuned}};
  }
  if(method.delegate)return executeSearch({index,method:method.delegate,query,limit,eligibleIds,excludedIds,filter,parameters:{...method.defaultParameters,...parameters},signal,timeoutMs,serviceTimeout});
  const request={method,query,limit,eligibleIds,excludedIds,filter,parameters};
  if(method.searchKind==='bounded') {
    return searchBounded({...request,index,signal,search:(index,body,options)=>searchIndex(index,{...body,...(serviceTimeout?{timeout:serviceTimeout}:{})},{...options,timeoutMs})});
  }
  const body=method.searchKind==='precision-grid'?buildPrecisionGridQuery(request):method.searchKind==='native-refined'?buildNativeRefinedQuery(request):method.searchKind==='precision-precomputed'?buildPrecisionPrecomputedQuery(request):method.searchKind==='precision-typed'?buildPrecisionTypedQuery(request):method.searchKind==='relative'?buildRelativeQuery(request):method.family==='rank-features'?buildRankFeatureQuery(request):method.searchKind==='direct-palette'?buildDirectPaletteQuery(request):method.searchKind==='transport'?buildTransportQuery(request):method.baseMethod?buildFastQuery(request):buildQuery(request);
  if(serviceTimeout)body.timeout=serviceTimeout;
  return searchIndex(index,body,{signal,timeoutMs});
}
