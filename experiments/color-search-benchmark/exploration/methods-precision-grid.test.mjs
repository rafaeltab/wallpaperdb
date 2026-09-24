import test from 'node:test';
import assert from 'node:assert/strict';
import { PRECISION_GRID,precisionGridAnchor,precisionGridWeights,supportsPrecisionGrid,buildPrecisionGridQuery,precisionPaletteScore,gridDocumentScore } from './methods-precision-grid.mjs';
import { createPrecisionGridEncoder,validatePrecisionGridMetadata } from './precision-grid-index.mjs';
import { buildPrecisionTypedQuery } from './methods-precision-typed.mjs';
import { syntheticFeature } from './scale-corpus.mjs';

const packed=(rgb,count)=>rgb*65536+count;
const palette=(id,entries)=>({id,palette_total:16384,palette32_packed:entries.map(([rgb,count])=>packed(rgb,count))});

test('grid weights reproduce coordinates, preserve unit mass, and collapse exactly at vertices',()=>{
  assert.equal(PRECISION_GRID.anchorCount,4913);
  for(const lab of [[0,-.4,-.4],[1,.4,.4],[.5,0,0],[.723,-.043,.117]]){
    const cells=precisionGridWeights(lab);
    assert.ok(cells.length>=1&&cells.length<=8);
    assert.ok(Math.abs(cells.reduce((sum,item)=>sum+item.weight,0)-1)<1e-12);
    for(let channel=0;channel<3;channel++)assert.ok(Math.abs(cells.reduce((sum,item)=>sum+item.weight*precisionGridAnchor(item.index)[channel],0)-lab[channel])<1e-12);
  }
  assert.deepEqual(precisionGridWeights([.5,0,0]).map(cell=>[cell.index,cell.weight]),[[2456,1]]);
});

test('fixed objective matches typed scorer defaults and rejects unsupported controls',()=>{
  const typed=buildPrecisionTypedQuery({query:{swatchHex:'#ff2200'}}).query.script_score.script.params;
  assert.equal(PRECISION_GRID.radius,typed.radius);assert.equal(PRECISION_GRID.edgeWeight,typed.edgeWeight);assert.equal(PRECISION_GRID.minimumSupport,typed.minimumSupport);
  assert.equal(supportsPrecisionGrid('rank-features-precision-grid',{swatchHex:'#ff2200'}).supported,true);
  for(const query of [{text:'red'},{mode:'proportions',targets:[{color:'#ff2200',percent:40}]},{mode:'vibe',targets:[{color:'#ff2200',distance:.12}]},{mode:'vibe',targets:[{color:'#ff2200',edgeWeight:.7}]},{targets:[{color:'#ff2200'},{color:'#000000'}]}])assert.equal(supportsPrecisionGrid('rank-features-precision-grid',query).supported,false,JSON.stringify(query));
  assert.equal(supportsPrecisionGrid('rank-features-precision-grid',{swatchHex:'#ff2200'},{parameters:{minimumSupport:.05}}).supported,false);
});

test('sparse anchor accumulation equals the direct palette objective at every grid anchor before u8 rounding',()=>{
  const encoder=createPrecisionGridEncoder({tailCacheLimit:2});
  for(const feature of [palette('red',[[0xff2200,16384]]),palette('small-red',[[0xff2200,200],[0x171717,16184]])]){
    const document=encoder.encode(feature);
    for(let index=0;index<PRECISION_GRID.anchorCount;index++){
      const expected=Math.round(255*precisionPaletteScore(feature,precisionGridAnchor(index)));
      assert.equal(document.utilities['p'+index]??0,expected,'anchor '+index);
    }
    for(const value of Object.values(document.utilities))assert.ok(Number.isInteger(value)&&value>0&&value<=255);
  }
  assert.ok(encoder.stats().tailCacheSize<=2);
});

test('synthetic rounded palette tails use their actual colors rather than blended source utilities',()=>{
  const entries=Array.from({length:32},(_,i)=>[(i*7919)%0xffffff,512]);
  const sources=[palette('first',entries),palette('second',entries.map(([rgb,count])=>[0xffffff-rgb,count]))];
  const encoder=createPrecisionGridEncoder({tailCacheLimit:4});
  const feature=syntheticFeature(sources,87,{fields:['palette32_packed','palette_total']});
  const document=encoder.encode(feature);
  assert.equal(feature.palette32_packed.reduce((sum,value)=>sum+value%65536,0),16384);
  let nonzero=0;
  for(let index=0;index<PRECISION_GRID.anchorCount;index+=13){
    const expected=Math.round(255*precisionPaletteScore(feature,precisionGridAnchor(index)));
    assert.equal(document.utilities['p'+index]??0,expected);if(expected)nonzero++;
  }
  assert.ok(nonzero>0);assert.ok(encoder.stats().tailCacheSize<=4);
});

test('query consists only of native utility clauses, metadata filtering and zero-score eligibility',()=>{
  const query={swatchHex:'#ff2200'},body=buildPrecisionGridQuery({method:'rank-features-precision-grid',query,filter:{term:{partition:1}},limit:20});
  assert.equal(body.size,20);assert.equal(body.track_total_hits,false);
  const serialized=JSON.stringify(body);
  assert.ok(!serialized.includes('script'));assert.ok(!serialized.includes('knn'));
  assert.ok(serialized.includes('partition'));assert.ok(serialized.includes('rank_feature'));assert.ok(serialized.includes('constant_score'));
  const feature=palette('red',[[0xff2200,16384]]),document=createPrecisionGridEncoder().encode(feature);
  assert.ok(gridDocumentScore(document,query)>0.5);assert.ok(gridDocumentScore(document,query)<=1.0000011);
});

test('index metadata cannot reuse utilities after their computation fingerprint changes',()=>{
  const expected={descriptorHash:'images',definitionHash:'objective',computationHash:'encoder-v2'};
  assert.equal(validatePrecisionGridMetadata(expected,expected),true);
  assert.throws(()=>validatePrecisionGridMetadata({...expected,computationHash:'encoder-v1'},expected),/computationHash fingerprint mismatch/);
  const missing={descriptorHash:'images',definitionHash:'objective'};
  assert.throws(()=>validatePrecisionGridMetadata(missing,expected),/computationHash fingerprint mismatch/);
});
