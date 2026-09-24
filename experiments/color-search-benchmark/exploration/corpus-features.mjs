// Extraction only: none of these calculations rank a live search request.
import { FEATURE_NAMES, GLOBAL_FEATURES, featureMembership, rgbToLab, rgbToHsv } from './corpus-colors.mjs';

const distance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
export function makePalette(cells,k=32) {
  if(cells.length<=k)return cells.map(c=>({...c,weight:0}));
  const centers=[cells.reduce((a,b)=>a.count>b.count?a:b).lab.slice()];
  const distances=cells.map(()=>Infinity);
  while(centers.length<k){
    let best=-1,index=0;
    for(let i=0;i<cells.length;i++){
      distances[i]=Math.min(distances[i],distance(cells[i].lab,centers.at(-1)));
      const value=distances[i]*cells[i].count;
      if(value>best){best=value;index=i;}
    }
    if(best<=0)break;
    centers.push(cells[index].lab.slice());
  }
  let groups;
  for(let iteration=0;iteration<12;iteration++){
    groups=centers.map(()=>({lab:[0,0,0],rgb:[0,0,0],count:0}));
    for(const cell of cells){
      let nearest=0,best=Infinity;
      for(let i=0;i<centers.length;i++){
        const d=distance(cell.lab,centers[i]);
        if(d<best){best=d;nearest=i;}
      }
      const group=groups[nearest];group.count+=cell.count;
      for(let c=0;c<3;c++){group.lab[c]+=cell.lab[c]*cell.count;group.rgb[c]+=cell.rgb[c]*cell.count;}
    }
    for(let i=0;i<groups.length;i++) if(groups[i].count) centers[i]=groups[i].lab.map(x=>x/groups[i].count);
  }
  return groups.filter(g=>g.count).map(g=>({count:g.count,rgb:g.rgb.map(x=>x/g.count),lab:g.lab.map(x=>x/g.count)}));
}

export function extractSampleFeatures(rgba) {
  if(rgba.length%4||rgba.length===0||rgba.length/4>=65536)throw Error('Require 1..65535 RGBA pixels for packed counts');
  const total=rgba.length/4, bins=new Map(), rgb512=new Array(512).fill(0),channels=new Array(48).fill(0);
  const sums=Object.fromEntries(FEATURE_NAMES.map(name=>[name,{area:0,qualityMass:0}]));
  const hueCounts=new Array(12).fill(0);let chromatic=0;
  for(let i=0;i<rgba.length;i+=4){
    const alpha=rgba[i+3]/255;
    const bytes=[0,1,2].map(c=>Math.round(rgba[i+c]*alpha));
    const rgb=bytes.map(v=>v/255);
    const cell=(bytes[0]>>4)*256+(bytes[1]>>4)*16+(bytes[2]>>4);
    const record=bins.get(cell)??{cell,rgb:[0,0,0],count:0};record.count++;
    for(let c=0;c<3;c++){record.rgb[c]+=rgb[c];channels[c*16+(bytes[c]>>4)]++;}
    bins.set(cell,record);
    rgb512[(bytes[0]>>5)*64+(bytes[1]>>5)*8+(bytes[2]>>5)]++;
    const members=featureMembership(rgb);
    for(const [name,match]of Object.entries(members)){sums[name].area+=match.area;sums[name].qualityMass+=match.area*match.quality;}
    const [h,s,v]=rgbToHsv(rgb);if(s>=.2&&v>=.15){hueCounts[Math.min(11,Math.floor(h/30))]++;chromatic++;}
  }
  const cells=[...bins.values()].sort((a,b)=>a.cell-b.cell).map(c=>({...c,rgb:c.rgb.map(v=>v/c.count)}));
  for(const c of cells)c.lab=rgbToLab(c.rgb);
  const palette=makePalette(cells).map(p=>({...p,oklab:p.lab,weight:p.count/total}));
  const entropy=chromatic? -hueCounts.reduce((n,count)=>count?n+(count/chromatic)*Math.log(count/chromatic):n,0)/Math.log(12):0;
  const hueCoverage=hueCounts.filter(count=>count/total>=.01).length/12;
  const monochromatic=1-entropy, rainbow=hueCoverage*(chromatic/total);
  sums.monochromatic={area:monochromatic*total,qualityMass:monochromatic*total};
  sums.rainbow={area:rainbow*total,qualityMass:rainbow*total};
  const features=Object.fromEntries(Object.entries(sums).map(([name,s])=>[name,{area:s.area/total,quality:s.area?s.qualityMass/s.area:0}]));
  const cdf=channels.map((_,i)=>channels.slice(Math.floor(i/16)*16,i+1).reduce((a,b)=>a+b,0)/total);
  const normalized512=rgb512.map(v=>v/total);
  const result={pixel_total:total,rgb4096:cells.map(c=>c.cell*65536+c.count),rgb512:normalized512,rgb512_sqrt:normalized512.map(Math.sqrt),rgb_cdf48:cdf,
    rgb_cdf48_packed:cdf.map((value,i)=>i*65536+Math.round(value*16384)),
    palette32:palette,palette32_packed:palette.map(p=>{const [r,g,b]=p.rgb.map(v=>Math.round(v*255));return (r*65536+g*256+b)*65536+p.count;}),
    palette_total:total,features,coverage_tokens:[],hue_entropy:entropy,hue_coverage:hueCoverage,chromatic_fraction:chromatic/total};
  for(const [name,f]of Object.entries(features)){
    result[`cov_${name}`]=Math.round(f.area*10000);result[`quality_${name}`]=f.quality;
    result.coverage_tokens.push(`${name}:${Math.round(f.area*100)}`);
  }
  result.global_feature_names=GLOBAL_FEATURES;
  return result;
}
