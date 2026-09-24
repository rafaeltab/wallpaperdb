import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash } from './service.mjs';
import {
  favoriteScaleConfiguration, favoriteScaleCases, validateFavoriteResume,
  remainingFavoriteConcurrencies, summarizeFavoriteTrials, settleFavoriteActivity,
  validateFavoriteStoredFields, favoriteCreateBody,
  compactFavoriteTrial, createFavoriteRecorder,
} from './favorite-scale.mjs';

test('favorite scale pins the endorsed tuning and separates every query and bank', () => {
  const config = favoriteScaleConfiguration(), cases = favoriteScaleCases(config);
  assert.deepEqual(config.counts, [100000, 1000000]);
  assert.deepEqual(config.concurrencies, [1, 4, 16]);
  assert.equal(config.requests, 32);
  assert.equal(config.durationSeconds, 10);
  assert.equal(cases.length, 24);
  assert.equal(new Set(cases.map(item => item.id)).size, 24);
  for (const item of cases) {
    assert.equal(item.method, 'cutoff-shade-hue-all-levels');
    assert.equal(item.parameters.qualityCurve, 'linear');
    assert.equal(item.parameters.qualityInfluence, 0.5);
    assert.equal(item.parameters.cutoffBlendExponent, 1);
    assert.equal(item.parameters.minimumQuality, 0);
    assert.equal(item.parameters.namedMode, 'concrete-swatches');
    assert.ok([256, 1024].includes(item.parameters.bucketCount));
    assert.ok(['all', 'partition10', 'tag1'].includes(item.selectivity));
  }
  const full = favoriteScaleConfiguration(['--scope', 'full', '--bucket-count', '256']);
  assert.equal(favoriteScaleCases(full).length, 12);
  assert.ok(favoriteScaleCases(full).every(item => item.parameters.bucketCount === 256));
});

test('bounded configuration rejects accidental tuning and invalid measurement controls', () => {
  for (const args of [
    ['--scope', 'full'], ['--bucket-count', '64'], ['--quality-influence', '3'],
    ['--counts', '100,100'], ['--counts', '1000001'], ['--counts', '0'],
    ['--concurrency', '4,1'], ['--concurrency', '3'], ['--requests', '31'],
    ['--duration-seconds', '-1'], ['--requests'], ['--index', 'production'],
  ]) assert.throws(() => favoriteScaleConfiguration(args), undefined, JSON.stringify(args));
  assert.equal(favoriteScaleConfiguration(['--dry-run']).dryRun, true);
});

function resumeFixture() {
  const expectedMapping = { mappings: { dynamic: 'strict', _source: { enabled: false }, properties: { id: { type: 'keyword' }, cov: { type: 'integer' } } } };
  const identity = { corpusHash: 'frozen-shade-hue', scope: 'projection', sourceHashes: { driver: 'frozen' } }, identityHash = hash(identity);
  const mapping = { ...expectedMapping.mappings, _meta: { experiment: 'strict-hue-favorite-scale', identity, identityHash } };
  return { checkpoint: { identityHash, nextIndex: 100, batchSize: 20 }, identity, identityHash, mapping, expectedMapping, actual: 100, nextBatchSize: 20 };
}

test('resume permits one deterministic partial bulk and rejects foreign or changed data', () => {
  const data = resumeFixture();
  assert.equal(validateFavoriteResume(data), true);
  assert.equal(validateFavoriteResume({ ...data, actual: 119 }), true);
  const reordered = { ...data.mapping, properties: { cov: { type: 'integer' }, id: { type: 'keyword' } } };
  assert.equal(validateFavoriteResume({ ...data, mapping: reordered }), true);
  for (const patch of [
    { actual: 99 }, { actual: 121 }, { actual: 119, nextBatchSize: 10 },
    { checkpoint: null }, { checkpoint: { ...data.checkpoint, identityHash: 'other' } },
    { mapping: { ...data.mapping, _source: { enabled: true } } },
    { mapping: { ...data.mapping, _meta: { ...data.mapping._meta, identity: {} } } },
    { mapping: { ...data.mapping, properties: { ...data.mapping.properties, unexpected: { type: 'float' } } } },
  ]) assert.throws(() => validateFavoriteResume({ ...data, ...patch }));
});

test('warmup failure stops higher concurrency and resumed failures cannot be bypassed', () => {
  const requested = [1, 4, 16];
  assert.deepEqual(remainingFavoriteConcurrencies({ requested, profiles: [], warmups: [] }), requested);
  assert.deepEqual(remainingFavoriteConcurrencies({ requested, profiles: [], warmups: [{ elapsedMs: 1000 }] }), [1]);
  assert.deepEqual(remainingFavoriteConcurrencies({ requested, profiles: [], warmups: [{ elapsedMs: 2, error: 'partial' }] }), [1]);
  assert.deepEqual(remainingFavoriteConcurrencies({ requested, profiles: [{ concurrency: 1, viableAtTestedLoad: false }], warmups: [] }), []);
  assert.deepEqual(remainingFavoriteConcurrencies({ requested, profiles: [{ concurrency: 1, viableAtTestedLoad: true }], warmups: [] }), [4, 16]);
  assert.deepEqual(remainingFavoriteConcurrencies({ requested, profiles: [{ concurrency: 1, viableAtTestedLoad: true }, { concurrency: 4, viableAtTestedLoad: false }], warmups: [] }), []);
});

test('summary counts union failures and validates raw timed request ordinals', () => {
  const timed = [{ ordinal: 0, elapsedMs: 1000, error: 'timeout' }, { ordinal: 1, elapsedMs: 25 }, { ordinal: 2, elapsedMs: 26 }];
  const warmups = [{ ordinal: 0, elapsedMs: 1001, error: 'timeout' }];
  const result = summarizeFavoriteTrials(timed, warmups);
  assert.equal(result.errors, 1);
  assert.equal(result.overOneSecond, 1);
  assert.equal(result.strictTimedFailures, 1);
  assert.equal(result.strictWarmupFailures, 1);
  assert.equal(result.p95Ms, 26);
  assert.equal(result.maxMs, 1000);
  assert.equal(result.viableAtTestedLoad, false);
  assert.throws(() => summarizeFavoriteTrials([{ ordinal: 1, elapsedMs: 20 }], []), /ordinal/);
  assert.throws(() => summarizeFavoriteTrials([{ ordinal: 0, elapsedMs: 20 }, { ordinal: 0, elapsedMs: 21 }], []), /ordinal/);
});

test('create-only bulk and conflict verification never silently overwrite values', () => {
  const document = { id: 'synthetic-1', reference_id: 'original-1', cohort: 'synthetic-mixture', partition: 1, tags: ['b', 'a'], overlap_pixel_total: 16384, cov_o0004_hard_q00: 2000, quality_o0004_hard_q00: Math.fround(0.3) };
  const lines = favoriteCreateBody([document]).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines[0], { create: { _id: document.id } });
  assert.deepEqual(lines[1], document);
  const fields = Object.fromEntries(Object.entries(document).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : [value]]));
  fields.quality_o0004_hard_q00 = [0.3]; // OpenSearch renders a float with shortest decimal text.
  assert.equal(validateFavoriteStoredFields(document, fields), true);
  assert.throws(() => validateFavoriteStoredFields(document, { ...fields, cov_o0004_hard_q00: [2001] }), /mismatch/);
  assert.throws(() => validateFavoriteStoredFields(document, { ...fields, quality_o0004_hard_q00: [0.31] }), /mismatch/);
  assert.throws(() => validateFavoriteStoredFields(document, { ...fields, tags: ['a'] }), /mismatch/);
  const missing = { ...fields }; delete missing.partition;
  assert.throws(() => validateFavoriteStoredFields(document, missing), /mismatch/);
});

test('timed in-memory records keep accounting without duplicating query context or hits', () => {
  const row = { phase: 'timed', ordinal: 3, elapsedMs: 27, serviceTookMs: 21, hitCount: 20, overOneSecond: false, parameters: { bucketCount: 1024 }, caseId: 'case', profileId: 'profile', hitsHash: 'hash', hits: [{ id: 'wallpaper', score: 1 }] };
  assert.deepEqual(compactFavoriteTrial(row), { ordinal: 3, elapsedMs: 27, serviceTookMs: 21, hitCount: 20, overOneSecond: false });
  assert.deepEqual(compactFavoriteTrial({ ...row, error: 'partial response' }).error, 'partial response');
  const warmup = compactFavoriteTrial({ ...row, phase: 'warmup', warmupId: 'warmup' });
  assert.equal(warmup.warmupId, 'warmup');
  assert.equal(warmup.caseId, 'case');
  assert.equal(warmup.hits, undefined);
});

test('buffered raw recording drains concurrent writers without dropping or duplicating rows', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'favorite-recorder-'));
  const recorder = createFavoriteRecorder(directory, { highWaterMark: 128 });
  try {
    await Promise.all(Array.from({ length: 16 }, async (_, worker) => {
      for (let ordinal = 0; ordinal < 25; ordinal++) await recorder.record('requests.jsonl', { worker, ordinal, padding: 'x'.repeat(100) });
    }));
    await recorder.flush();
    const rows = (await readFile(path.join(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, 400);
    assert.equal(new Set(rows.map(row => `${row.worker}:${row.ordinal}`)).size, 400);
    assert.ok(recorder.observation().peakBufferedBytes < 4096);
    await assert.rejects(recorder.record('../escape', {}), /filename/);
    await recorder.close();
    await assert.rejects(recorder.record('requests.jsonl', {}), /closed/);
  } finally { await recorder.close(); await rm(directory, { recursive: true, force: true }); }
});

const activity = ({ active = 0, queue = 0, merges = 0, query = 0, fetch = 0 } = {}) => ({ nodes: { n: { thread_pool: { search: { active, queue } }, indices: { search: { query_current: query, fetch_current: fetch }, merges: { current: merges } } } } });

test('settling requires consecutive quiet search AND merge observations', async () => {
  let clock = 0, cursor = 0;
  const samples = [activity({ merges: 1 }), activity(), activity({ query: 1 }), activity(), activity()];
  const result = await settleFavoriteActivity({ sample: async () => samples[cursor++], now: () => clock, sleep: async ms => { clock += ms; }, intervalMs: 1, timeoutMs: 10 });
  assert.equal(result.settled, true);
  assert.equal(result.samples.length, 5);
  const failed = await settleFavoriteActivity({ sample: async () => activity({ merges: 1 }), now: () => clock, sleep: async ms => { clock += ms; }, intervalMs: 1, timeoutMs: 2 });
  assert.equal(failed.settled, false);
  await assert.rejects(settleFavoriteActivity({ sample: async () => ({ nodes: {} }) }), /activity evidence/);
});
