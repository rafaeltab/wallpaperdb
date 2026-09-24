// THROWAWAY PROTOTYPE. Hand-authored color regions; no learned features.
// Area and conditional match quality are intentionally separate quantities.
export const NAMED_COLORS = Object.freeze({
  red:'#ef2020', orange:'#f08020', yellow:'#eed520', green:'#209040',
  teal:'#008080', cyan:'#20bfd0', blue:'#2058df', purple:'#9020bf',
  pink:'#ef80ae', brown:'#805030', black:'#101010', gray:'#808080',
  white:'#f0f0f0', grayscale:'#808080', strict_grayscale:'#808080',
  near_neutral:'#808080', dark:'#101010', light:'#eeeeee', bright:'#ffff00',
  vivid:'#ff4000', muted:'#908080', monochromatic:'#808080', rainbow:'#ff0000',
});
export const FEATURE_NAMES = Object.freeze(Object.keys(NAMED_COLORS));
export const GLOBAL_FEATURES = Object.freeze(['monochromatic','rainbow']);
const clamp = value => Math.min(1,Math.max(0,value));
export function rgbToLab(rgb) {
  const [r,g,b]=rgb.map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
export function rgbToHsv([r,g,b]) {
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=d===0?0:max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  h=(h*60+360)%360;
  return [h,max===0?0:d/max,max];
}
const HUE_REGIONS=Object.freeze({red:[4,46],orange:[29,25],yellow:[58,24],green:[127,61],teal:[172,29],cyan:[191,32],blue:[234,47],purple:[282,38],pink:[334,44],brown:[29,28]});
export function featureMembership(rgb) {
  const [h,s,v]=rgbToHsv(rgb), [l,a,b]=rgbToLab(rgb), chroma=Math.hypot(a,b);
  const result={};
  const assign=(name,inside,core)=>{ result[name]={area:inside?1:0,quality:inside?.5+.5*clamp(core):0}; };
  for (const [name,[center,width]] of Object.entries(HUE_REGIONS)) {
    const hueDistance=Math.abs(((h-center+540)%360)-180);
    let inside=hueDistance<=width&&s>=.18&&v>=.09&&chroma>=.018;
    if(name==='pink') inside=inside&&l>=.56;
    if(name==='brown') inside=inside&&l>=.22&&l<=.65;
    const hueCore=1-hueDistance/width;
    const vividness=Math.sqrt(s)*Math.sqrt(v);
    // Pale reds remain eligible red, but count as lower quality for red-vibe.
    const palePenalty=name==='red'?1-clamp((l-.72)/.24)*.65:1;
    assign(name,inside,hueCore*vividness*palePenalty);
  }
  assign('strict_grayscale',chroma<=.005,1-chroma/.005);
  assign('grayscale',chroma<=.035,1-chroma/.035);
  assign('near_neutral',chroma<=.065,1-chroma/.065);
  assign('black',l<=.25,1-l/.25);
  assign('gray',chroma<=.045&&l>=.2&&l<=.88,(1-chroma/.045)*(1-Math.abs(l-.54)/.34));
  assign('white',chroma<=.055&&l>=.86,(1-chroma/.055)*(l-.86)/.14);
  assign('dark',l<=.5,1-l/.5);
  assign('light',l>=.72,(l-.72)/.28);
  assign('bright',v>=.72&&l>=.55,(v-.72)/.28);
  assign('vivid',s>=.55&&v>=.5,(s-.55)/.45*(v-.5)/.5);
  assign('muted',s<=.4&&chroma<=.085,1-chroma/.085);
  return result;
}
export function familyMembership(rgb,name) {
  const result=featureMembership(rgb)[name];
  if(!result) throw new Error(`No pixel membership for ${name}; monochromatic and rainbow are global distribution properties`);
  return result;
}
export const RGB4096_CENTERS = Object.freeze(Array.from({length:4096},(_,cell)=>[
  ((cell>>8)*16+7.5)/255, (((cell>>4)&15)*16+7.5)/255, ((cell&15)*16+7.5)/255,
]));
export const FEATURE_DEFINITION = Object.freeze({
  version:1,
  colorSpace:'sRGB channels; OKLab lightness/chroma; HSV hue/saturation/value',
  area:'Fraction of sampled pixels inside a hand-authored region, without quality attenuation.',
  quality:'Conditional average match strength inside region; 0.5 boundary to 1 core. Zero for no matching pixels.',
  overlap:'Regions overlap. Marginal areas are not exclusive palette allocations.',
  global:'monochromatic=1-normalized entropy of chromatic hue bins (neutral images score1); rainbow=12-bin hue coverage times chromatic pixel fraction.',
  limitations:['Regions are provisional hand-authored heuristics, not calibrated human truth.','Very dark colors use low OKLab chroma; near-neutral can include dark saturated RGB pixels.','Single scalar global monochromatic/rainbow values are distribution strengths, not literal pixel areas.'],
});
