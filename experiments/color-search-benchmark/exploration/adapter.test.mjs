import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate } from './adapter.mjs';
import { getMethod, indexForMethod, supports } from './registry.mjs';
import { INDEX } from './service.mjs';
import { PRECISION_GRID_INDEX } from './precision-grid-index.mjs';

const context = { corpus: [{ id: 'a' }, { id: 'b' }] };
const config = { id: 'clickhouse-palette-precision', method: 'clickhouse-palette-precision' };

test('ClickHouse adapter verifies its own complete corpus and identifies the actual backend', async () => {
  let verified;
  const candidate = await createCandidate({ config, context }, {
    api: async () => { throw Error('ClickHouse preparation must not ask OpenSearch'); },
    validateClickHouseReal: async (input) => {
      verified = input;
      return { table: input.table, count: 2, expectedIdsVerified: true, version: '26.3', hostname: 'test-clickhouse', containerLimits: { cpus: 8 }, parts: { bytesOnDisk: 123 }, descriptorHashes: { clickhouseDocuments: 'hash' } };
    },
  });
  assert.equal(candidate.metadata.execution.kind, 'clickhouse');
  const prepared = await candidate.prepare();
  assert.deepEqual(verified.expectedIds, ['a', 'b']);
  assert.equal(prepared.execution.kind, 'clickhouse');
  assert.equal(prepared.execution.version, '26.3');
  assert.equal(prepared.count, 2);
  assert.equal(prepared.storeBytes, 123);
  assert.equal(prepared.index, undefined);
  assert.equal(prepared.descriptorHashes.clickhouseDocuments, 'hash');
});

test('ClickHouse preparation refuses an unverified or incomplete backend corpus', async () => {
  for (const validated of [{ count: 2 }, { count: 1, expectedIdsVerified: true }]) {
    const candidate = await createCandidate({ config, context }, { validateClickHouseReal: async () => validated });
    await assert.rejects(() => candidate.prepare(), /complete ClickHouse corpus/);
  }
});

test('adapter preserves ClickHouse service hits and full eligibility controls without local ranking', async () => {
  const hits = [{ id: 'b', score: 0.9 }, { id: 'a', score: 0.8 }];
  let received;
  const candidate = await createCandidate({ config, context }, { executeSearch: async input => { received = input; return { hits, evidence: { engine: 'clickhouse', rowsRead: 2 } }; } });
  const signal = new AbortController().signal;
  const query = { swatchHex: '#ff2200' };
  const result = await candidate.search({ caseData: { query, eligibleIds: ['a', 'b'], excludedIds: ['x'] }, limit: 7, signal });
  assert.equal(result.hits, hits);
  assert.deepEqual(received.eligibleIds, ['a', 'b']);
  assert.deepEqual(received.excludedIds, ['x']);
  assert.equal(received.query, query);
  assert.equal(received.limit, 7);
  assert.equal(received.signal, signal);
  assert.equal(received.index, undefined);
  assert.equal(result.evidence.engine, 'clickhouse');
});

test('existing OpenSearch method metadata retains its execution kind', async () => {
  const candidate = await createCandidate({ config: { id: 'native-area-linear' }, context });
  assert.equal(candidate.metadata.execution.kind, 'opensearch');
});

test('precision grid uses its dedicated index and exposes its fixed objective scope', () => {
  const method = getMethod('rank-features-precision-grid');
  assert.equal(method.engine, 'opensearch');
  assert.equal(method.approximate, false);
  assert.equal(method.objectiveApproximation, true);
  assert.equal(indexForMethod(method, INDEX), PRECISION_GRID_INDEX);
  assert.equal(indexForMethod(method, 'custom-grid-index'), 'custom-grid-index');
  assert.equal(supports(method, { mode: 'vibe', targets: [{ color: '#ff2200' }] }).supported, true);
  assert.equal(supports(method, { mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: .12 } }] }).supported, false);
  assert.equal(supports(method, { mode: 'vibe', targets: [{ name: 'red', color: '#ff2200' }] }).supported, false);
});

test('grid adapter verifies exact corpus identity and records objective and descriptor fingerprints', async () => {
  let verification, request;
  const hits = [{ id: 'b', score: .7 }, { id: 'a', score: .4 }];
  const candidate = await createCandidate({ config: { id: 'rank-features-precision-grid' }, context }, {
    api: async (route) => { assert.equal(route, ''); return { body: { version: { number: '2.19.2' } } }; },
    validatePrecisionGridIndex: async (input) => {
      verification = input;
      return { index: input.index, count: 2, completeIdsVerified: true, descriptorHash: 'features-hash', definitionHash: 'grid-hash', computationHash: 'encoder-hash', indexMetadata: { grid: true } };
    },
    executeSearch: async (input) => { request = input; return { hits }; },
  });
  const prepared = await candidate.prepare();
  assert.deepEqual(verification, { index: PRECISION_GRID_INDEX, expectedIds: ['a', 'b'] });
  assert.equal(prepared.execution.kind, 'opensearch');
  assert.equal(prepared.execution.index, PRECISION_GRID_INDEX);
  assert.equal(prepared.execution.retrieval, 'exact-stored-objective');
  assert.equal(prepared.execution.objectiveApproximation, true);
  assert.equal(prepared.descriptorHashes.gridDefinition, 'grid-hash');
  assert.equal(prepared.descriptorHashes.gridComputation, 'encoder-hash');
  const result = await candidate.search({ caseData: { query: { mode: 'vibe', targets: [{ color: '#ff2200' }] }, eligibleIds: ['a', 'b'], excludedIds: ['fixture'] }, limit: 2 });
  assert.equal(result.hits, hits);
  assert.equal(request.index, PRECISION_GRID_INDEX);
  assert.deepEqual(request.excludedIds, ['fixture']);
});

test('grid adapter refuses incomplete or unverified corpus preparation', async () => {
  for (const validated of [{ count: 2 }, { count: 1, completeIdsVerified: true }]) {
    const candidate = await createCandidate({ config: { id: 'rank-features-precision-grid' }, context }, {
      api: async () => ({ body: { version: { number: 'test' } } }), validatePrecisionGridIndex: async () => validated,
    });
    await assert.rejects(() => candidate.prepare(), /complete precision-grid corpus/);
  }
});
