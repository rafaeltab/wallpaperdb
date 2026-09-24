import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteUtilityIndexConfiguration, favoriteUtilityBatcher, validateUtilityBulk, utilityDocumentForOrdinal } from './favorite-utility-index.mjs';
import { createFavoriteUtilityPlan, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { favoriteSyntheticDocument } from './favorite-scale-corpus.mjs';
import { resolveCutoffTargets } from './methods-cutoff.mjs';

const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const plan = createFavoriteUtilityPlan({ requests: [{ query }] });
const args = ['--mode', 'scale', '--scope', 'projection', '--count', '100000', '--index', 'color-exploration-favorite-utils-test', '--directory', '/tmp/favorite-utils-test'];

test('CLI pins original seed and enforces mode, count, service, encoding and output isolation', () => {
  const parsed = favoriteUtilityIndexConfiguration(args);
  assert.equal(parsed.seed, 99539473);
  assert.equal(parsed.source, false);
  assert.equal(parsed.base, 'http://127.0.0.1:19217');
  assert.equal(parsed.count, 100000);
  assert.equal(favoriteUtilityIndexConfiguration([...args, '--source', 'true']).source, true);
  for (const suffix of [['--count', '123'], ['--base', 'http://127.0.0.1:9200'], ['--encodings', 'bad'], ['--scope', 'bad'], ['--presets', 'bad'], ['--source', 'yes'], ['--unknown', '1']]) assert.throws(() => favoriteUtilityIndexConfiguration([...args, ...suffix]));
  assert.throws(() => favoriteUtilityIndexConfiguration(['--mode', 'real']));
  assert.throws(() => favoriteUtilityIndexConfiguration([...args, '--directory', process.cwd() + '/tmp-test']));
});

test('byte bounded bulk batching preserves every doc and isolates a single oversized document', () => {
  const batcher = favoriteUtilityBatcher({ maximumBytes: 120 });
  const batches = [];
  for (const document of [{ id: 'a', value: 'a' }, { id: 'b', value: 'b'.repeat(200) }, { id: 'c', value: 'c' }]) batches.push(...batcher.add(document));
  batches.push(...batcher.finish());
  assert.deepEqual(batches.flatMap(batch => batch.ids), ['a', 'b', 'c']);
  assert.equal(batches.length, 3);
  for (const batch of batches) {
    assert.equal(Buffer.byteLength(batch.body), batch.bytes);
    assert.ok(batch.bytes <= 120 || batch.ids.length === 1);
    assert.ok(batch.body.endsWith('\n'));
    assert.ok(batch.body.includes('"create"'));
  }
});

test('bulk validation rejects partial, duplicate/conflicting and reordered acknowledgements', () => {
  const batch = { ids: ['a', 'b'] };
  const correct = { errors: false, items: [{ create: { _id: 'a', status: 201 } }, { create: { _id: 'b', status: 201 } }] };
  assert.equal(validateUtilityBulk(correct, batch), 2);
  assert.throws(() => validateUtilityBulk({ ...correct, errors: true }, batch));
  assert.throws(() => validateUtilityBulk({ items: correct.items.slice(0, 1) }, batch));
  assert.throws(() => validateUtilityBulk({ items: [...correct.items].reverse() }, batch));
  assert.throws(() => validateUtilityBulk({ items: [{ create: { _id: 'a', status: 409 } }, correct.items[1]] }, batch));
});

test('synthetic documents mix source measurements before nonlinear utility calculation', () => {
  const components = resolveCutoffTargets('cutoff-shade-hue-all-levels', query, { parameters: { bucketCount: 256, qualityInfluence: .5, cutoffBlendExponent: 1 } }).targets[0].components;
  const sources = [0, 1].map((area, i) => {
    const doc = { id: 'source-' + i };
    for (const component of components) { doc[component.coverageField] = area * 10000; doc[component.qualityField] = area; }
    return doc;
  });
  const config = favoriteUtilityIndexConfiguration(args), inputs = { documents: sources };
  const expectedMeasurement = favoriteSyntheticDocument(sources, 10, { seed: config.seed, coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) });
  const expected = toFavoriteUtilityDocument(expectedMeasurement, plan, { encodings: config.encodings });
  assert.deepEqual(utilityDocumentForOrdinal({ ordinal: 10, config, inputs, plan }), expected);
  const area = expectedMeasurement[components[0].coverageField] / 10000;
  const utility = expected.utilities[plan.descriptors[0].key];
  assert.ok(Math.abs(utility - Math.sqrt(area)) < 2e-7);
  assert.ok(Math.abs(utility - area) > .01, 'Interpolating endpoint utilities would incorrectly give area instead of sqrt(area).');
});
