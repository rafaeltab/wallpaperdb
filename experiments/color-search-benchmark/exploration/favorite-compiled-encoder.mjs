// Optional indexing-only refinement. Cache descriptor/preset names once without
// changing a single component calculation, float32 cast or stored utility.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { scoreFavoriteComponent } from './favorite-optimized-scoring.mjs';
import { createFavoriteUtilityPlan, toFavoriteUtilityDocument, favoriteUtilityRankField } from './favorite-utilities.mjs';
import { toFavoritePrecisionDocument, favoritePrecisionRankField } from './favorite-precision-utilities.mjs';
import { loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { CORPUS_STORE, hash } from './service.mjs';

const LEGACY = ['numeric', 'rank8', 'rank16', 'rankfloat'];
const PRECISION = ['rank18', 'rank27'];
const ALL = [...LEGACY, ...PRECISION];
function encodingsFor(encodings) {
  if (!Array.isArray(encodings) || !encodings.length || new Set(encodings).size !== encodings.length || encodings.some(encoding => !ALL.includes(encoding))) throw Error('Use distinct supported utility encodings.');
  return [...encodings];
}
const fieldFor = (encoding, parameters) => PRECISION.includes(encoding) ? favoritePrecisionRankField(encoding, parameters) : favoriteUtilityRankField(encoding, parameters);

/** Compatibility oracle and benchmark baseline. The original encoder functions
 * remain untouched. Cross-family results follow the selected encoding order. */
export function originalFavoriteEncodedDocument(measurement, plan, { encodings = ALL } = {}) {
  encodingsFor(encodings);
  const legacy = encodings.filter(encoding => LEGACY.includes(encoding)), precision = encodings.filter(encoding => PRECISION.includes(encoding));
  const old = legacy.length ? toFavoriteUtilityDocument(measurement, plan, { encodings: legacy }) : null;
  const refined = precision.length ? toFavoritePrecisionDocument(measurement, plan, { encodings: precision }) : null;
  const metadata = old ?? refined;
  const result = { id: metadata.id, reference_id: metadata.reference_id, cohort: metadata.cohort, partition: metadata.partition, tags: metadata.tags };
  if (old?.utilities) result.utilities = old.utilities;
  for (const encoding of encodings) if (encoding !== 'numeric') {
    const source = LEGACY.includes(encoding) ? old : refined;
    for (const [field, values] of Object.entries(source)) if (field.startsWith(`utility_${encoding}_`)) result[field] = values;
  }
  return result;
}

export function compileFavoriteUtilityEncoder(plan, { encodings = ALL } = {}) {
  encodings = encodingsFor(encodings);
  if (!Array.isArray(plan?.descriptors) || !Array.isArray(plan?.measurementFields)) throw Error('A utility plan with descriptors and measurement fields is required.');
  const selected = new Set(encodings), fields = [], positions = new Map();
  // Preserve exactly the existing per-family field insertion order.
  for (const encoding of encodings) if (encoding !== 'numeric') for (const descriptor of plan.descriptors) {
    const name = fieldFor(encoding, descriptor.parameters);
    if (!positions.has(name)) { positions.set(name, fields.length); fields.push(name); }
  }
  const required = plan.measurementFields.map(field => ({ field, coverage: field.startsWith('cov_') }));
  const descriptors = plan.descriptors.map(descriptor => {
    const spec = { key: descriptor.key, components: descriptor.scoreComponents.map(component => ({ ...component })) };
    for (const encoding of encodings) if (encoding !== 'numeric') spec[encoding] = positions.get(fieldFor(encoding, descriptor.parameters));
    if (selected.has('rank16')) { spec.hi16 = descriptor.key + '_hi'; spec.lo16 = descriptor.key + '_lo'; }
    if (selected.has('rank18') || selected.has('rank27')) {
      spec.d0 = descriptor.key + '_d0'; spec.d1 = descriptor.key + '_d1'; spec.d2 = descriptor.key + '_d2';
    }
    return spec;
  });
  const numeric = selected.has('numeric'), rank8 = selected.has('rank8'), rank16 = selected.has('rank16');
  const rankfloat = selected.has('rankfloat'), rank18 = selected.has('rank18'), rank27 = selected.has('rank27');
  const encode = measurement => {
    if (typeof measurement.id !== 'string' || !measurement.id) throw Error('A measured wallpaper ID is required.');
    for (const { field, coverage } of required) {
      const value = measurement[field];
      if (!Number.isFinite(value) || value < 0 || value > (coverage ? 10000 : 1) || (coverage && !Number.isInteger(value))) throw Error('Missing or invalid favorite measurement: ' + field);
    }
    const result = { id: measurement.id, reference_id: measurement.reference_id ?? measurement.id, cohort: measurement.cohort ?? 'real',
      partition: measurement.partition ?? 0, tags: measurement.tags ?? [] };
    const values = numeric ? (result.utilities = {}) : null;
    const groups = fields.map(field => (result[field] = {}));
    for (const descriptor of descriptors) {
      let sum = 0;
      for (const component of descriptor.components) sum += scoreFavoriteComponent(measurement, component);
      const value = Math.fround(Math.max(0, Math.min(1, sum)));
      if (numeric) values[descriptor.key] = value;
      if (rank8) { const integer = Math.round(value * 255); if (integer) groups[descriptor.rank8][descriptor.key] = integer; }
      if (rank16) {
        const integer = Math.round(value * 65535), high = integer >>> 8, low = integer & 255;
        if (high) groups[descriptor.rank16][descriptor.hi16] = high;
        if (low) groups[descriptor.rank16][descriptor.lo16] = low;
      }
      if (rankfloat && value > 0) groups[descriptor.rankfloat][descriptor.key] = value;
      if (rank18) {
        const integer = Math.round(value * 262143), high = Math.floor(integer / 512), low = integer - high * 512;
        if (high) groups[descriptor.rank18][descriptor.d0] = high;
        if (low) groups[descriptor.rank18][descriptor.d1] = low;
      }
      if (rank27) {
        const integer = Math.round(value * 134217727), high = Math.floor(integer / 262144), remainder = integer - high * 262144;
        const middle = Math.floor(remainder / 512), low = remainder - middle * 512;
        if (high) groups[descriptor.rank27][descriptor.d0] = high;
        if (middle) groups[descriptor.rank27][descriptor.d1] = middle;
        if (low) groups[descriptor.rank27][descriptor.d2] = low;
      }
    }
    return result;
  };
  encode.definition = Object.freeze({ version: 1, utilityCount: descriptors.length, requiredMeasurements: required.length,
    encodings: Object.freeze(encodings), fields: Object.freeze(fields), planHash: hash(plan),
    arithmetic: 'Unchanged scoreFavoriteComponent; identical ordered sums, final clamp/float32 cast and digit quantization.' });
  return encode;
}

const describe = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { totalMs: samples.reduce((sum, value) => sum + value, 0), meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] };
};

export async function benchmarkFavoriteCompiledEncoder({ samples = 32, directory } = {}) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 545) throw Error('Encoder samples must be1..545.');
  const destination = path.resolve(directory ?? path.join(CORPUS_STORE, 'exploration', 'favorite-compiled-encoder', new Date().toISOString().replaceAll(':', '-')));
  const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  if (destination === path.parse(destination).root || destination === repository || destination.startsWith(repository + path.sep)) throw Error('Use an external benchmark output directory.');
  await mkdir(path.dirname(destination), { recursive: true }); await mkdir(destination);
  const sourceSnapshot = await favoriteSourceSnapshot(import.meta.url);
  await writeFile(path.join(destination, 'source-snapshot.json'), JSON.stringify(sourceSnapshot), { flag: 'wx' });
  const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 });
  const documents = Array.from({ length: Math.min(samples, verified.documents.length) }, (_, i) => verified.documents[Math.floor(i * verified.documents.length / Math.min(samples, verified.documents.length))]);
  const plan = createFavoriteUtilityPlan(), result = { schemaVersion: 1, startedAt: new Date().toISOString(), noServiceRequests: true,
    directory: destination, sourceSnapshotHash: hash(sourceSnapshot), sourceIdentityHash: verified.identityHash, source: verified.source,
    utilityCount: plan.utilityCount, planHash: hash(plan), selectedIds: documents.map(document => document.id), selectedDocumentsHash: hash(documents),
    limitations: ['Offline indexing CPU comparison; does not measure query speed, bulk HTTP, OpenSearch ingestion, storage or end-to-end million-document indexing.',
      'Encode timing excludes serialization and correctness comparison; old/new order alternates per document to reduce ordering bias.'], rows: [] };
  for (const encodings of [['rank16'], ['rank18'], ['numeric', 'rank8', 'rank16', 'rankfloat']]) {
    const started = performance.now(), encode = compileFavoriteUtilityEncoder(plan, { encodings }), compileMs = performance.now() - started;
    originalFavoriteEncodedDocument(documents[0], plan, { encodings }); encode(documents[0]);
    const timings = [];
    for (let i = 0; i < documents.length; i++) {
      const outputs = {}, elapsed = {};
      for (const kind of (i % 2 ? ['compiled', 'original'] : ['original', 'compiled'])) {
        const before = performance.now();
        outputs[kind] = kind === 'compiled' ? encode(documents[i]) : originalFavoriteEncodedDocument(documents[i], plan, { encodings });
        elapsed[kind] = performance.now() - before;
      }
      const original = JSON.stringify(outputs.original), compiled = JSON.stringify(outputs.compiled);
      assert.equal(compiled, original, `Byte parity failed: ${documents[i].id}`);
      timings.push({ id: documents[i].id, originalMs: elapsed.original, compiledMs: elapsed.compiled, serializedBytes: Buffer.byteLength(original), documentHash: hash(original) });
    }
    const original = describe(timings.map(row => row.originalMs)), compiled = describe(timings.map(row => row.compiledMs));
    const row = { encodings, count: documents.length, compileMs, original, compiled, speedup: original.totalMs / compiled.totalMs,
      byteIdentical: true, timings };
    result.rows.push(row); console.log(JSON.stringify({ encodings, count: row.count, compileMs, original, compiled, speedup: row.speedup, byteIdentical: true }));
  }
  assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash, 'Encoder benchmark sources changed');
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(destination, 'benchmark.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.shift() !== '--benchmark') throw Error('Use --benchmark [--samples32] [--directory NEW_EXTERNAL_DIRECTORY].');
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--samples', '--directory'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Unknown or missing benchmark option: ' + args[i]);
    const name = args[i].slice(2), value = args[++i]; options[name] = name === 'samples' ? Number(value) : value;
  }
  const result = await benchmarkFavoriteCompiledEncoder(options);
  console.log(JSON.stringify({ directory: result.directory, byteIdentical: result.rows.every(row => row.byteIdentical) }));
}
