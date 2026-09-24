import test from 'node:test';
import assert from 'node:assert/strict';
import { mixOverlapDocuments, syntheticOverlapDocument } from './overlap-scale-corpus.mjs';

test('mixes area and quality mass separately, including overlapping regions and zeros', () => {
  const a = { id:'a', cov_o0000:10000, quality_o0000:1, cov_o0001:10000, quality_o0001:.5, cov_dark:0, quality_dark:0 };
  const b = { id:'b', cov_o0000:0, quality_o0000:0, cov_o0001:5000, quality_o0001:1, cov_dark:0, quality_dark:0 };
  const mixed = mixOverlapDocuments(a,b,.25,7);
  assert.equal(mixed.cov_o0000,2500);
  assert.equal(mixed.quality_o0000,1); // not .25: quality is conditional on matching area
  assert.equal(mixed.cov_o0001,6250);
  assert.ok(Math.abs(mixed.quality_o0001-.8)<1e-7);
  assert.equal(mixed.cov_dark,0);
  assert.equal(mixed.quality_dark,0);
  const both = mixOverlapDocuments(a,a,.5,8);
  assert.equal(both.cov_o0000+both.cov_o0001,20000); // no normalization between regions
});

test('synthetic documents have deterministic independent identities and varied mixtures', () => {
  const documents = [{id:'a',cov_o0000:10000,quality_o0000:1},{id:'b',cov_o0000:0,quality_o0000:0}];
  const first = syntheticOverlapDocument(documents,123);
  assert.deepEqual(first,syntheticOverlapDocument(documents,123));
  assert.notEqual(first.id,syntheticOverlapDocument(documents,124).id);
  assert.equal(first.partition,23);
  assert.equal(first.quality_o0000,1);
  assert.ok(first.cov_o0000>0&&first.cov_o0000<10000);
  assert.throws(()=>syntheticOverlapDocument([],0));
  assert.throws(()=>mixOverlapDocuments(documents[0],documents[1],2,0));
});
