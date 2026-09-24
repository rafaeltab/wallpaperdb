// THROWAWAY PROTOTYPE. Query compilation only; OpenSearch scores every eligible document.
import { buildQuery, HISTOGRAM_SCRIPT, getMethod, supports } from './methods.mjs';

export const FAST_METHODS=Object.freeze([
  {id:'histogram-area-typed',label:'Fine histogram target area, typed Painless',baseMethod:'histogram-area-exact',family:'area',representation:'rgb4096',approximate:false,limitations:['Exhaustive service scoring still visits every eligible histogram.']},
  {id:'histogram-composition-typed',label:'Fine histogram composition, typed Painless',baseMethod:'histogram-composition-exact',family:'composition',representation:'rgb4096',approximate:false,limitations:['Same marginal area and union model as the baseline; no candidate truncation.']},
  {id:'rgb-kernel-typed',label:'Fine histogram perceptual kernel, typed Painless',baseMethod:'rgb-kernel-exact',family:'kernel',representation:'rgb4096',approximate:false,limitations:['Same weighted color-mass model as the baseline.']},
  {id:'palette-area-typed',label:'Palette32 target area, typed Painless',baseMethod:'palette-area-exact',family:'area',representation:'palette32',approximate:false,limitations:['Palette approximation unchanged from the baseline.']},
]);
const SCORE=HISTOGRAM_SCRIPT.slice(HISTOGRAM_SCRIPT.indexOf("if (params.special"));
const cache=new Map();
export function typedHistogramScript({targets,palette}){
  const count=targets.length;
  if(!Number.isInteger(count)||count<1||count>10)throw Error('Typed histogram requires1..10targets');
  const key=`${count}:${Boolean(palette)}`;
  if(cache.has(key))return cache.get(key);
  const source=`
double[] areas = new double[${count}];
double[] masses = new double[${count}];
List allWeights = (List)params.weights;
List allQualities = (List)params.qualities;
${Array.from({length:count},(_,j)=>`List weights${j} = (List)allWeights.get(${j});\nList qualities${j} = (List)allQualities.get(${j});`).join('\n')}
double union = 0.0;
double total = doc['${palette?'palette_total':'pixel_total'}'].value;
List histogram = doc['${palette?'palette32_packed':'rgb4096'}'];
int size = histogram.size();
for (int i = 0; i < size; i++) {
  long packed = (long)histogram.get(i);
  long encoded = packed / 65536L;
  int cell = ${palette?'(int)(((encoded >> 20) << 8) + (((encoded >> 12) & 15) << 4) + ((encoded >> 4) & 15))':'(int)encoded'};
  double mass = (packed % 65536L) / total;
  double inUnion = 0.0;
  ${Array.from({length:count},(_,j)=>`double inside${j} = (double)weights${j}.get(cell);
  areas[${j}] += mass * inside${j};
  masses[${j}] += mass * (double)qualities${j}.get(cell);
  inUnion = Math.max(inUnion, inside${j});`).join('\n  ')}
  union += mass * inUnion;
}
${SCORE}`;
  cache.set(key,source);return source;
}
export function fastMethod(input){
  const id=typeof input==='string'?input:input?.id;
  const fast=FAST_METHODS.find(method=>method.id===id);
  if(fast)return {...fast,...(typeof input==='object'?input:{})};
  const base=getMethod(input);
  if(!['rgb4096','palette32'].includes(base.representation))throw Error(`Unsupported typed representation: ${base.representation}`);
  return {...base,baseMethod:base.id};
}
export function supportsFast(method,query,options={}){
  return supports(fastMethod(method).baseMethod,query,options);
}
export function buildFastQuery(input){
  const method=fastMethod(input.method);
  const body=buildQuery({...input,method:method.baseMethod});
  const script=body.query.script_score.script;
  script.source=typedHistogramScript(script.params);
  return body;
}
