import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSampleFeatures, makePalette } from './corpus-features.mjs';
import { familyMembership } from './corpus-colors.mjs';
import { syntheticFeature, validateSyntheticSamples } from './scale-corpus.mjs';

test('packed sample histograms and palette preserve all mass and distinguish area from quality',()=>{
  const pixels=Buffer.from([255,0,0,255,255,0,0,255,0,0,0,255,255,255,255,255]);
  const result=extractSampleFeatures(pixels);
  assert.equal(result.pixel_total,4);
  assert.equal(result.rgb4096.reduce((n,packed)=>n+packed%65536,0),4);
  assert.equal(result.palette32_packed.reduce((n,packed)=>n+packed%65536,0),4);
  assert.equal(result.cov_red,5000);
  assert.ok(result.quality_red>=.5&&result.quality_red<=1);
  assert.equal(result.rgb512.reduce((a,b)=>a+b,0),1);
  assert.equal(result.rgb_cdf48[15],1);
  assert.equal(result.rgb_cdf48[31],1);
  assert.equal(result.rgb_cdf48[47],1);
});
test('palette allocation is deterministic and does not lose tiny accents',()=>{
  const cells=[{rgb:[1,0,0],lab:[.62,.22,.12],count:999},{rgb:[0,1,0],lab:[.86,-.23,.18],count:1}];
  assert.deepEqual(makePalette(cells,32),makePalette(cells,32));
  assert.equal(makePalette(cells,32).reduce((sum,p)=>sum+p.count,0),1000);
  assert.equal(makePalette(cells,32).length,2);
});
test('color regions keep dull red area separate from reduced match quality',()=>{
  const vivid=familyMembership([1,0,0],'red'), dull=familyMembership([.55,.25,.25],'red');
  assert.equal(vivid.area,1); assert.equal(dull.area,1);
  assert.ok(vivid.quality>dull.quality);
  assert.equal(familyMembership([.4,.4,.4],'strict_grayscale').area,1);
  assert.equal(familyMembership([.1,.1,.1],'dark').area,1);
  assert.throws(()=>familyMembership([1,0,0],'monochromatic'),/global distribution/);
});
test('synthetic scale descriptors preserve mass, CDF and deterministic metadata',()=>{
  const source=[Buffer.alloc(16384*4),Buffer.alloc(16384*4)];
  for(let i=0;i<16384;i++){source[0][i*4]=255;source[0][i*4+3]=255;source[1][i*4+3]=255;}
  const features=source.map((pixels,i)=>({id:`source-${i}`,hsv64:Array.from({length:64},(_,bin)=>bin===(i===0?3:48)?1:0),...extractSampleFeatures(pixels)}));
  const validation=validateSyntheticSamples(features,{count:100});
  assert.equal(validation.massPreserved,true);
  const output=syntheticFeature(features,237);
  assert.equal(output.partition,37);
  assert.equal(output.rgb_cdf48[15],1);assert.equal(output.rgb_cdf48[31],1);assert.equal(output.rgb_cdf48[47],1);
  const hsvOnly=syntheticFeature(features,237,{fields:['hsv_l2']});
  assert.equal(hsvOnly.hsv64.length,64);assert.equal(hsvOnly.rgb4096,undefined);assert.equal(hsvOnly.coverage_tokens,undefined);
  assert.equal(syntheticFeature(features,237,{fields:['cov_red']}).hsv64,undefined);
});
