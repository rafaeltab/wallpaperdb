// PERFORMANCE DATA ONLY. This synthesizes descriptor mixtures, not new photographs.
import assert from 'node:assert/strict';
import { FEATURE_NAMES } from './corpus-colors.mjs';

export const SYNTHETIC_PROVENANCE=Object.freeze({
  version:1,
  type:'Deterministic mixtures of two real/controlled source image descriptors',
  sourceSelection:'Seeded integer hash chooses two source IDs and continuous mixture weight in [0.05,0.95].',
  mass:'RGB4096 cell counts merged with cumulative rounding to exactly16384; RGB512 and RGB CDF derived from those counts.',
  scalar:'Pixel-region area and quality mass are mixed independently; conditional quality is recomputed. Global entropy/diversity scalars are interpolated, not re-estimated.',
  hsv:'Weighted mixture of source production HSV64 descriptors; separate source sampling remains unchanged.',
  palette:'Source palette clusters mixed,31largest retained, all remaining mass merged into one RGB centroid; preserves mass while losing multimodal tail structure.',
  limitations:[
    'One million synthetic descriptor documents are not one million independent wallpaper photographs.',
    'Mixture distributions cannot establish real-world accuracy or realistic semantic/filter selectivity.',
    'Synthetic mixtures still derive from only545source assets; locality and repeated quantized values can make graph/postings behavior optimistic.',
    'Native global monochromatic/rainbow values are interpolated performance inputs and may not match the mixture hue distribution.',
    'Use varied queries and independently report filter selectivity, concurrency, cache state, and hardware.',
  ],
});
function hash32(value){
  let n=value>>>0;n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);n^=n>>>16;return n>>>0;
}
function selection(length,index,seed){
  const a=hash32(index+seed)%length;
  const b=length===1?a:(a+1+hash32(index+seed+0x5bd1e995)%(length-1))%length;
  const weight=.05+.9*(hash32(index+seed+0x27d4eb2d)/0xffffffff);
  return {a,b,weight};
}
function mergeHistogram(a,b,weight,total=16384){
  let ai=0,bi=0,cumulative=0,assigned=0;const result=[];
  while(ai<a.length||bi<b.length){
    const ac=ai<a.length?Math.floor(a[ai]/65536):Infinity;
    const bc=bi<b.length?Math.floor(b[bi]/65536):Infinity;
    const cell=Math.min(ac,bc);
    let count=0;
    if(ac===cell)count+=(a[ai++]%65536)*weight;
    if(bc===cell)count+=(b[bi++]%65536)*(1-weight);
    cumulative+=count;
    const target=ai===a.length&&bi===b.length?total:Math.min(total,Math.round(cumulative));
    const value=target-assigned;assigned=target;
    if(value>0)result.push(cell*65536+value);
  }
  return result;
}
function rgbDescriptors(packed,total){
  const rgb512=new Array(512).fill(0),channels=new Array(48).fill(0);
  for(const entry of packed){
    const cell=Math.floor(entry/65536),count=entry%65536,r=cell>>8,g=(cell>>4)&15,b=cell&15;
    rgb512[(r>>1)*64+(g>>1)*8+(b>>1)]+=count/total;
    channels[r]+=count;channels[16+g]+=count;channels[32+b]+=count;
  }
  const cdf=[];
  for(let channel=0;channel<3;channel++){
    let sum=0;for(let bin=0;bin<16;bin++){sum+=channels[channel*16+bin];cdf.push(sum/total);}
  }
  return {rgb512,rgb_cdf48:cdf,rgb_cdf48_packed:cdf.map((value,i)=>i*65536+Math.round(value*16384))};
}
function mixPalette(a,b,weight,total){
  const cells=[...a.map(p=>({rgb:Math.floor(p/65536),count:(p%65536)*weight})),...b.map(p=>({rgb:Math.floor(p/65536),count:(p%65536)*(1-weight)}))];
  cells.sort((x,y)=>y.count-x.count||x.rgb-y.rgb);
  const selected=cells.slice(0,31),rest=cells.slice(31);
  if(rest.length){
    let count=0,r=0,g=0,b=0;
    for(const p of rest){count+=p.count;r+=(p.rgb>>16)*p.count;g+=((p.rgb>>8)&255)*p.count;b+=(p.rgb&255)*p.count;}
    selected.push({count,rgb:Math.round(r/count)*65536+Math.round(g/count)*256+Math.round(b/count)});
  }
  let cumulative=0,assigned=0;const packed=[];
  for(let i=0;i<selected.length;i++){
    cumulative+=selected[i].count;
    const target=i===selected.length-1?total:Math.min(total,Math.round(cumulative));
    const count=target-assigned;assigned=target;
    if(count>0)packed.push(selected[i].rgb*65536+count);
  }
  return packed;
}

export function syntheticFeature(features,index,{fields,seed=0x5eeda11}={}){
  if(!Number.isSafeInteger(index)||index<0||!features.length)throw Error('Synthetic index and source descriptors required');
  const {a:ai,b:bi,weight}=selection(features.length,index,seed),a=features[ai],b=features[bi];
  const desired=fields?new Set(fields):null;
  const wants=name=>!desired||desired.has(name);
  const scalar=!desired||[...desired].some(name=>name.startsWith('cov_')||name.startsWith('quality_')||name==='coverage_tokens');
  const feature={id:`synthetic-${String(index).padStart(9,'0')}`,reference_id:a.id,cohort:'synthetic-mixture',partition:index%100,source_ids:[a.id,b.id],mixture_weight:weight};
  if(scalar){
    feature.coverage_tokens=[];
    for(const name of FEATURE_NAMES){
      const aa=a.features?.[name]?.area??(a[`cov_${name}`]??0)/10000;
      const ba=b.features?.[name]?.area??(b[`cov_${name}`]??0)/10000;
      const aq=a.features?.[name]?.quality??a[`quality_${name}`]??0;
      const bq=b.features?.[name]?.quality??b[`quality_${name}`]??0;
      const area=aa*weight+ba*(1-weight),mass=aa*aq*weight+ba*bq*(1-weight);
      feature[`cov_${name}`]=Math.round(area*10000);feature[`quality_${name}`]=area?mass/area:0;
      feature.coverage_tokens.push(`${name}:${Math.round(area*100)}`);
    }
  }
  if(!desired||['hsv_cosine','hsv_l2','hsv_sqrt','hsv64','hsv64_sqrt'].some(wants)){
    feature.hsv64=a.hsv64.map((value,i)=>value*weight+b.hsv64[i]*(1-weight));
    feature.hsv64_sqrt=feature.hsv64.map(Math.sqrt);
  }
  if(!desired||['rgb4096','rgb512','rgb_cosine','rgb_sqrt','rgb_cdf48_packed','pixel_total'].some(wants)){
    feature.rgb4096=mergeHistogram(a.rgb4096,b.rgb4096,weight);
    feature.pixel_total=16384;
    if(!desired||['rgb512','rgb_cosine','rgb_sqrt','rgb_cdf48_packed'].some(wants))Object.assign(feature,rgbDescriptors(feature.rgb4096,feature.pixel_total));
  }
  if(wants('palette32_packed')||wants('palette_total')){
    feature.palette32_packed=mixPalette(a.palette32_packed,b.palette32_packed,weight,16384);feature.palette_total=16384;
  }
  return feature;
}
export function* generateSyntheticFeatures(features,{count,offset=0,fields,seed}={}){
  if(!Number.isSafeInteger(count)||count<1)throw Error('Positive synthetic count required');
  for(let index=offset;index<offset+count;index++)yield syntheticFeature(features,index,{fields,seed});
}
export function validateSyntheticSamples(features,{count=1000,seed}={}){
  let elapsed=performance.now(),maxHistogramError=0;const ids=new Set();
  for(let i=0;i<count;i++){
    const doc=syntheticFeature(features,i,{seed});ids.add(doc.id);
    assert.equal(doc.rgb4096.reduce((sum,p)=>sum+p%65536,0),16384);
    assert.equal(doc.palette32_packed.reduce((sum,p)=>sum+p%65536,0),16384);
    assert.ok(doc.palette32_packed.length<=32);
    const error=Math.abs(doc.rgb512.reduce((a,b)=>a+b,0)-1);maxHistogramError=Math.max(maxHistogramError,error);assert.ok(error<1e-10);
    assert.ok(Math.abs(doc.hsv64.reduce((a,b)=>a+b,0)-1)<1e-10);
    for(const name of FEATURE_NAMES){assert.ok(doc[`cov_${name}`]>=0&&doc[`cov_${name}`]<=10000);assert.ok(doc[`quality_${name}`]>=0&&doc[`quality_${name}`]<=1+1e-12);}
    assert.equal(doc.rgb_cdf48.at(-1),1);
  }
  assert.equal(ids.size,count);
  assert.deepEqual(syntheticFeature(features,123,{seed}),syntheticFeature(features,123,{seed}));
  elapsed=performance.now()-elapsed;
  return {count,elapsedMs:elapsed,documentsPerSecond:count/(elapsed/1000),maxHistogramError,deterministic:true,massPreserved:true};
}
