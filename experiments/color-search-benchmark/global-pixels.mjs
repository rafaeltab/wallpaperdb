// Source-pixel measurements for a fixed, explicitly defined indexed region bank.
import { compileRangeQuery, rgbToChannels, rgbToLab } from './ranges.mjs';

export function compileFamilies(families){
  return families.map(family=>({id:family.id,target:compileRangeQuery([{color:family.color,amount:1,ranges:family.ranges}]).compiled[0]}));
}
export function pixelFamilyPreference(point,target){
  let normalized=0;
  const scaled=(delta,tolerance)=>tolerance===1?0:tolerance===0?(delta<=1e-7?0:Infinity):delta/tolerance;
  for(const range of target.ranges){
    let value;
    if(range.space==='oklab'){
      const distance=Math.hypot(...point.lab.map((x,i)=>x-target.lab[i]));
      if(distance>range.distance+1e-7)return 0;
      value=range.distance===0?0:distance/range.distance;
    }else if(range.space==='rgb'){
      const differences=point.rgb.map((x,i)=>Math.abs(x-target.rgb[i]));
      if(['r','g','b'].some((axis,i)=>differences[i]>range[axis]+1e-7))return 0;
      value=Math.max(...['r','g','b'].map((axis,i)=>scaled(differences[i],range[axis])));
    }else{
      const pointChannels=point[range.space],anchor=target[range.space],axis=range.space==='hsl'?'l':'v';
      let hue=0;
      if(range.h<1){
        if(pointChannels.h===null)return 0;
        const raw=Math.abs(pointChannels.h-anchor.h);hue=2*Math.min(raw,1-raw);
        if(hue>range.h+1e-7)return 0;
      }
      const saturation=Math.abs(pointChannels.s-anchor.s),brightness=Math.abs(pointChannels[axis]-anchor[axis]);
      if(saturation>range.s+1e-7||brightness>range[axis]+1e-7)return 0;
      value=Math.max(scaled(hue,range.h),scaled(saturation,range.s),scaled(brightness,range[axis]));
    }
    normalized=Math.max(normalized,value);
  }
  return 2**(-(Math.min(1,normalized)**2));
}
export function measureFamilies(pixels,compiled){
  const colors=new Map();
  let total=0;
  for(let i=0;i<pixels.length;i+=4){
    const weight=pixels[i+3]/255;if(!weight)continue;
    const packed=(pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2];
    colors.set(packed,(colors.get(packed)??0)+weight);total+=weight;
  }
  if(!total)throw new Error('No visible source pixels.');
  return {...measureWeightedColors([...colors].map(([packed,weight])=>{
    const rgb=[(packed>>16)/255,((packed>>8)&255)/255,(packed&255)/255];
    return {point:{...rgbToChannels(rgb),lab:rgbToLab(rgb)},weight};
  }),compiled),pixelCount:pixels.length/4,visibleWeight:total};
}
export const unionKey=(a,b)=>[a,b].sort().join('__');
export function measureWeightedColors(colors,compiled){
  const features=Object.fromEntries(compiled.map(f=>[f.id,0]));
  const qualityMass={...features},intersections={};
  const pairs=compiled.flatMap((a,i)=>compiled.slice(i+1).map(b=>[a.id,b.id,unionKey(a.id,b.id)]));
  for(const [,,key]of pairs)intersections[key]=0;
  let total=0;
  for(const {point,weight}of colors){
    total+=weight;
    const matched=[];
    for(const family of compiled){
      const quality=pixelFamilyPreference(point,family.target);
      if(quality>0){features[family.id]+=weight;qualityMass[family.id]+=weight*quality;matched.push(family.id);}
    }
    for(let i=0;i<matched.length;i++)for(let j=i+1;j<matched.length;j++)intersections[unionKey(matched[i],matched[j])]+=weight;
  }
  if(!total)throw new Error('No visible source pixels.');
  for(const family of compiled){features[family.id]/=total;qualityMass[family.id]/=total;}
  const unions=Object.fromEntries(pairs.map(([a,b,key])=>[key,Math.max(features[a],features[b],Math.min(1,features[a]+features[b]-intersections[key]/total))]));
  return {features,qualityMass,unions};
}
