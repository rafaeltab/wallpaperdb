// Isolated visual comparison for the favorite optimization experiments.
// Service scores and hit order are returned unchanged; no client reranking.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { api, loadExpandedCorpus, searchIndex } from './service.mjs';
import { interpretQuery } from './query.mjs';
import { buildCutoffQuery, supportsCutoff } from './methods-cutoff.mjs';
import { buildFavoriteOptimizedQuery, supportsFavoriteOptimized } from './favorite-optimized-scoring.mjs';
import { FAVORITE_TYPED_METHODS, buildFavoriteTypedQuery, supportsFavoriteTyped } from './favorite-typed-scoring.mjs';
import { FAVORITE_UTILITY_METHODS, favoriteUtilityParameters, supportsFavoriteUtilities, buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { FAVORITE_PRECISION_METHODS, supportsFavoritePrecision, buildFavoritePrecisionQuery } from './favorite-precision-utilities.mjs';
import { FAVORITE_SORTED_METHODS, supportsFavoriteSorted, searchFavoriteSortedUtilities } from './favorite-sorted-utilities.mjs';
import { FAVORITE_BOUNDED_METHODS, supportsFavoriteBounded, executeFavoriteBoundedUtilitySearch } from './favorite-bounded-utilities.mjs';
import { FAVORITE_DOCVALUE_FETCH_METHODS, supportsFavoriteDocvalueFetch, searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';
import { FAVORITE_MULTIPLICITY_METHODS, supportsFavoriteMultiplicity, searchFavoriteMultiplicity } from './favorite-multiplicity-utilities.mjs';
import { readFavoritePerformance } from './favorite-performance.mjs';
import { FAVORITE_MAXIMA_BOUNDED_METHODS, supportsFavoriteMaximaBounded, executeFavoriteMaximaBoundedUtilitySearch } from './favorite-maxima-bounded-utilities.mjs';
import { FAVORITE_POOLED_METHODS, supportsFavoritePooled, executeFavoritePooledUtilitySearch, closeFavoritePooledTransports } from './favorite-pooled-utilities.mjs';
import { validateLinkedStrictnessRequest, createLinkedStrictnessLabProvider } from './linked-strictness-lab.mjs';

const baselineIndex = 'color-exploration-shade-hue-256-real-v1';
const utilityIndex = 'color-exploration-favorite-opt-real-v4';
const precisionIndex = 'color-exploration-favorite-precision-real-v1';
const pointIndex = 'color-exploration-favorite-points-real-v2';
export const FAVORITE_LAB_METHODS = Object.freeze([
  Object.freeze({ id: 'cutoff-shade-hue-all-levels', label: 'Saved favorite', index: baselineIndex,
    description: 'Original native scoring with all five strict-hue cutoff layers.',
    precision: 'Reference implementation. Your saved method, using the selected shared presets.', category: 'Reference' }),
  Object.freeze({ id: 'favorite-fused-script', label: 'Fused score', index: baselineIndex,
    description: 'The same component calculation in one OpenSearch script.',
    precision: 'Preserves the formula and native component rounding. Exact scores and ordering matched in the initial 545-image checks.', category: 'Same formula' }),
  ...FAVORITE_TYPED_METHODS.map(method => Object.freeze({ ...method, index: baselineIndex,
    label: 'Typed specialized score', category: 'Same formula',
    precision: 'The same score with typed, specialized script instructions. Exact scores and ordering matched across 545 images and 15 tested settings.' })),
  ...FAVORITE_UTILITY_METHODS.map(method => Object.freeze({ ...method, index: utilityIndex,
    label: { numeric: 'Precomputed float', rank8: 'Indexed 8-bit', rank16: 'Indexed split 16-bit', rankfloat: 'Indexed native precision' }[method.encoding],
    category: method.encoding === 'numeric' ? 'Same formula · rounding changes' : 'Approximate score' })),
  ...FAVORITE_PRECISION_METHODS.map(method => Object.freeze({ ...method, index: precisionIndex,
    label: method.encoding === 'rank18' ? 'Indexed split 18-bit' : 'Indexed split 27-bit', category: 'Approximate score',
    precision: method.encoding === 'rank18'
      ? 'Two base-512 digits store each precomputed target score with rounding at most 0.00000191. Query arithmetic remains float32; grouping differs from the reference.'
      : 'Three base-512 digits reduce target rounding to at most 0.00000000373. Query float32 arithmetic and grouping still introduce rounding.' })),
  ...FAVORITE_SORTED_METHODS.map(method => Object.freeze({ ...method, index: pointIndex,
    label: method.trackScores ? 'Numeric sort · score tracking' : 'Native numeric sort', category: 'Same stored score',
    precision: method.trackScores
      ? 'Single color: numeric sort plus original score tracking. Control variant with complete scoring overhead. Multiple colors use the precomputed float query.'
      : 'Single color: sort the stored utility and show its server sort value as the score. Identical stored objective; multiple colors use the precomputed float query.' })),
  ...FAVORITE_BOUNDED_METHODS.map(method => Object.freeze({ ...method, index: pointIndex,
    label: 'Globally bounded float', category: 'Same stored score',
    precision: 'Several OpenSearch requests share one snapshot. A conservative bound skips only documents that cannot reach the winning scores; the final service query ranks all remaining candidates.' })),
  ...FAVORITE_DOCVALUE_FETCH_METHODS.map(method => Object.freeze({ ...method,
    index: method.parentMethod === 'favorite-utility-sorted' ? pointIndex : method.encoding === 'rank27' ? precisionIndex : utilityIndex,
    label: { 'favorite-utility-numeric': 'Precomputed float · lean fetch', 'favorite-utility-rank27': 'Indexed split 27-bit · lean fetch',
      'favorite-utility-sorted': 'Native numeric sort · lean fetch' }[method.parentMethod],
    category: 'Fetch-only refinement',
    precision: 'The same score and global ordering as ' + ({ 'favorite-utility-numeric': 'Precomputed float',
      'favorite-utility-rank27': 'Indexed split 27-bit', 'favorite-utility-sorted': 'Native numeric sort' }[method.parentMethod])
      + '. Only result-ID retrieval changes, reading column values and skipping stored document data. Original rounding limitations remain.' })),
  ...FAVORITE_MAXIMA_BOUNDED_METHODS.map(method => Object.freeze({ ...method, index: pointIndex,
    label: 'Global maxima bounds', category: 'Same stored score',
    precision: 'The same numeric score and snapshot. Adds necessary per-color ranges using global maxima from the existing seed searches. Duplicate color bins keep the original bound; performance is experimental.' })),
  ...FAVORITE_MULTIPLICITY_METHODS.filter(method => method.id === 'favorite-utility-numeric-multiplicity').map(method => Object.freeze({ ...method, index: utilityIndex,
    label: 'Repeated target weights', category: 'Corrected duplicate objective',
    precision: 'Restores each repeated target’s weight when colors resolve to the same bin and requested amount. It does not add percentages together. Different amounts remain separate; ordinary queries retain the precomputed float score. The original methods are unchanged.' })),
  ...FAVORITE_POOLED_METHODS.map(method => Object.freeze({ ...method, index: pointIndex,
    label: method.parentMethod === 'favorite-utility-bounded' ? 'Global bounds · pooled cleanup' : 'Global maxima · pooled cleanup',
    category: 'Transport-only refinement',
    precision: 'The same score, global bounds and point-in-time snapshot as its parent. Reuses HTTP connections when closing the snapshot; cleanup remains part of the request. Original duplicate-target behavior is preserved. The original methods remain available.' })),
]);
const methods = new Map(FAVORITE_LAB_METHODS.map(method => [method.id, method]));
const web = new URL('./web/favorite-lab/', import.meta.url);
const activeSearches = new WeakMap();
const staticFiles = new Map([
  ['/', [fileURLToPath(new URL('index.html', web)), 'text/html; charset=utf-8']],
  ['/lab.js', [fileURLToPath(new URL('lab.js', web)), 'text/javascript; charset=utf-8']],
  ['/performance.html', [fileURLToPath(new URL('performance.html', web)), 'text/html; charset=utf-8']],
  ['/performance.js', [fileURLToPath(new URL('performance.js', web)), 'text/javascript; charset=utf-8']],
  ['/performance.css', [fileURLToPath(new URL('performance.css', web)), 'text/css; charset=utf-8']],
  ['/lab.css', [fileURLToPath(new URL('lab.css', web)), 'text/css; charset=utf-8']],
  ['/strictness.html', [fileURLToPath(new URL('strictness.html', web)), 'text/html; charset=utf-8']],
  ['/strictness.js', [fileURLToPath(new URL('strictness.js', web)), 'text/javascript; charset=utf-8']],
  ['/strictness.css', [fileURLToPath(new URL('strictness.css', web)), 'text/css; charset=utf-8']],
]);
const imageTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const realAsset = asset => asset.cohort !== 'controlled-fixture' && extname(asset.filename ?? '').toLowerCase() !== '.svg';
const parentMethod = method => methods.get(method.parentMethod) ?? method;
const precisionMethod = method => parentMethod(method).searchKind === 'favorite-precision-utilities';
const sortedMethod = method => parentMethod(method).searchKind === 'favorite-sorted-utilities';
const boundedMethod = method => method.searchKind === 'favorite-bounded-utilities';
const maximaMethod = method => method.searchKind === 'favorite-maxima-bounded-utilities';
const pooledMethod = method => method.searchKind === 'favorite-pooled-utilities';
const pointMethod = method => sortedMethod(method) || boundedMethod(method) || maximaMethod(method) || pooledMethod(method);
const docvalueMethod = method => method.searchKind === 'favorite-docvalue-fetch';
const multiplicityMethod = method => method.searchKind === 'favorite-multiplicity';
const idDocValuesRequired = method => docvalueMethod(method) || maximaMethod(method) || multiplicityMethod(method) || pooledMethod(method);

export function validateFavoriteLabRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Expected a search request.');
  for (const key of Object.keys(body)) if (!['methodId', 'query', 'parameters', 'limit'].includes(key)) throw fail(`Unsupported request field: ${key}`);
  if (!methods.has(body.methodId)) throw fail('Choose a registered comparison method.');
  let parameters;
  try { parameters = favoriteUtilityParameters(body.parameters); }
  catch (error) { throw fail(error.message); }
  const query = body.query;
  if (!query || !['vibe', 'proportions'].includes(query.mode)) throw fail('Choose overall vibe or target proportions.');
  if (!Array.isArray(query.targets) || query.targets.length < 1 || query.targets.length > 8) throw fail('Choose between one and eight targets.');
  const interpreted = interpretQuery(query);
  if (!interpreted.supported) throw fail(interpreted.reason);
  if (interpreted.mode === 'proportions' && interpreted.targets.some(target => Math.abs(target.amount * 20 - Math.round(target.amount * 20)) > 1e-9)) throw fail('Use target percentages in steps of 5.');
  const limit = body.limit ?? 24;
  if (!Number.isInteger(limit) || limit < 1 || limit > 80) throw fail('Result count must be between 1 and 80.');
  return { methodId: body.methodId, query, parameters, limit };
}

export function createUtilityIndexStateReader(request = api) {
  const cache = new Map();
  return async (index, { signal, numericPoints = false, idDocValues = false } = {}) => {
    // Fetching mapping metadata still constructs a very large mapping inside
    // OpenSearch before filter_path is applied. Cheap primary counters let us
    // reuse metadata while detecting corpus writes and index replacement.
    const statistics = await request(`${index}/_stats/docs,indexing?filter_path=indices.*.uuid,indices.*.primaries.docs.count,indices.*.primaries.indexing.index_total,indices.*.primaries.indexing.delete_total`, { signal, timeoutMs: 10000 });
    const current = statistics.body.indices?.[index], counters = [current?.primaries?.docs?.count,
      current?.primaries?.indexing?.index_total, current?.primaries?.indexing?.delete_total];
    if (!current?.uuid || counters.some(value => !Number.isSafeInteger(value) || value < 0)) throw Error('The utility index generation could not be read.');
    const generationToken = JSON.stringify([current.uuid, ...counters]);
    const cacheKey = JSON.stringify([index, numericPoints, idDocValues]);
    if (cache.get(cacheKey)?.generationToken === generationToken) return cache.get(cacheKey).state;
    const pending = (async () => {
      const extra = (numericPoints ? ',*.mappings.properties.utilities.properties,*.mappings._source' : '')
        + (idDocValues ? ',*.mappings.properties.id' : '');
      const result = await request(`${index}?filter_path=*.mappings._meta,*.settings.index.uuid${extra}`, { signal, timeoutMs: 10000 });
      const state = result.body[index];
      if (state?.settings?.index?.uuid !== current.uuid) throw Error('The utility index changed during validation. Please try again.');
      return { metadata: state?.mappings?._meta, uuid: current.uuid, generationToken, documentCount: counters[0],
        ...(idDocValues ? { idField: state?.mappings?.properties?.id } : {}),
        ...(numericPoints ? { numericUtilityFields: state?.mappings?.properties?.utilities?.properties, sourceEnabled: state?.mappings?._source?.enabled ?? true } : {}) };
    })();
    const entry = { generationToken, state: pending };
    cache.set(cacheKey, entry);
    try { return await pending; }
    catch (error) { if (cache.get(cacheKey) === entry) cache.delete(cacheKey); throw error; }
  };
}
const readUtilityIndexState = createUtilityIndexStateReader();
async function inspectUtilityIndexCorpus(index, ids, { signal }) {
  const [count, documents] = await Promise.all([
    api(`${index}/_count`, { signal, timeoutMs: 10000 }),
    api(`${index}/_mget?_source=false&filter_path=docs._id,docs.found,docs.error`, { method: 'POST', body: { ids }, signal, timeoutMs: 10000 }),
  ]);
  return { count: count.body.count, ids: (documents.body.docs ?? []).filter(doc => doc.found && !doc.error).map(doc => doc._id) };
}

export async function createFavoriteLabProvider({ corpus: suppliedCorpus, searchService = searchIndex,
  readUtilityState = readUtilityIndexState, inspectUtilityCorpus = inspectUtilityIndexCorpus,
  searchSortedService = searchFavoriteSortedUtilities, searchBoundedService = executeFavoriteBoundedUtilitySearch,
  searchDocvalueService = searchFavoriteDocvalueUtilities, searchMaximaService = executeFavoriteMaximaBoundedUtilitySearch,
  searchMultiplicityService = searchFavoriteMultiplicity, searchPooledService = executeFavoritePooledUtilitySearch } = {}) {
  const all = suppliedCorpus ?? await loadExpandedCorpus();
  const corpus = all.filter(realAsset), excludedIds = all.filter(asset => !realAsset(asset)).map(asset => asset.id);
  const corpusIds = all.map(asset => asset.id), checkedGenerations = new Map();
  if (new Set(corpusIds).size !== corpusIds.length) throw Error('Corpus IDs must be unique.');
  async function checkUtilityIndex(method, parameters, signal) {
    let state;
    try { state = await readUtilityState(method.index, { signal, numericPoints: pointMethod(method), idDocValues: idDocValuesRequired(method) }); }
    catch (error) { throw fail(`The utility index is unavailable: ${error.message}`, 503); }
    const meta = state?.metadata;
    const correctDefinition = precisionMethod(method)
      ? meta?.experiment === 'strict-hue-favorite-precision-utilities' && meta.precisionDefinitionVersion === 1 && meta.parentUtilityDefinitionVersion === 2
      : meta?.experiment === 'strict-hue-favorite-utilities' && meta.utilityDefinitionVersion === 2;
    if (!state?.uuid || !correctDefinition || meta.mode !== 'real' || meta.scope !== 'full'
      || meta.count !== corpusIds.length || !meta.identityHash || !meta.planHash
      || !Array.isArray(meta.encodings) || !meta.encodings.includes(method.encoding) || !['all', 'favorite'].includes(meta.presets)) {
      throw fail('The utility index is not ready for this comparison: it needs the complete real corpus and the selected encoding.', 503);
    }
    if (meta.presets === 'favorite' && (parameters.qualityInfluence !== .5 || parameters.cutoffBlendExponent !== 1)) {
      throw fail('This utility index currently contains only the saved favorite controls: quality 0.5 and cutoff weighting 1.', 503);
    }
    if (pointMethod(method) && meta.numericPoints !== true) throw fail('This comparison requires the numeric point index.', 503);
    if (idDocValuesRequired(method) && (state.idField?.type !== 'keyword' || state.idField.doc_values === false)) {
      throw fail('This fetch comparison requires an id keyword field with doc values.', 503);
    }
    const generation = JSON.stringify([method.index, state.uuid, state.generationToken, meta.identityHash, meta.planHash, pointMethod(method)]);
    if (!checkedGenerations.has(generation)) {
      const checking = (async () => {
        if (pointMethod(method)) {
          const fields = Object.values(state.numericUtilityFields ?? {});
          // OpenSearch may omit index/doc_values when they retain their true defaults.
          if (state.sourceEnabled !== false || !fields.length || fields.some(field => field.type !== 'float' || field.index === false || field.doc_values === false)) {
            throw fail('The point index must have source disabled and every utility mapped as an indexed float with doc values.', 503);
          }
        }
        const actual = await inspectUtilityCorpus(method.index, corpusIds, { signal });
        if (actual.count !== corpusIds.length) throw fail('The utility index document count does not match the known corpus.', 503);
        const found = new Set(actual.ids);
        if (found.size !== corpusIds.length || corpusIds.some(id => !found.has(id))) throw fail('The utility index must contain every known wallpaper and fixture before comparison.', 503);
      })();
      checkedGenerations.set(generation, checking);
    }
    try { await checkedGenerations.get(generation); }
    catch (error) { checkedGenerations.delete(generation); throw fail(`The utility index validation failed: ${error.message}`, 503); }
    return { indexUuid: state.uuid, indexIdentityHash: meta.identityHash, indexedCorpusCount: corpusIds.length };
  }
  async function getMethods() {
    const available = [];
    for (const method of FAVORITE_LAB_METHODS) {
      if (!precisionMethod(method) && !pointMethod(method) && !docvalueMethod(method) && !multiplicityMethod(method)) { available.push({ ...method, available: true }); continue; }
      try {
        await checkUtilityIndex(method, favoriteUtilityParameters(), undefined);
        available.push({ ...method, available: true });
      } catch (error) {
        available.push({ ...method, available: false, unavailableReason: error.message });
      }
    }
    return available;
  }
  return { corpus, getMethods, async search({ methodId, query, parameters, limit, signal }) {
    const method = methods.get(methodId);
    if (!method) throw fail('Unknown comparison method.');
    const options = { method: methodId, query, parameters, limit, excludedIds };
    const support = methodId === 'cutoff-shade-hue-all-levels' ? supportsCutoff(methodId, query, { parameters })
      : methodId === 'favorite-fused-script' ? supportsFavoriteOptimized(methodId, query, { parameters })
      : methodId === 'favorite-typed-script' ? supportsFavoriteTyped(methodId, query, { parameters })
      : pooledMethod(method) ? supportsFavoritePooled(methodId, query, { parameters })
      : multiplicityMethod(method) ? supportsFavoriteMultiplicity(methodId, query, { parameters })
      : docvalueMethod(method) ? supportsFavoriteDocvalueFetch(methodId, query, { parameters })
      : precisionMethod(method) ? supportsFavoritePrecision(methodId, query, { parameters })
      : sortedMethod(method) ? supportsFavoriteSorted(methodId, query, { parameters })
      : maximaMethod(method) ? supportsFavoriteMaximaBounded(methodId, query, { parameters })
      : boundedMethod(method) ? supportsFavoriteBounded(methodId, query, { parameters })
      : supportsFavoriteUtilities(methodId, query, { parameters });
    if (!support.supported) return { supported: false, reason: support.reason, warnings: support.warnings, hits: [], parameters };
    const indexEvidence = method.encoding ? await checkUtilityIndex(method, parameters, signal) : {};
    let result;
    if (pooledMethod(method)) {
      result = await searchPooledService({ ...options, index: method.index, signal, timeoutMs: 10000 });
    } else if (multiplicityMethod(method)) {
      result = await searchMultiplicityService({ ...options, index: method.index, signal, timeoutMs: 10000 });
    } else if (docvalueMethod(method)) {
      result = await searchDocvalueService({ ...options, index: method.index, signal, timeoutMs: 10000 });
    } else if (maximaMethod(method)) {
      result = await searchMaximaService({ ...options, index: method.index, signal, timeoutMs: 10000 });
    } else if (boundedMethod(method)) {
      result = await searchBoundedService({ ...options, index: method.index, signal, timeoutMs: 10000 });
    } else if (sortedMethod(method)) {
      result = await searchSortedService({ ...options, index: method.index, signal, timeoutMs: 10000 }, { search: searchService });
    } else {
      const body = methodId === 'cutoff-shade-hue-all-levels' ? buildCutoffQuery(options)
        : methodId === 'favorite-fused-script' ? buildFavoriteOptimizedQuery(options)
        : methodId === 'favorite-typed-script' ? buildFavoriteTypedQuery(options)
        : precisionMethod(method) ? buildFavoritePrecisionQuery(options) : buildFavoriteUtilityQuery(options);
      result = await searchService(method.index, body, { signal, timeoutMs: 10000 });
    }
    return { ...result, supported: true, parameters, warnings: support.warnings,
      evidence: { ...result.evidence, ...indexEvidence, engine: 'OpenSearch', index: method.index } };
  } };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}
async function readJson(request) {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw fail('Use application/json.', 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32768) throw fail('Search request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw fail('Invalid JSON.'); }
}
async function serveFile(request, response, filename, contentType, image = false) {
  const metadata = await stat(filename).catch(() => null);
  if (!metadata?.isFile()) throw fail('Image or page is unavailable.', 404);
  response.writeHead(200, { 'content-type': contentType, 'content-length': metadata.size,
    'cache-control': image ? 'private, max-age=3600' : 'no-cache' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filename).on('error', () => response.destroy()).pipe(response);
}
function sourceUrl(asset) {
  for (const value of [asset.source?.page, asset.source?.url]) {
    try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol)) return url.href; } catch {}
  }
  return null;
}

export function createFavoriteLabServer({ corpus, search, getMethods = () => FAVORITE_LAB_METHODS, getStrictness, searchStrictness, requestTimeoutMs = 12000, readPerformance = readFavoritePerformance }) {
  if (!Array.isArray(corpus) || typeof search !== 'function') throw Error('The lab requires a corpus and a service search function.');
  const assets = new Map(corpus.filter(realAsset).map(asset => [asset.id, asset]));
  if (assets.size !== corpus.filter(realAsset).length) throw Error('Corpus IDs must be unique.');
  const searches = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url, 'http://favorite-lab.invalid');
      if (url.pathname === '/api/search' || url.pathname === '/api/strictness/search') {
        if (request.method !== 'POST') throw fail('Use POST for searches.', 405);
        const strictness = url.pathname === '/api/strictness/search';
        const execute = strictness ? searchStrictness : search;
        if (typeof execute !== 'function') throw fail('Strictness comparison is unavailable.', 503);
        const payload = (strictness ? validateLinkedStrictnessRequest : validateFavoriteLabRequest)(await readJson(request));
        const controller = new AbortController(), started = performance.now();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        let result;
        const pending = Promise.resolve().then(() => execute({ ...payload, signal: controller.signal }));
        searches.add(pending);
        try { result = await pending; }
        finally { clearTimeout(timer); searches.delete(pending); }
        if (controller.signal.aborted) throw fail('Search timed out. Please try again.', 504);
        if (!Array.isArray(result?.hits)) throw fail('OpenSearch returned an invalid response.', 502);
        const seen = new Set(), method = methods.get(payload.methodId);
        const hits = result.hits.map(hit => {
          const asset = assets.get(hit.id);
          if (!asset || seen.has(hit.id) || !Number.isFinite(hit.score)) throw fail('OpenSearch returned an invalid or non-wallpaper result.', 502);
          seen.add(hit.id);
          const imageUrl = `/api/images/${encodeURIComponent(hit.id)}`;
          return { ...hit, title: asset.title ?? asset.id, imageUrl, thumbnailUrl: imageUrl + '?thumbnail=1', sourceUrl: sourceUrl(asset) };
        });
        sendJson(response, 200, { ...result, hits, ...(strictness ? { variant: payload.variant } : { methodId: payload.methodId }), elapsedMs: performance.now() - started,
          precision: result.precision ?? method?.precision ?? 'Original favorite formula; precomputed scores may differ slightly in floating-point rounding.' });
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw fail('Use a read request.', 405);
      if (url.pathname === '/api/strictness') {
        if (typeof getStrictness !== 'function') throw fail('Strictness comparison is unavailable.', 503);
        sendJson(response, 200, await getStrictness()); return;
      }
      if (url.pathname === '/api/performance') {
        if (url.searchParams.size) throw fail('Performance endpoint does not accept query parameters.', 400);
        sendJson(response, 200, await readPerformance()); return;
      }
      if (url.pathname === '/health') { sendJson(response, 200, { ok: true, wallpaperCount: assets.size, methods: methods.size }); return; }
      if (url.pathname === '/api/meta') {
        sendJson(response, 200, { methods: await getMethods(), wallpaperCount: assets.size, controls: {
          qualityInfluence: [0, .5, 1], cutoffBlendExponent: [0, 1, 3], targetStepPercent: 5,
        } }); return;
      }
      if (url.pathname.startsWith('/api/images/')) {
        const asset = assets.get(decodeURIComponent(url.pathname.slice('/api/images/'.length)));
        if (!asset) throw fail('Unknown wallpaper.', 404);
        const thumbnail = typeof asset.thumbnail === 'string' ? asset.thumbnail : asset.thumbnail?.filename;
        const filename = url.searchParams.has('thumbnail') && thumbnail ? thumbnail : asset.filename;
        const contentType = imageTypes[extname(filename).toLowerCase()];
        if (!contentType) throw fail('Unsupported image type.', 404);
        await serveFile(request, response, filename, contentType, true); return;
      }
      const file = staticFiles.get(url.pathname);
      if (!file) throw fail('Not found.', 404);
      await serveFile(request, response, ...file);
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.status ?? 500, { error: error.message ?? 'Search failed.' });
      else response.destroy();
    }
  });
  activeSearches.set(server, searches);
  return server;
}

export async function stopFavoriteLab(server, { closeTransports = closeFavoritePooledTransports } = {}) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  // Disconnected clients can leave bounded-search cleanup running after their
  // HTTP response has closed. Keep the shared transport alive until it settles.
  await Promise.allSettled([...(activeSearches.get(server) ?? [])]);
  await closeTransports();
}

export async function startFavoriteLab({ port = 8228, host = '0.0.0.0' } = {}) {
  const corpus = await loadExpandedCorpus();
  const provider = await createFavoriteLabProvider({ corpus });
  const strictness = await createLinkedStrictnessLabProvider({ corpus, originalSearch: provider.search, readIndexState: readUtilityIndexState });
  const server = createFavoriteLabServer({ ...provider, ...strictness });
  server.listen(port, host);
  await once(server, 'listening');
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startFavoriteLab();
  process.stdout.write(`Favorite optimization lab listening on 0.0.0.0:${server.address().port}\n`);
  let shutdown;
  const stop = () => { shutdown ??= stopFavoriteLab(server).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
