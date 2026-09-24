import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createFavoriteLabProvider, createFavoriteLabServer, createUtilityIndexStateReader, validateFavoriteLabRequest, FAVORITE_LAB_METHODS, stopFavoriteLab } from './favorite-lab.mjs';
import { buildFavoriteSortedQuery } from './favorite-sorted-utilities.mjs';
import { buildFavoriteDocvalueQuery } from './favorite-docvalue-fetch.mjs';
import { buildFavoriteBoundedQuery, executeFavoriteBoundedUtilitySearch } from './favorite-bounded-utilities.mjs';
import { buildFavoriteMultiplicityQuery } from './favorite-multiplicity-utilities.mjs';
import { buildFavoriteMaximaBoundedQuery } from './favorite-maxima-bounded-utilities.mjs';
import { buildFavoritePooledQuery } from './favorite-pooled-utilities.mjs';

const query = { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] };
const corpus = [
  { id: 'real-a', title: 'First', filename: '/unused/a.jpg', cohort: 'prior-wallpaper' },
  { id: 'real-b', title: 'Second', filename: '/unused/b.jpg', cohort: 'archive-wallpaper' },
  { id: 'fixture', filename: '/unused/c.svg', cohort: 'controlled-fixture' },
];
const utilityMetadata = {
  experiment: 'strict-hue-favorite-utilities', mode: 'real', scope: 'full',
  encodings: ['numeric', 'rank8', 'rank16', 'rankfloat'], presets: 'all',
  count: corpus.length, identityHash: 'fixture-identity', planHash: 'fixture-plan',
  utilityDefinitionVersion: 2,
};
const precisionMetadata = { ...utilityMetadata, experiment: 'strict-hue-favorite-precision-utilities',
  encodings: ['rank18', 'rank27'], precisionDefinitionVersion: 1, parentUtilityDefinitionVersion: 2 };
const pointMetadata = { ...utilityMetadata, encodings: ['numeric'], numericPoints: true };
const utilityState = index => ({ metadata: index?.includes('precision') ? precisionMetadata : index?.includes('points') ? pointMetadata : utilityMetadata,
  numericUtilityFields: { utility: { type: 'float', index: true, doc_values: true } }, sourceEnabled: false, uuid: 'fixture-index', idField: { type: 'keyword' } });
const inspectUtilityCorpus = async () => ({ count: corpus.length, ids: corpus.map(asset => asset.id) });

test('index metadata cache rechecks cheap generation counters and invalidates after writes or replacement', async () => {
  let uuid = 'first', count = 3, indexed = 3, deleted = 0, metadataReads = 0, statsReads = 0;
  const read = createUtilityIndexStateReader(async route => {
    if (route.includes('/_stats/')) {
      statsReads++;
      return { body: { indices: { index: { uuid, primaries: { docs: { count }, indexing: { index_total: indexed, delete_total: deleted } } } } } };
    }
    metadataReads++;
    return { body: { index: { mappings: { _meta: { revision: metadataReads } }, settings: { index: { uuid } } } } };
  });
  const first = await read('index', {}), cached = await read('index', {});
  assert.deepEqual(cached, first);
  assert.equal(metadataReads, 1);
  assert.equal(statsReads, 2);
  for (const mutate of [() => indexed++, () => deleted++, () => count--, () => { uuid = 'replacement'; }]) {
    const before = await read('index', {});
    mutate();
    const after = await read('index', {});
    assert.notEqual(after.generationToken, before.generationToken);
    assert.notDeepEqual(after.metadata, before.metadata);
  }
  assert.equal(metadataReads, 5);
});

test('index state reader rejects missing stats and replacement during metadata inspection', async () => {
  const missing = createUtilityIndexStateReader(async () => ({ body: {} }));
  await assert.rejects(missing('index', {}), /generation/i);
  let replacement = true, reads = 0;
  const read = createUtilityIndexStateReader(async route => {
    if (route.includes('/_stats/')) return { body: { indices: { index: { uuid: 'first', primaries: {
      docs: { count: 3 }, indexing: { index_total: 3, delete_total: 0 },
    } } } } };
    reads++;
    return { body: { index: { mappings: { _meta: {} }, settings: { index: { uuid: replacement ? 'second' : 'first' } } } } };
  });
  await assert.rejects(read('index', {}), /changed/i);
  replacement = false;
  assert.equal((await read('index', {})).uuid, 'first');
  assert.equal(reads, 2);
});

test('lab only accepts registered methods and common indexed presets without silent rounding', () => {
  const valid = validateFavoriteLabRequest({ methodId: 'favorite-fused-script', query, parameters: { qualityInfluence: .5, cutoffBlendExponent: 1 } });
  assert.equal(valid.parameters.bucketCount, 256);
  assert.equal(valid.parameters.qualityCurve, 'linear');
  assert.equal(valid.parameters.qualityInfluence, .5);
  assert.equal(FAVORITE_LAB_METHODS.length, 19);
  assert.equal(FAVORITE_LAB_METHODS.find(method => method.id === 'favorite-utility-numeric').index, 'color-exploration-favorite-opt-real-v4');
  for (const patch of [
    { methodId: 'arbitrary' }, { index: 'production' }, { filter: { match_all: {} } },
    { parameters: { bucketCount: 1024 } }, { parameters: { qualityInfluence: .8 } },
    { parameters: { cutoffBlendExponent: 2 } }, { parameters: { qualityCurve: 'power' } },
    { limit: 1000 }, { query: { ...query, targets: [{ color: '#00ff00', percent: 42 }] } },
  ]) assert.throws(() => validateFavoriteLabRequest({ methodId: 'favorite-fused-script', query, ...patch }));
});

test('provider preserves preset parameters and service order, selects only fixed indexes and excludes fixtures', async () => {
  const calls = [];
  const provider = await createFavoriteLabProvider({ corpus, readUtilityState: utilityState, inspectUtilityCorpus, searchService: async (index, body) => {
    calls.push({ index, body });
    return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }], evidence: { serviceTookMs: 3 } };
  }, searchSortedService: async options => {
    calls.push({ index: options.index, body: buildFavoriteSortedQuery(options) });
    return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }], evidence: { serviceTookMs: 3, scoreSource: 'opensearch-sort-value' } };
  }, searchBoundedService: async options => {
    calls.push({ index: options.index, body: buildFavoriteBoundedQuery(options) });
    return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }], evidence: { serviceTookMs: 3, globalBounds: { completeCandidateCoverage: true } } };
  }, searchDocvalueService: async options => {
    calls.push({ index: options.index, body: buildFavoriteDocvalueQuery(options) });
    return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }], evidence: { serviceTookMs: 3, fetch: 'doc-value ID' } };
  }, searchMultiplicityService: async options => {
    calls.push({ index: options.index, body: buildFavoriteMultiplicityQuery(options) });
    return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }], evidence: { multiplicity: { corrected: false } } };
  }, searchMaximaService: async options => {
    calls.push({ index: options.index, body: buildFavoriteMaximaBoundedQuery(options) });
    return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }], evidence: { serviceTookMs: 3, globalBounds: { maximaBounds: { addedRanges: 1 } } } };
  }, searchPooledService: async options => {
    calls.push({ index: options.index, body: buildFavoritePooledQuery(options) });
    return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }], evidence: { transport: { nativeDeleteResponses: 1 } } };
  } });
  assert.equal(provider.corpus.length, 2);
  for (const method of FAVORITE_LAB_METHODS) {
    const input = validateFavoriteLabRequest({ methodId: method.id, query, parameters: { qualityInfluence: 1, cutoffBlendExponent: 3 } });
    const result = await provider.search(input);
    assert.deepEqual(result.hits.map(hit => hit.id), ['real-b', 'real-a']);
    assert.equal(result.parameters.qualityInfluence, 1);
    assert.equal(result.parameters.cutoffBlendExponent, 3);
    assert.ok(JSON.stringify(calls.at(-1).body).includes('fixture'));
    assert.equal(calls.at(-1).index, method.index);
  }
  assert.equal(new Set(calls.map(call => call.index)).size, 4);
  assert.equal(calls[1].body.query.script_score.script.params.qualityInfluence, 1);
});

test('point-sort methods require the complete numeric point representation before appearing as available', async () => {
  let metadata = pointMetadata, fields = { a: { type: 'float', index: true, doc_values: true }, b: { type: 'float' } }, generation = 0, sortedCalls = 0;
  const provider = await createFavoriteLabProvider({ corpus,
    readUtilityState: async index => index.includes('points')
      ? { metadata, numericUtilityFields: fields, sourceEnabled: false, uuid: 'point-index', generationToken: generation, idField: { type: 'keyword' } }
      : utilityState(index),
    inspectUtilityCorpus,
    searchSortedService: async options => { sortedCalls++; assert.ok(options.index.includes('points')); return { hits: [{ id: 'real-a', score: 0 }] }; },
    searchService: async () => { throw Error('Sorted execution must use its dedicated adapter.'); },
  });
  assert.equal((await provider.getMethods()).filter(method => method.available).length, 19);
  const request = validateFavoriteLabRequest({ methodId: 'favorite-utility-sorted', query });
  assert.deepEqual((await provider.search(request)).hits, [{ id: 'real-a', score: 0 }]);
  assert.equal(sortedCalls, 1);
  for (const invalid of [undefined, {}, { a: { type: 'float', index: false } }, { a: { type: 'float', doc_values: false } }, { a: { type: 'double', index: true } }]) {
    fields = invalid; generation++;
    await assert.rejects(provider.search(request), /point|float/i);
    assert.equal((await provider.getMethods()).filter(method => method.available).length, 12);
  }
  fields = { a: { type: 'float', index: true } }; metadata = { ...pointMetadata, numericPoints: false }; generation++;
  await assert.rejects(provider.search(request), /point/i);
  assert.equal(sortedCalls, 1);
});

test('bounded method uses its dedicated executor and the complete point-index guard', async () => {
  let ready = false, calls = 0;
  const controller = new AbortController();
  const provider = await createFavoriteLabProvider({ corpus, inspectUtilityCorpus,
    readUtilityState: async (index, options) => {
      if (index.includes('points')) {
        assert.equal(options.numericPoints, true);
        if (!ready) throw Error('Index is not ready.');
      }
      return utilityState(index);
    },
    searchService: async () => assert.fail('Bounded searches require their multi-stage executor.'),
    searchSortedService: async () => assert.fail('Bounded searches must not use the single-sort executor.'),
    searchBoundedService: async options => {
      calls++;
      assert.equal(options.index, 'color-exploration-favorite-points-real-v2');
      assert.equal(options.signal, controller.signal);
      assert.deepEqual(options.excludedIds, ['fixture']);
      assert.equal(options.parameters.qualityInfluence, 1);
      assert.equal(options.parameters.cutoffBlendExponent, 3);
      return { hits: [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .7 }], evidence: { globalBounds: { completeCandidateCoverage: true } } };
    },
  });
  const input = { ...validateFavoriteLabRequest({ methodId: 'favorite-utility-bounded', query,
    parameters: { qualityInfluence: 1, cutoffBlendExponent: 3 } }), signal: controller.signal };
  const unavailable = await provider.getMethods();
  assert.ok(unavailable.filter(method => method.index.includes('points')).every(method => method.available === false));
  assert.equal(unavailable.filter(method => method.available).length, 12);
  await assert.rejects(provider.search(input), /unavailable/);
  assert.equal(calls, 0);
  ready = true;
  const result = await provider.search(input);
  assert.deepEqual(result.hits.map(hit => hit.id), ['real-b', 'real-a']);
  assert.equal(result.evidence.globalBounds.completeCandidateCoverage, true);
  assert.equal(calls, 1);
});

test('maxima is a separate16th method with the point and ID guards and its own executor', async () => {
  let idField = { type: 'keyword', doc_values: false }, calls = 0;
  const controller = new AbortController();
  const provider = await createFavoriteLabProvider({ corpus, inspectUtilityCorpus,
    readUtilityState: async (index, options) => {
      if (options.idDocValues && index.includes('points')) assert.equal(options.numericPoints, true);
      return { ...utilityState(index), idField };
    }, searchService: () => assert.fail('Use maxima executor.'), searchBoundedService: () => assert.fail('Original bounded executor must stay separate.'),
    searchMaximaService: async options => {
      calls++; assert.equal(options.index, 'color-exploration-favorite-points-real-v2'); assert.equal(options.signal, controller.signal);
      assert.deepEqual(options.excludedIds, ['fixture']); assert.equal(options.parameters.qualityInfluence, 1);
      return { hits: [{ id: 'real-b', score: .7 }, { id: 'real-a', score: .6 }], evidence: { globalBounds: { maximaBounds: { addedRanges: 2 } } } };
    } });
  assert.equal(FAVORITE_LAB_METHODS[15].id, 'favorite-utility-maxima-bounded');
  const input = { ...validateFavoriteLabRequest({ methodId: 'favorite-utility-maxima-bounded', query, parameters: { qualityInfluence: 1 } }), signal: controller.signal };
  await assert.rejects(provider.search(input), /keyword|doc values/i); assert.equal(calls, 0);
  idField = { type: 'keyword' };
  const result = await provider.search(input);
  assert.deepEqual(result.hits.map(hit => hit.id), ['real-b', 'real-a']); assert.equal(result.evidence.globalBounds.maximaBounds.addedRanges, 2); assert.equal(calls, 1);
});

test('aborting a lab HTTP request reaches the bounded executor and still closes its PIT', { timeout: 2000 }, async t => {
  let beginStage, acknowledgeCleanup;
  const started = new Promise(resolve => { beginStage = resolve; });
  const cleaned = new Promise(resolve => { acknowledgeCleanup = resolve; });
  const request = async (route, options) => {
    if (route.includes('/_search/point_in_time?')) return { body: { pit_id: 'lab-pit', _shards: { failed: 0 } } };
    if (options.method === 'DELETE') {
      assert.equal(options.signal.aborted, false);
      assert.deepEqual(options.body, { pit_id: ['lab-pit'] });
      acknowledgeCleanup();
      return { body: { pits: [{ pit_id: 'lab-pit', successful: true }] } };
    }
    beginStage();
    return new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };
  const provider = await createFavoriteLabProvider({ corpus, readUtilityState: utilityState, inspectUtilityCorpus,
    searchBoundedService: options => executeFavoriteBoundedUtilitySearch({ ...options, request }),
  });
  const server = createFavoriteLabServer(provider);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const controller = new AbortController();
  const fetchResult = fetch(`http://127.0.0.1:${server.address().port}/api/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ methodId: 'favorite-utility-bounded', query }),
  }).then(value => ({ value }), error => ({ error }));
  await started;
  controller.abort();
  assert.equal((await fetchResult).error.name, 'AbortError');
  await cleaned;
});

test('index reader fetches all numeric field definitions once per point-index generation', async () => {
  const fields = { a: { type: 'float' }, b: { type: 'float', index: true } }, routes = [];
  const read = createUtilityIndexStateReader(async route => {
    routes.push(route);
    return route.includes('/_stats/')
      ? { body: { indices: { index: { uuid: 'points', primaries: { docs: { count: 3 }, indexing: { index_total: 3, delete_total: 0 } } } } } }
      : { body: { index: { mappings: { _meta: pointMetadata, _source: { enabled: false }, properties: { utilities: { properties: fields } } }, settings: { index: { uuid: 'points' } } } } };
  });
  await read('index', {});
  const pointState = await read('index', { numericPoints: true });
  assert.deepEqual(pointState.numericUtilityFields, fields);
  assert.equal(pointState.sourceEnabled, false);
  await read('index', { numericPoints: true });
  assert.equal(routes.filter(route => route.includes('mappings.properties.utilities')).length, 1);
});

test('precision methods become available only with matching definition and complete corpus', async () => {
  let metadata = precisionMetadata, absent = true, inspections = 0;
  const provider = await createFavoriteLabProvider({ corpus,
    readUtilityState: async index => {
      if (index.includes('precision') && absent) throw Error('Index does not exist.');
      return { metadata, uuid: 'precision-index', idField: { type: 'keyword' } };
    },
    inspectUtilityCorpus: async () => { inspections++; return inspectUtilityCorpus(); },
    searchService: async () => ({ hits: [] }),
  });
  const missing = await provider.getMethods();
  assert.equal(missing.filter(method => method.available).length, 7);
  assert.ok(missing.filter(method => method.encoding === 'rank18' || method.encoding === 'rank27')
    .every(method => method.available === false && /unavailable/i.test(method.unavailableReason)));
  assert.equal(inspections, 0);
  absent = false;
  assert.equal((await provider.getMethods()).filter(method => method.available).length, 10);
  assert.equal(inspections, 1);
  const request = validateFavoriteLabRequest({ methodId: 'favorite-utility-rank27', query });
  await provider.search(request);
  for (const invalid of [utilityMetadata,
    { ...precisionMetadata, precisionDefinitionVersion: 2 },
    { ...precisionMetadata, parentUtilityDefinitionVersion: 1 },
    { ...precisionMetadata, encodings: ['rank18'] },
    { ...precisionMetadata, mode: 'scale' },
    { ...precisionMetadata, scope: 'projection' },
    { ...precisionMetadata, count: corpus.length - 1 },
  ]) {
    metadata = invalid;
    await assert.rejects(provider.search(request), error => error.status === 503);
  }
});

test('utility searches reject missing or incompatible indexed features before querying OpenSearch', async () => {
  let metadata = utilityMetadata, reads = 0, searches = 0;
  const provider = await createFavoriteLabProvider({ corpus,
    readUtilityState: async () => { reads++; return { metadata, uuid: 'fixture-index' }; }, inspectUtilityCorpus,
    searchService: async () => { searches++; return { hits: [] }; },
  });
  const request = validateFavoriteLabRequest({ methodId: 'favorite-utility-rank16', query });
  for (const invalid of [undefined, {},
    { ...utilityMetadata, experiment: 'unrelated-index' },
    { ...utilityMetadata, mode: 'synthetic' },
    { ...utilityMetadata, scope: 'projection' },
    { ...utilityMetadata, count: corpus.length - 1 },
    { ...utilityMetadata, utilityDefinitionVersion: undefined },
    { ...utilityMetadata, utilityDefinitionVersion: 1 },
    { ...utilityMetadata, encodings: ['numeric', 'rank8'] },
    { ...utilityMetadata, presets: 'unknown' },
  ]) {
    metadata = invalid;
    await assert.rejects(provider.search(request), error => error.status === 503 && /utility index/i.test(error.message));
  }
  assert.equal(searches, 0);
  const readsBeforeBaseline = reads;
  await provider.search({ ...request, methodId: 'cutoff-shade-hue-all-levels' });
  await provider.search({ ...request, methodId: 'favorite-fused-script' });
  await provider.search({ ...request, methodId: 'favorite-typed-script' });
  assert.equal(reads, readsBeforeBaseline);
  assert.equal(searches, 3);
  metadata = { ...utilityMetadata, presets: 'favorite' };
  await provider.search(request);
  await assert.rejects(provider.search({ ...request, parameters: { ...request.parameters, qualityInfluence: 1 } }), /saved favorite controls/i);
  await assert.rejects(provider.search({ ...request, parameters: { ...request.parameters, cutoffBlendExponent: 3 } }), /saved favorite controls/i);
  metadata = utilityMetadata;
  await provider.search({ ...request, parameters: { ...request.parameters, qualityInfluence: 1, cutoffBlendExponent: 3 } });
  assert.equal(searches, 5);
});

test('utility corpus validation includes every known ID and is cached only for the same index generation', async () => {
  let uuid = 'first-index', generationToken = 'before-write', count = corpus.length, ids = corpus.map(asset => asset.id), inspections = 0, searches = 0;
  const provider = await createFavoriteLabProvider({ corpus,
    readUtilityState: () => ({ ...utilityState(), uuid, generationToken }),
    inspectUtilityCorpus: async () => { inspections++; return { count, ids }; },
    searchService: async () => { searches++; return { hits: [] }; },
  });
  const input = validateFavoriteLabRequest({ methodId: 'favorite-utility-rank8', query });
  await provider.search(input); await provider.search(input);
  assert.equal(inspections, 1);
  generationToken = 'after-write';
  await provider.search(input);
  assert.equal(inspections, 2);
  uuid = 'replacement-index';
  ids = ['real-a', 'real-b', 'unknown'];
  await assert.rejects(provider.search(input), /every known wallpaper and fixture/i);
  ids = corpus.map(asset => asset.id); count--;
  await assert.rejects(provider.search(input), /count/i);
  count++;
  await provider.search(input);
  assert.equal(inspections, 5);
  assert.equal(searches, 4);
});

test('HTTP lab returns service ranking and precision notices, and refuses unknown or fixture hits', async t => {
  let hits = [{ id: 'real-b', score: .8 }, { id: 'real-a', score: .4 }];
  const server = createFavoriteLabServer({ corpus: corpus.slice(0, 2), search: async () => ({ hits, evidence: { serviceTookMs: 2 } }),
    getMethods: async () => FAVORITE_LAB_METHODS.map(method => ({ ...method, available: !method.index.includes('precision') })),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const meta = await (await fetch(base + '/api/meta')).json();
  assert.equal(meta.wallpaperCount, 2);
  assert.ok(meta.methods.every(method => typeof method.precision === 'string'));
  assert.equal(meta.methods.filter(method => method.available === false).length, 3);
  const search = body => fetch(base + '/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await search({ methodId: 'favorite-utility-rank16', query });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.hits.map(hit => hit.id), ['real-b', 'real-a']);
  assert.match(result.precision, /rounding/i);
  assert.equal(result.hits[0].thumbnailUrl, '/api/images/real-b?thumbnail=1');
  hits = [{ id: 'fixture', score: 1 }];
  assert.equal((await search({ methodId: 'favorite-fused-script', query })).status, 502);
  assert.equal((await search({ methodId: 'favorite-fused-script', query, index: 'other' })).status, 400);
  assert.equal((await fetch(base + '/api/images/fixture')).status, 404);
  assert.equal((await fetch(base + '/../../etc/passwd')).status, 404);
});

test('lean fetch columns inherit parent index guards and require keyword ID doc values before execution', async () => {
  const controller = new AbortController(), calls = [];
  let idField = { type: 'keyword' }, brokenPrecision = false, brokenPoints = false;
  const provider = await createFavoriteLabProvider({ corpus, inspectUtilityCorpus,
    readUtilityState: async (index, options) => {
      const state = { ...utilityState(index), idField };
      if (index.includes('precision') && brokenPrecision) state.metadata = utilityMetadata;
      if (index.includes('points') && brokenPoints) state.metadata = { ...pointMetadata, numericPoints: false };
      if (options.idDocValues) calls.push({ index, options });
      return state;
    },
    searchService: async () => assert.fail('Fetch refinements must use their dedicated executor.'),
    searchSortedService: async () => assert.fail('Fetch refinements must not use the stored-ID executor.'),
    searchDocvalueService: async options => {
      assert.equal(options.signal, controller.signal);
      assert.deepEqual(options.excludedIds, ['fixture']);
      assert.equal(options.parameters.qualityInfluence, 1);
      assert.equal(options.parameters.cutoffBlendExponent, 3);
      return { hits: [{ id: 'real-b', score: .5 }, { id: 'real-a', score: .5 }], evidence: { parentMethod: options.method.replace('-docvalues', '') } };
    },
  });
  const selected = FAVORITE_LAB_METHODS.filter(method => method.searchKind === 'favorite-docvalue-fetch');
  assert.equal(selected.length, 3);
  assert.ok(selected.every(method => /rounding/.test(method.precision)));
  for (const method of selected) {
    const parent = FAVORITE_LAB_METHODS.find(item => item.id === method.parentMethod);
    assert.equal(method.index, parent.index);
    const input = { ...validateFavoriteLabRequest({ methodId: method.id, query,
      parameters: { qualityInfluence: 1, cutoffBlendExponent: 3 } }), signal: controller.signal };
    assert.deepEqual((await provider.search(input)).hits.map(hit => hit.id), ['real-b', 'real-a']);
    assert.equal(calls.at(-1).options.idDocValues, true);
    assert.equal(calls.at(-1).options.numericPoints, method.parentMethod === 'favorite-utility-sorted');
    for (const invalid of [undefined, { type: 'text' }, { type: 'keyword', doc_values: false }]) {
      idField = invalid;
      await assert.rejects(provider.search(input), /keyword.*doc values/);
      assert.equal((await provider.getMethods()).find(item => item.id === method.id).available, false);
    }
    idField = { type: 'keyword' };
    if (method.encoding === 'rank27') {
      brokenPrecision = true;
      await assert.rejects(provider.search(input), /complete real corpus/);
      brokenPrecision = false;
    }
    if (method.parentMethod === 'favorite-utility-sorted') {
      brokenPoints = true;
      await assert.rejects(provider.search(input), /numeric point/);
      brokenPoints = false;
    }
  }
});

test('ID mapping validation has a distinct generation cache and refreshes after index writes', async () => {
  let indexed = 3, idField = { type: 'keyword' };
  const routes = [];
  const read = createUtilityIndexStateReader(async route => {
    routes.push(route);
    return route.includes('/_stats/')
      ? { body: { indices: { index: { uuid: 'id-index', primaries: { docs: { count: 3 }, indexing: { index_total: indexed, delete_total: 0 } } } } } }
      : { body: { index: { mappings: { _meta: utilityMetadata, properties: { id: idField } }, settings: { index: { uuid: 'id-index' } } } } };
  });
  assert.equal((await read('index')).idField, undefined);
  assert.deepEqual((await read('index', { idDocValues: true })).idField, { type: 'keyword' });
  await read('index', { idDocValues: true });
  assert.equal(routes.filter(route => route.includes('mappings.properties.id')).length, 1);
  indexed++; idField = { type: 'keyword', doc_values: false };
  assert.deepEqual((await read('index', { idDocValues: true })).idField, idField);
  assert.equal(routes.filter(route => route.includes('mappings.properties.id')).length, 2);
});


test('separate17th scalar method preserves repeated weights, parent index guards and dedicated execution', async () => {
  let idField = { type: 'keyword' }, calls = 0;
  const provider = await createFavoriteLabProvider({ corpus, inspectUtilityCorpus,
    readUtilityState: async (index, options) => { assert.equal(options.idDocValues, true); return { ...utilityState(index), idField }; },
    searchService: () => assert.fail('Use separate multiplicity executor.'),
    searchMultiplicityService: async options => {
      calls++; assert.equal(options.index, 'color-exploration-favorite-opt-real-v4'); assert.deepEqual(options.excludedIds, ['fixture']);
      const body = buildFavoriteMultiplicityQuery(options); assert.equal(body.query.bool.should.length, 1);
      assert.equal(body.query.bool.should[0].function_score.field_value_factor.factor, 1);
      return { hits: [{ id: 'real-b', score: .8 }], evidence: { multiplicity: { corrected: true } } };
    },
  });
  const method = FAVORITE_LAB_METHODS[16]; assert.equal(method.id, 'favorite-utility-numeric-multiplicity');
  assert.match(method.precision, /does not add percentages/i);
  const input = validateFavoriteLabRequest({ methodId: method.id, query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#fe0000', percent: 50 }] } });
  assert.equal((await provider.search(input)).evidence.multiplicity.corrected, true); assert.equal(calls, 1);
  idField = { type: 'keyword', doc_values: false }; await assert.rejects(provider.search(input), /doc values/); assert.equal(calls, 1);
});

test('pooled cleanup variants append after all17 existing methods and use their executor with point and ID guards', async () => {
  const calls = [], controller = new AbortController(); let validId = true, validPoints = true;
  const provider = await createFavoriteLabProvider({ corpus, inspectUtilityCorpus,
    readUtilityState: async (index, options) => {
      assert.equal(options.numericPoints, true); assert.equal(options.idDocValues, true);
      const state = await utilityState(index);
      return { ...state, metadata: { ...state.metadata, numericPoints: validPoints },
        idField: { type: 'keyword', doc_values: validId } };
    }, searchService: () => assert.fail('Pooled methods require their own executor.'),
    searchBoundedService: () => assert.fail('Original bounded remains separate.'),
    searchMaximaService: () => assert.fail('Original maxima remains separate.'),
    searchPooledService: async options => { calls.push(options); return { hits: [{ id: 'real-b', score: .7 }, { id: 'real-a', score: .7 }],
      evidence: { parentMethod: options.method.replace('-pooled-delete', ''), transport: { nativeDeleteResponses: 1 } } }; },
  });
  const additions = FAVORITE_LAB_METHODS.slice(17);
  assert.deepEqual(additions.map(method => method.id), ['favorite-utility-bounded-pooled-delete', 'favorite-utility-maxima-bounded-pooled-delete']);
  for (const method of additions) {
    const input = { ...validateFavoriteLabRequest({ methodId: method.id, query, parameters: { qualityInfluence: 1, cutoffBlendExponent: 3 } }), signal: controller.signal };
    const result = await provider.search(input);
    assert.deepEqual(result.hits.map(hit => hit.id), ['real-b', 'real-a']); assert.equal(result.evidence.transport.nativeDeleteResponses, 1);
    assert.equal(calls.at(-1).method, method.id); assert.equal(calls.at(-1).signal, controller.signal);
    assert.equal(calls.at(-1).index, 'color-exploration-favorite-points-real-v2');
    assert.deepEqual(calls.at(-1).excludedIds, ['fixture']); assert.equal(calls.at(-1).parameters.qualityInfluence, 1);
    validId = false; await assert.rejects(provider.search(input), /id keyword/); validId = true;
    validPoints = false; await assert.rejects(provider.search(input), /numeric point/); validPoints = true;
  }
  assert.equal(calls.length, 2);
});

test('lab shutdown drains cleanup from disconnected searches before closing shared pools', { timeout: 2000 }, async t => {
  let begin, cleanupStarted, release;
  const started = new Promise(resolve => { begin = resolve; }), cleaning = new Promise(resolve => { cleanupStarted = resolve; });
  const cleanup = new Promise(resolve => { release = resolve; }); let poolClosed = false;
  const server = createFavoriteLabServer({ corpus, search: async ({ signal }) => {
    begin(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    cleanupStarted(); await cleanup; return { hits: [] };
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { release(); server.closeAllConnections(); if (server.listening) server.close(); });
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${server.address().port}/api/search`, { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ methodId: 'favorite-utility-bounded-pooled-delete', query }) }).catch(error => error);
  await started; controller.abort(); await request; await cleaning;
  server.closeAllConnections();
  const stopped = stopFavoriteLab(server, { closeTransports: async () => { poolClosed = true; } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(poolClosed, false);
  release(); await stopped; assert.equal(poolClosed, true);
});

test('performance routes serve a fixed read-only snapshot without corpus or search queries', async t => {
  let reads = 0;
  const server = createFavoriteLabServer({ corpus: [], search: () => assert.fail('No OpenSearch search'), getMethods: () => assert.fail('No metadata request'),
    readPerformance: async () => { reads++; return { schemaVersion: 1, available: true, rows: [] }; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + '/api/performance')).json()).available, true);
  assert.equal((await fetch(base + '/api/performance?path=/etc/passwd')).status, 400);
  assert.equal((await fetch(base + '/api/performance', { method: 'POST' })).status, 405);
  assert.equal(reads, 1);
  for (const resource of ['/performance.html', '/performance.js', '/performance.css']) assert.equal((await fetch(base + resource, { method: 'HEAD' })).status, 200);
  assert.match(await (await fetch(base + '/')).text(), /href="\/performance.html"/);
});
