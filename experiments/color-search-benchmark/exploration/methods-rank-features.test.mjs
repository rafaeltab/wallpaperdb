import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRankFeatureQuery,rankFeatureReference,supportsRankFeatures,RANK_FEATURE_METHODS } from './methods-rank-features.mjs';
import { toRankFeatureDocument,RANK_FEATURE_INDEX } from './rank-features-index.mjs';
import { searchIndex,loadFeatures } from './service.mjs';
test('target interpolation is exact for1%-quantized area at every kink',()=>{
  for(let actual=0;actual<=100;actual++)for(const target of [.01,.3,actual+.2,40.5,99.9,100].filter(v=>v<=100)){
    const feature={id:'test',cov_red:actual*100,quality_red:1};
    const doc=toRankFeatureDocument(feature),query={mode:'proportions',targets:[{name:'red',percent:target}]};
    const request=buildRankFeatureQuery({method:'rank-features-area',query});
    const score=1e-6+request.query.bool.should.reduce((sum,clause)=>sum+(doc.utilities[clause.rank_feature.field.replace('utilities.','')]??0)*clause.rank_feature.boost,0);
    assert.ok(Math.abs(score-rankFeatureReference(feature,query,'rank-features-area'))<1e-12);
  }
});
test('profiles contain only positive exactly representable integers',()=>{
  const document=toRankFeatureDocument({id:'test',cov_red:4055,quality_red:.731});
  for(const value of Object.values(document.utilities)){assert.ok(Number.isInteger(value)&&value>0&&value<=255);}
  assert.ok(!('area_green_100' in document.utilities));
  const body=buildRankFeatureQuery({query:{text:'green'},eligibleIds:['a','b'],excludedIds:['b']});
  assert.equal(body.query.bool.minimum_should_match,0);assert.equal(body.track_total_hits,false);
  assert.equal(body.query.bool.must[0].constant_score.boost,1e-6);
  assert.equal(body.query.bool.filter[0].bool.must_not[0].ids.values[0],'b');
});
test('unindexed custom ranges and joint accent models are explicit unsupported cases',()=>{
  assert.equal(supportsRankFeatures('rank-features-vibe',{swatchHex:'#ff2200'}).supported,false);
  assert.equal(supportsRankFeatures('rank-features-vibe',{text:'grayscale with red accents'}).supported,false);
});
test('real OpenSearch scores match complete mathematical utility oracle', {skip:process.env.COLOR_EXPLORATION_RANK_FEATURE_INTEGRATION!=='1'},async()=>{
  const features=await loadFeatures(),byId=new Map(features.map(feature=>[feature.id,feature]));
  const queries=[{text:'red'},{text:'grayscale'},{mode:'proportions',targets:[{name:'green',percent:40.3}]},{mode:'proportions',targets:[{name:'red',percent:50},{name:'green',percent:50}]},{mode:'proportions',targets:[{name:'grayscale',percent:80},{name:'red',percent:20}]}];
  for(const method of RANK_FEATURE_METHODS)for(const query of queries){
    const {hits}=await searchIndex(RANK_FEATURE_INDEX,buildRankFeatureQuery({method,query,limit:1000}));
    assert.equal(hits.length,545);
    for(const hit of hits)assert.ok(Math.abs(hit.score-rankFeatureReference(byId.get(hit.id),query,method))<2e-7,`${method.id} ${hit.id}: ${hit.score}`);
  }
});
