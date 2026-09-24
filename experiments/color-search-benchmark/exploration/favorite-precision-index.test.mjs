import test from 'node:test';
import assert from 'node:assert/strict';
import { favoritePrecisionIndexConfiguration, precisionDocumentForOrdinal } from './favorite-precision-index.mjs';
import { createFavoriteUtilityPlan, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { toFavoritePrecisionDocument, favoritePrecisionRankField } from './favorite-precision-utilities.mjs';
import { favoriteSyntheticDocument } from './favorite-scale-corpus.mjs';

const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const plan = createFavoriteUtilityPlan({ requests: [{ query }] });
const required = ['--index', 'color-exploration-favorite-precision-test', '--directory', '/tmp/favorite-precision-test'];

test('precision CLI defaults source off, preserves seed and isolates mode, count, encodings and artifacts', () => {
  const real = favoritePrecisionIndexConfiguration(required);
  assert.equal(real.mode, 'real'); assert.equal(real.scope, 'full'); assert.equal(real.count, 545);
  assert.equal(real.base, 'http://127.0.0.1:19216'); assert.equal(real.source, false);
  assert.equal(real.seed, 99539473); assert.deepEqual(real.encodings, ['rank18', 'rank27']);
  const scale = favoritePrecisionIndexConfiguration([...required, '--mode', 'scale', '--count', '1000000']);
  assert.equal(scale.scope, 'projection'); assert.equal(scale.count, 1000000); assert.equal(scale.source, false);
  assert.equal(scale.base, 'http://127.0.0.1:19217');
  const debug = favoritePrecisionIndexConfiguration([...required, '--source', 'true', '--presets', 'all', '--encodings', 'rank27', '--dry-run']);
  assert.equal(debug.source, true); assert.equal(debug.dryRun, true); assert.deepEqual(debug.encodings, ['rank27']);
  for (const suffix of [['--count', '123'], ['--encodings', 'rank16'], ['--encodings', 'rank18,rank18'],
    ['--base', 'http://127.0.0.1:19217'], ['--source', 'yes'], ['--presets', 'bad'], ['--scope', 'bad'], ['--unknown', '1'],
    ['--directory', process.cwd() + '/output']]) assert.throws(() => favoritePrecisionIndexConfiguration([...required, ...suffix]));
  assert.throws(() => favoritePrecisionIndexConfiguration([]));
});

test('synthetic measurements are mixed before nonlinear utility and digit encoding', () => {
  const sources = [0, 1].map((amount, i) => ({ id: 'source-' + i,
    ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? amount * 10000 : amount])) }));
  const config = favoritePrecisionIndexConfiguration([...required, '--mode', 'scale']);
  const inputs = { documents: sources };
  const measurement = favoriteSyntheticDocument(sources, 10, { seed: config.seed, coverageFields: plan.measurementFields.filter(field => field.startsWith('cov_')) });
  const actual = precisionDocumentForOrdinal({ ordinal: 10, config, inputs, plan });
  assert.deepEqual(actual, toFavoritePrecisionDocument(measurement, plan));
  const numeric = toFavoriteUtilityDocument(measurement, plan, { encodings: ['numeric'] });
  const value = numeric.utilities[plan.descriptors[0].key];
  const coverage = measurement[plan.measurementFields.find(field => field.startsWith('cov_'))] / 10000;
  assert.ok(Math.abs(value - Math.sqrt(coverage)) < 2e-7);
  assert.ok(Math.abs(value - coverage) > .01);
  const field = actual[favoritePrecisionRankField('rank18')], key = plan.descriptors[0].key;
  assert.equal((field[key + '_d0'] ?? 0) * 512 + (field[key + '_d1'] ?? 0), Math.round(value * 262143));
});

test('real mode retains controlled fixtures alongside real wallpapers and honors selected encoding', () => {
  const document = { id: 'fixture', cohort: 'fixture', tags: ['controlled'],
    ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? 2000 : .8])) };
  const config = favoritePrecisionIndexConfiguration([...required, '--encodings', 'rank27']);
  const indexed = precisionDocumentForOrdinal({ ordinal: 0, config, inputs: { documents: [document] }, plan });
  assert.equal(indexed.id, 'fixture'); assert.equal(indexed.cohort, 'fixture');
  assert.deepEqual(indexed.tags, ['controlled']);
  assert.equal(indexed[favoritePrecisionRankField('rank18')], undefined);
  assert.ok(indexed[favoritePrecisionRankField('rank27')]);
  assert.throws(() => precisionDocumentForOrdinal({ ordinal: 1, config, inputs: { documents: [document] }, plan }), /Missing/);
});
