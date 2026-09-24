import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { minCostTransport } from '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/proportions.mjs';
const started=performance.now();
let seed=0x5c01a;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
function subsets(count,total,prefix=[],out=[]){if(count===1){out.push([...prefix,total]);return out;}for(let value=0;value<=total;value++)subsets(count-1,total-value,[...prefix,value],out);return out;}
function formula(masses,amounts,minimum){
 const k=amounts.length,n=1<<k,A=amounts.reduce((a,b)=>a+b,0);
 const zeta=[...masses];
 for(let bit=0;bit<k;bit++)for(let mask=0;mask<n;mask++)if(mask&(1<<bit))zeta[mask]+=zeta[mask^(1<<bit)];
 let F=A;
 const unions=[];
 for(let selected=0;selected<n;selected++){
  const a=amounts.reduce((s,v,bit)=>s+((selected&(1<<bit))?v:0),0);
  const u=masses.reduce((s,v,mask)=>s+((mask&selected)?v:0),0);
  assert.ok(Math.abs(u-(1-zeta[(n-1)^selected]))<1e-12);
  unions[selected]=u;F=Math.min(F,A-a+u);
 }
 return {cost:Math.max(0,(minimum?A:Math.max(A,unions[n-1]))-F),unions};
}
let checks=0,maxDifference=0;
const perK={};
function check(counts,amounts,k){
 const total=counts.reduce((a,b)=>a+b,0);if(!total)return;
 const masses=counts.map(v=>v/total),A=amounts.reduce((a,b)=>a+b,0);
 for(const minimum of [false,true]){
  const result=formula(masses,amounts,minimum);
  const costs=masses.map((_,mask)=>[...amounts.map((_,bit)=>(mask&(1<<bit))?0:1),minimum?0:mask?1:0]);
  const oracle=minCostTransport(masses,[...amounts,Math.max(0,1-A)],costs).cost;
  const difference=Math.abs(result.cost-oracle);maxDifference=Math.max(maxDifference,difference);
  assert.ok(difference<1e-9,JSON.stringify({k,masses,amounts,minimum,result:result.cost,oracle}));
  // All singleton/pair lower bounds, plus target upper bound by total requested area.
  for(let selected=1;selected<(1<<k);selected++){
   if(selected.toString(2).replaceAll('0','').length>2)continue;
   const requested=amounts.reduce((s,v,bit)=>s+((selected&(1<<bit))?v:0),0);
   assert.ok(result.unions[selected]+1e-9>=requested-result.cost);
   if(!minimum)assert.ok(result.unions[selected]<=A+result.cost+1e-9);
  }
  checks++;perK[k]=(perK[k]??0)+1;
 }
}
for(let k=1;k<=3;k++)for(const counts of subsets(1<<k,3))for(const demand of subsets(k+1,3))check(counts,demand.slice(0,k).map(v=>v/3),k);
for(let k=4;k<=5;k++)for(let run=0;run<600;run++){
 const counts=Array.from({length:1<<k},()=>random()<.45?0:1+Math.floor(random()*100));
 if(!counts.some(Boolean))counts[0]=1;
 const raw=Array.from({length:k+1},()=>random()<.2?0:Math.floor(random()*100));
 if(!raw.some(Boolean))raw[k]=1;
 const total=raw.reduce((a,b)=>a+b,0);
 check(counts,raw.slice(0,k).map(v=>v/total),k);
}
// Five exact disjoint fifths, and five requests competing for the same fifth.
const disjoint=Array(32).fill(0);for(let bit=0;bit<5;bit++)disjoint[1<<bit]=1;
check(disjoint,Array(5).fill(.2),5);
assert.ok(formula(disjoint.map(v=>v/5),Array(5).fill(.2),false).cost<1e-12);
const overlapping=Array(32).fill(0);overlapping[0]=4;overlapping[31]=1;
check(overlapping,Array(5).fill(.2),5);
assert.ok(Math.abs(formula(overlapping.map(v=>v/5),Array(5).fill(.2),false).cost-.8)<1e-12);
// Pairwise union data cannot reveal a three-way parity distinction.
const even=Array(8).fill(0),odd=Array(8).fill(0);
for(let mask=0;mask<8;mask++)(mask.toString(2).replaceAll('0','').length%2?odd:even)[mask]=.25;
const e=formula(even,[1/3,1/3,1/3],false),o=formula(odd,[1/3,1/3,1/3],false);
for(const s of [1,2,4,3,5,6])assert.equal(e.unions[s],o.unions[s]);
assert.equal(e.cost,.25);assert.equal(o.cost,0);
// Upper bound by a subset's requested demand is NOT valid when k>2.
const allThree=Array(8).fill(0);allThree[7]=1;
const upperCounter=formula(allThree,[.2,.2,.6],false);
assert.equal(upperCounter.cost,0);assert.equal(upperCounter.unions[3],1);
assert.ok(upperCounter.unions[3]>.4);
const packedMax=(2**18-1)*2**24+65536*255;
assert.ok(Number.isSafeInteger(packedMax)&&packedMax<2**42);
assert.equal(Math.floor(packedMax/2**24),2**18-1);assert.equal(packedMax%(2**24),65536*255);
const evidence={generatedAt:new Date().toISOString(),seed:'0x5c01a',checks,perK,maxDifference,wallMs:performance.now()-started,exactRainbowCost:0,overlappingRainbowCost:.8,pairwiseInsufficiency:{evenParityCost:e.cost,oddParityCost:o.cost,sameSingletonsAndPairs:true},invalidSubsetUpperBound:{query:[.2,.2,.6],pairUnion:1,areaError:0},packedMax,notes:['No OpenSearch calls or load tests.','Exhaustive denominator3 distributions for1–3 regions;600 deterministic random distributions each for4–5 regions;target and minimum modes.','Formula independently compared with generic min-cost transport; union zeta transform cross-checked against direct subset unions.']};
await writeFile('/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/global-multi-proof.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
