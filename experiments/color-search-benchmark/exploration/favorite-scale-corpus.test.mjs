import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cutoffFields } from './cutoff-definition.mjs';
import { resolveCutoffTargets, buildCutoffQuery } from './methods-cutoff.mjs';
import { mixOverlapDocuments } from './overlap-scale-corpus.mjs';
import { hash } from './service.mjs';
import {
  FAVORITE_METHOD, FAVORITE_PARAMETERS, FAVORITE_VARIANTS, FAVORITE_WORKLOAD,
  FAVORITE_SNAPSHOT_SHA256, favoriteProjectionFields, favoriteProjectionMapping,
  projectFavoriteDocument, favoriteSyntheticDocument, favoriteEligibleCount,
  assertFavoriteSnapshotPins, dryRunFavoriteInputs, loadFavoriteScaleInputs,
} from './favorite-scale-corpus.mjs';

test('favorite settings and query projection preserve every five-layer query component', () => {
  assert.equal(FAVORITE_METHOD, 'cutoff-shade-hue-all-levels');
  assert.deepEqual(FAVORITE_VARIANTS.map(v => v.parameters.bucketCount), [256, 1024]);
  assert.equal(FAVORITE_PARAMETERS.qualityCurve, 'linear');
  assert.equal(FAVORITE_PARAMETERS.qualityInfluence, .5);
  assert.equal(FAVORITE_PARAMETERS.cutoffBlendExponent, 1);
  assert.equal(FAVORITE_WORKLOAD.length, 12);
  const fields = favoriteProjectionFields(), set = new Set(fields);
  const mapping = favoriteProjectionMapping(fields);
  assert.equal(mapping.mappings.dynamic, 'strict');
  assert.equal(mapping.mappings._source.enabled, false);
  assert.ok(fields.length > 0 && fields.length < 2560);
  assert.equal(set.size, fields.length);
  for (const variant of FAVORITE_VARIANTS) for (const item of FAVORITE_WORKLOAD) {
    const resolved = resolveCutoffTargets(variant.method, item.query, { parameters: variant.parameters });
    for (const target of resolved.targets) {
      assert.deepEqual(target.components.map(c => c.pixelCutoff), [0, .25, .5, .75, .9]);
      for (const component of target.components) {
        assert.ok(set.has(component.coverageField));
        assert.ok(set.has(component.qualityField));
        assert.equal(mapping.mappings.properties[component.coverageField].type, 'integer');
        assert.equal(mapping.mappings.properties[component.qualityField].type, 'float');
      }
    }
    const query = buildCutoffQuery({ ...variant, query: item.query, filter: item.filter });
    assert.ok(!JSON.stringify(query).includes('script_score'));
  }
});

test('projection rejects missing fields, invalid measurements and foreign metric fields', () => {
  const fields = Object.values(cutoffFields(4, 'hard', .5));
  const source = { id: 'a', tags: ['real'], [fields[0]]: 1234, [fields[1]]: .75, irrelevant: 3 };
  assert.ok(!Object.hasOwn(projectFavoriteDocument(source, fields), 'irrelevant'));
  assert.throws(() => projectFavoriteDocument({ ...source, [fields[1]]: undefined }, fields), /measurement/);
  assert.throws(() => projectFavoriteDocument({ ...source, [fields[0]]: 10001 }, fields), /measurement/);
  assert.throws(() => projectFavoriteDocument({ ...source, [fields[0]]: .1 }, fields), /measurement/);
  assert.throws(() => favoriteProjectionMapping(['cov_o0004_feather_q50']), /field/);
});

test('mixtures preserve nested coverage and conditional quality mass including zero area', () => {
  const a = { id: 'a' }, b = { id: 'b' }, coverageFields = [];
  for (const cutoff of [0, .25, .5, .75, .9]) {
    const fields = cutoffFields(4, 'hard', cutoff); coverageFields.push(fields.coverage);
    a[fields.coverage] = cutoff <= .75 ? 10000 : 0;
    a[fields.quality] = cutoff <= .75 ? .8 : 0;
    b[fields.coverage] = cutoff <= .25 ? 10000 : 0;
    b[fields.quality] = cutoff <= .25 ? .4 : 0;
  }
  const mixed = mixOverlapDocuments(a, b, .25, 3, coverageFields);
  assert.deepEqual(coverageFields.map(f => mixed[f]), [10000, 10000, 2500, 2500, 0]);
  assert.equal(mixed.quality_o0004_hard_q00, .5);
  assert.equal(mixed.quality_o0004_hard_q50, Math.fround(.8));
  assert.equal(mixed.quality_o0004_hard_q90, 0);
  const first = favoriteSyntheticDocument([a, b], 101, { seed: 42, coverageFields });
  assert.deepEqual(first, favoriteSyntheticDocument([a, b], 101, { seed: 42, coverageFields }));
  assert.equal(first.id, 'favorite-synthetic-000000101');
  assert.equal(first.cohort, 'favorite-synthetic-mixture');
  assert.ok(first.tags.includes('synthetic-one-percent'));
  assert.equal(first.overlap_pixel_total, 16384);
  assert.throws(() => favoriteSyntheticDocument([a, b], 101, { seed: NaN, coverageFields }), /seed/);
});

test('filter counts match generated synthetic documents without changing their color values', () => {
  const sources = [{ id: 'a', cov_o0004_hard_q00: 10000, quality_o0004_hard_q00: .7 }];
  for (const count of [1, 2, 10, 99, 100, 105]) {
    const documents = Array.from({ length: count }, (_, index) => favoriteSyntheticDocument(sources, index));
    for (const item of FAVORITE_WORKLOAD) {
      const eligible = item.selectivity === 'tag1' ? documents.filter(d => d.tags.includes('synthetic-one-percent'))
        : item.selectivity === 'partition10' ? documents.filter(d => d.partition < 10) : documents;
      assert.equal(favoriteEligibleCount(count, item), eligible.length);
    }
  }
  assert.throws(() => favoriteEligibleCount(10, { selectivity: 'unknown' }), /selectivity/);
});

test('snapshot verification rejects archive, source and parameter drift', async () => {
  const bytes = await readFile(new URL('./snapshots/strict-hue-favorite-001.json', import.meta.url));
  const snapshot = JSON.parse(bytes);
  const evidence = { manifestHash: hash(bytes), archiveHash: snapshot.sourceArchive.sha256,
    inventoryHash: snapshot.sourceArchive.inventory.sha256, sourceHashes: snapshot.measurements.sourceHashes };
  assert.equal(hash(bytes), FAVORITE_SNAPSHOT_SHA256);
  assert.equal(assertFavoriteSnapshotPins(snapshot, evidence), true);
  assert.throws(() => assertFavoriteSnapshotPins(snapshot, { ...evidence, archiveHash: 'wrong' }), /archive/);
  assert.throws(() => assertFavoriteSnapshotPins(snapshot, { ...evidence, manifestHash: 'wrong' }), /manifest/);
  assert.throws(() => assertFavoriteSnapshotPins(snapshot, { ...evidence, sourceHashes: { ...evidence.sourceHashes, 'hue-definition.mjs': 'wrong' } }), /hue-definition/);
  assert.throws(() => assertFavoriteSnapshotPins({ ...snapshot, userPreferences: { ...snapshot.userPreferences, preferredQualityInfluence: 1 } }, evidence), /parameters/);
});

test('dry run measures serialized synthetic documents without any service request', () => {
  const fields = ['cov_o0004_hard_q00', 'quality_o0004_hard_q00'];
  const inputs = { scope: 'projection', documents: [{ id: 'a', [fields[0]]: 10000, [fields[1]]: 1 }],
    fields, coverageFields: [fields[0]], mapping: favoriteProjectionMapping(fields), variants: FAVORITE_VARIANTS,
    source: { sourceCount: 1 }, identityHash: 'example' };
  const result = dryRunFavoriteInputs({ inputs, samples: 3 });
  assert.equal(result.noServiceRequests, true);
  assert.equal(result.samples, 3);
  assert.ok(result.meanSerializedDocumentBytes > 100);
  assert.equal(result.fullIndexCapacityMeasured, false);
  assert.throws(() => dryRunFavoriteInputs({ inputs, samples: 0 }), /samples/);
});

test('local snapshot verification loads all original measurements and selects only523real sources', { skip: process.env.COLOR_FAVORITE_VERIFY !== '1' }, async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Offline source verification must never contact a service.'); };
  try {
    const inputs = await loadFavoriteScaleInputs();
    assert.equal(inputs.documents.length, 523);
    assert.equal(inputs.source.verifiedOriginalCount, 545);
    assert.equal(inputs.source.receipts.length, 2);
    assert.equal(inputs.mapping.mappings._source.enabled, false);
    assert.equal(inputs.documents.filter(document => document.id.startsWith('madness-')).length, 418);
    assert.ok(inputs.documents.some(document => document.id === 'wallpaper-100'));
    assert.ok(!inputs.documents.some(document => document.id.startsWith('composition-')));
    const dryRun = dryRunFavoriteInputs({ inputs, samples: 10 });
    assert.ok(dryRun.meanSerializedDocumentBytes > 100);
    assert.equal(dryRun.noServiceRequests, true);
  } finally { globalThis.fetch = previousFetch; }
});
