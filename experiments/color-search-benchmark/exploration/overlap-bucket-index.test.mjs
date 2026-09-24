import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLAP_REGIONS, OVERLAP_DEFINITION, nearestOverlapRegion, regionFields } from './overlap-regions.mjs';
import { overlapMapping, loadOverlapDocuments } from './overlap-index.mjs';
import { OVERLAP_BUCKET_COUNTS, overlapRegionsForCount, overlapDefinitionForCount, nearestOverlapRegionForCount, overlapIndexForCount } from './overlap-banks.mjs';
import { projectOverlapDocument, overlapBucketMapping, validateProjectedOverlapDocuments, verifyOverlapBucketIndex } from './overlap-bucket-index.mjs';

test('nested banks keep original IDs and geometry, and 1024 keeps original objects and selection', () => {
  assert.deepEqual(OVERLAP_BUCKET_COUNTS, [16, 64, 256, 1024]);
  assert.equal(overlapRegionsForCount(), OVERLAP_REGIONS);
  assert.equal(overlapDefinitionForCount(), OVERLAP_DEFINITION);
  assert.equal(overlapIndexForCount(), 'color-exploration-overlap-real-v1');
  for (const count of OVERLAP_BUCKET_COUNTS) {
    const regions = overlapRegionsForCount(count);
    assert.equal(regions.length, count);
    assert.equal(new Set(regions.map(region => region.index)).size, count);
    assert.ok(Object.isFrozen(regions));
    assert.deepEqual(regions.slice(0, 8), OVERLAP_REGIONS.slice(0, 8));
    for (const region of regions) assert.equal(region, OVERLAP_REGIONS[region.index]);
    assert.equal(overlapDefinitionForCount(count).radius, .12);
    assert.equal(overlapDefinitionForCount(count).edgeWeight, .5);
    assert.equal(overlapDefinitionForCount(count).sampleSize, 128);
  }
  assert.deepEqual(overlapRegionsForCount(64).slice(0, 16), overlapRegionsForCount(16));
  assert.deepEqual(overlapRegionsForCount(256).slice(0, 64), overlapRegionsForCount(64));
  assert.ok(overlapRegionsForCount(16).some(region => region.index >= 16));
  for (const lab of OVERLAP_REGIONS.filter((_, index) => index % 31 === 0).map(region => region.lab)) {
    assert.equal(nearestOverlapRegionForCount(lab), nearestOverlapRegion(lab));
    for (const count of [16, 64, 256]) {
      const nearest = nearestOverlapRegionForCount(lab, count);
      const distance = region => region.lab.reduce((sum, value, index) => sum + (value - lab[index]) ** 2, 0);
      assert.equal(distance(nearest), Math.min(...overlapRegionsForCount(count).map(distance)));
    }
  }
});

test('count contracts reject coercion, unsupported counts and invalid colors', () => {
  for (const count of ['16', null, 0, 17, 64.5, Infinity, NaN, {}, []]) {
    for (const fn of [overlapRegionsForCount, overlapDefinitionForCount, overlapIndexForCount]) assert.throws(() => fn(count), /bucket count/);
    assert.throws(() => nearestOverlapRegionForCount([.5, 0, 0], count), /bucket count/);
  }
  for (const lab of [null, [0], [0, 0, Infinity], 'red']) assert.throws(() => nearestOverlapRegionForCount(lab, 16), /OKLab/);
});

function sampleDocument(id = 'sample') {
  const document = { id, reference_id: id, cohort: 'real', partition: 0, tags: ['city'], overlap_pixel_total: 16384, cov_red: 1234, quality_red: .75 };
  for (const region of OVERLAP_REGIONS) {
    const fields = regionFields(region.index);
    document[fields.coverage] = region.index % 3 ? region.index : 0;
    document[fields.quality] = region.index % 3 ? Math.fround(.5 + region.index / 2048) : 0;
  }
  return document;
}

test('projection retains exact values, explicit zeros and all non-region data without mutation', () => {
  const original = sampleDocument(), originalBytes = JSON.stringify(original);
  assert.equal(JSON.stringify(projectOverlapDocument(original)), originalBytes);
  for (const count of [16, 64, 256]) {
    const projected = projectOverlapDocument(original, count), fields = new Set(overlapRegionsForCount(count).flatMap(region => Object.values(regionFields(region.index))));
    assert.equal(Object.keys(projected).filter(key => /^(cov|quality)_o\d{4}$/.test(key)).length, 2 * count);
    for (const [field, value] of Object.entries(original)) if (!/^(cov|quality)_o\d{4}$/.test(field) || fields.has(field)) assert.deepEqual(projected[field], value);
    assert.equal(JSON.stringify(original), originalBytes);
    assert.equal(validateProjectedOverlapDocuments([projected], [original], count), true);
    assert.throws(() => validateProjectedOverlapDocuments([{ ...projected, cov_o0000: 99 }], [original], count), /values/);
    assert.throws(() => validateProjectedOverlapDocuments([{ ...projected, cov_o9999: 0 }], [original], count), /values/);
    assert.throws(() => validateProjectedOverlapDocuments([projected, projected], [original], count), /IDs/);
    assert.throws(() => validateProjectedOverlapDocuments([], [original], count), /IDs/);
  }
  assert.throws(() => projectOverlapDocument({ id: 'missing-fields' }, 16), /coverage/);
});

test('each mapping contains only selected region pairs and preserves the original 1024 mapping', () => {
  assert.deepEqual(overlapBucketMapping(), overlapMapping());
  for (const count of [16, 64, 256]) {
    const mapping = overlapBucketMapping({ bucketCount: count }), properties = mapping.mappings.properties;
    assert.equal(mapping.mappings.dynamic, 'strict');
    assert.equal(Object.keys(properties).filter(key => /^(cov|quality)_o\d{4}$/.test(key)).length, 2 * count);
    for (const region of overlapRegionsForCount(count)) {
      const fields = regionFields(region.index);
      assert.equal(properties[fields.coverage].type, 'integer');
      assert.equal(properties[fields.quality].type, 'float');
    }
    assert.deepEqual(properties.cov_red, { type: 'integer' });
    assert.deepEqual(properties.quality_red, { type: 'float' });
  }
});

test('all real bucket indexes contain exact immutable projections and all corpus IDs', { skip: !process.env.COLOR_OVERLAP_INTEGRATION }, async () => {
  const original = await loadOverlapDocuments();
  for (const bucketCount of OVERLAP_BUCKET_COUNTS) {
    const result = await verifyOverlapBucketIndex({ bucketCount, expectedIds: original.map(document => document.id) });
    assert.equal(result.count, original.length);
    assert.equal(result.completeIdsVerified, true);
    if (bucketCount !== 1024) assert.equal(result.projectionValuesVerified, true);
  }
});
