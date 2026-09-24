// Deterministic synthetic mosaics of real/controlled descriptors for load tests.
// These are not additional independent wallpapers or human relevance examples.
import { randomGenerator } from './global-common.mjs';

export function nativeMixture(i,bases,families){
  const random=randomGenerator((Math.imul(i+1,2654435761)^0x60160917)>>>0);
  const parts=[0,1,2].map(()=>bases[Math.floor(random()*bases.length)]);
  const raw=[random()+.01,random()+.01,random()+.01],total=raw.reduce((s,v)=>s+v,0),weights=raw.map(x=>x/total);
  const features={},qualityMass={},unions={};
  for(const family of families){
    features[family.id]=Math.max(0,Math.min(1,parts.reduce((s,p,j)=>s+weights[j]*p.features[family.id],0)));
    qualityMass[family.id]=Math.max(0,Math.min(features[family.id],parts.reduce((s,p,j)=>s+weights[j]*p.qualityMass[family.id],0)));
  }
  for(const key of Object.keys(parts[0].unions??{}))unions[key]=Math.max(0,Math.min(1,parts.reduce((s,p,j)=>s+weights[j]*p.unions[key],0)));
  return {id:`mix-${String(i).padStart(9,'0')}`,cohort:'synthetic',partition:i%100,reference_id:parts[0].id,features,qualityMass,unions};
}

export function dynamicMixture(i,bases){
  const random=randomGenerator((Math.imul(i+1,2246822519)^0x60160918)>>>0);
  const base=bases[Math.floor(random()*bases.length)];
  const palette=base.palette.map(p=>({lab:[...p.lab],weight:p.weight*(.2+random()*1.6)}));
  const total=palette.reduce((s,p)=>s+p.weight,0);palette.forEach(p=>{p.weight/=total;});
  return {id:`palette-${String(i).padStart(9,'0')}`,cohort:'synthetic',partition:i%100,reference_id:base.id,palette};
}
