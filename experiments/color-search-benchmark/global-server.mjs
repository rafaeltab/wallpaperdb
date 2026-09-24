// Experimental read-only comparison UI. No arbitrary OpenSearch proxy or application reranking.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { nativeQuery, tokenQuery, NATIVE_FAMILIES } from './global-native.mjs';
import { dynamicQuery } from './global-dynamic.mjs';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const ENDPOINT = 'http://127.0.0.1:19216';
const INDEX = 'color-global-real-v1';
const MULTI_INDEX = 'color-global-multi-real-v1';
const PORT = Number(process.env.COLOR_GLOBAL_UI_PORT || 8221);
const MAX_BODY = 8192;
const MAX_SEARCHES = 4;
let searches = 0;
const dataCache = new Map();

export const METHODS = [
  { id: 'multi', label: 'Original-pixel joint · 1–5 colors', model: 'joint', maxColors: 5, dataset: 'global-multi-data.json', module: 'global-multi.mjs', description: 'Global joint composition from original-image pixel samples and exact membership patterns. One to five fixed families share area without double counting. Hard boundaries; experimental family definitions.' },
  { id: 'adaptive-multi', label: 'Adaptive original-pixel joint · 1–5 colors', model: 'joint', maxColors: 5, dataset: 'global-multi-data.json', module: 'global-multi.mjs', description: 'Same original-pixel joint model and global ordering, reached by safely widening an error bound. No token seeds or fixed candidate rerank. One to five fixed families.' },
  { id: 'native', label: 'Native fine coverage', model: 'marginal', description: 'Global native numeric ranking. Pixel-derived family coverage, rounded to 0.01 percentage points. Overlapping regions count independently.' },
  { id: 'tokens', label: 'Native coverage tokens', model: 'marginal', description: 'Global Boolean ranking over indexed tokens. Coverage and targets rounded to whole percentage points. Overlapping regions count independently.' },
  { id: 'bounded', label: 'Certified fine coverage', model: 'marginal', module: 'global-bounded.mjs', description: 'Coarse seeds establish a safe error bound; OpenSearch then finds the global fine-coverage winners. This is not a fixed candidate rerank.' },
  { id: 'adaptive-fine', label: 'Adaptive fine coverage', model: 'marginal', module: 'global-bounded.mjs', description: 'Starts with a small safe amount-error bound and widens it until the global fine-coverage page is complete. No token seeds. Overlapping regions count independently.' },
  { id: 'joint', label: 'Indexed joint composition', model: 'joint', module: 'global-joint.mjs', description: 'Global ranking with indexed pixel-derived family and union areas. One or two regions share area without counting a pixel twice. Hard boundaries.' },
  { id: 'joint-bounded', label: 'Certified joint composition', model: 'joint', module: 'global-joint-bounded.mjs', description: 'A safe bound reduces the indexed joint search while retaining global winners. Pixel-derived family and union areas; one or two regions, exclusive area, hard boundaries.' },
  { id: 'adaptive-joint', label: 'Adaptive joint composition', model: 'joint', module: 'global-joint-bounded.mjs', description: 'Starts with a small safe error bound and widens it until the global joint-composition page is complete. No token seeds. Same pixel-derived areas and ordering as indexed joint; one or two regions.' },
  { id: 'dynamic', label: 'Dynamic palette ranges', model: 'joint', description: 'Global Painless script sorting over 32-color palettes. This page uses the same family ranges, but this method supports arbitrary ranges. Hard boundaries; palette boundaries can lose valid pixel area.' },
];

async function dataset(filename = 'global-data.json') {
  const path = resolve(ROOT, filename);
  const info = await stat(path);
  let entry = dataCache.get(filename);
  if (!entry || entry.mtime !== info.mtimeMs) {
    entry = { value: JSON.parse(await readFile(path, 'utf8')), mtime: info.mtimeMs };
    dataCache.set(filename, entry);
  }
  return entry.value;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function validateInput(value, families = NATIVE_FAMILIES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Expected a JSON object.');
  const allowed = new Set(['method', 'colors', 'cohort', 'limit']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw httpError(400, 'Unsupported search option.');
  const method = METHODS.find(item => item.id === value.method);
  if (!method) throw httpError(400, 'Unknown search method.');
  const cohort = value.cohort ?? 'real';
  if (!['real', 'fixture'].includes(cohort)) throw httpError(400, 'Choose real wallpapers or fixtures.');
  const limit = value.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw httpError(400, 'Result limit must be between 1 and 20.');
  if (!Array.isArray(value.colors) || value.colors.length < 1 || value.colors.length > 5) throw httpError(400, 'Choose one to five color families.');
  const maxColors = method.maxColors ?? (method.model === 'joint' ? 2 : 5);
  if (value.colors.length > maxColors) throw httpError(400, `This method supports at most ${maxColors} regions.`);
  const seen = new Set();
  const colors = value.colors.map(color => {
    if (!color || typeof color !== 'object' || Array.isArray(color) || Object.keys(color).some(key => !['family', 'amount'].includes(key))) throw httpError(400, 'Each color needs only a family and amount.');
    if (!families.some(family => family.id === color.family) || seen.has(color.family)) throw httpError(400, 'Choose known, distinct color families.');
    if (typeof color.amount !== 'number' || !Number.isFinite(color.amount) || color.amount < 0 || color.amount > 1) throw httpError(400, 'Each amount must be between 0 and 100%.');
    seen.add(color.family);
    return { family: color.family, amount: color.amount };
  });
  if (colors.reduce((sum, color) => sum + color.amount, 0) > 1 + 1e-10) throw httpError(400, 'Requested amounts must add up to at most 100%.');
  if (method.model === 'joint' && colors.some(color => color.amount <= 0)) throw httpError(400, 'Joint methods need positive amounts.');
  return { method, cohort, limit, colors };
}

async function searchRequest(body, index = INDEX) {
  if (![INDEX, MULTI_INDEX].includes(index)) throw new Error('Unknown experiment index.');
  const response = await fetch(`${ENDPOINT}/${index}/_search?allow_partial_search_results=false`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, timeout: '15s' }), signal: AbortSignal.timeout(18000),
  });
  const result = await response.json();
  if (!response.ok) throw httpError(502, result.error?.root_cause?.[0]?.reason || result.error?.reason || 'OpenSearch search failed.');
  if (result.timed_out || result.terminated_early || result._shards?.failed) throw httpError(504, 'OpenSearch did not complete every shard. Partial results are not shown.');
  return result;
}

async function optionalModule(name) {
  try { return await import(new URL(name, import.meta.url)); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') throw httpError(503, 'This method is still being prepared. Refresh after the experiment is ready.'); throw error; }
}

async function closePit(id) {
  if (!id) return;
  const response = await fetch(`${ENDPOINT}/_search/point_in_time`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pit_id: [id] }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('OpenSearch rejected PIT cleanup.');
}

export async function executeSearch(input) {
  const data = await dataset();
  if (JSON.stringify(data.families) !== JSON.stringify(NATIVE_FAMILIES)) throw httpError(503, 'Color features are being regenerated. Run prepare and index with the current family definitions.');
  const { method, cohort, limit, colors } = validateInput(input, data.families);
  const sourceData = method.dataset ? await dataset(method.dataset) : data;
  if (sourceData.families && JSON.stringify(sourceData.families) !== JSON.stringify(data.families)) throw httpError(503, 'Original-pixel features use different family definitions. Regenerate the experiment data and index.');
  const index = method.dataset ? MULTI_INDEX : INDEX;
  const filter = [{ term: { cohort } }];
  const started = performance.now();
  let result;
  let request;
  let diagnostics = {};
  if (method.id === 'native' || method.id === 'tokens') {
    request = (method.id === 'native' ? nativeQuery : tokenQuery)(colors, { size: limit, precision: 'fine', filter, _source: false });
    result = await searchRequest(request);
    diagnostics = { queryCount: 1 };
  } else if (method.id === 'dynamic') {
    const ranges = colors.map(color => ({ ...data.families.find(family => family.id === color.family), amount: color.amount }));
    request = dynamicQuery(ranges, { size: limit, filters: filter, trackTotalHits: false, source: false, mode: 'target' });
    result = await searchRequest(request);
    diagnostics = { queryCount: 1 };
  } else if (method.id === 'multi') {
    const { multiQuery } = await optionalModule('global-multi.mjs');
    request = multiQuery(colors, { size: limit, filters: filter, _source: false, track_total_hits: false, mode: 'target', scriptVariant: 'typed' });
    result = await searchRequest(request, index);
    diagnostics = { queryCount: 1 };
  } else if (method.id === 'joint') {
    const { jointQuery } = await optionalModule('global-joint.mjs');
    request = jointQuery(colors, { size: limit, filters: filter, _source: false, track_total_hits: false, mode: 'target' });
    result = await searchRequest(request);
    diagnostics = { queryCount: 1 };
  } else {
    const module = await optionalModule(method.module);
    const boundedSearch = module.boundedMultiSearch ?? module.boundedJointSearch ?? module.boundedSearch;
    const closeBoundedPit = module.closePit;
    let bounded;
    try {
      const threshold = method.id === 'adaptive-fine' ? 100 : ['adaptive-joint', 'adaptive-multi'].includes(method.id) ? 0.01 : undefined;
      bounded = await boundedSearch(index, colors, { size: limit, filter, _source: false, ...(method.id === 'adaptive-multi' ? { scriptVariant: 'typed' } : {}), ...(threshold !== undefined ? { threshold } : {}) });
      result = bounded.response ?? { hits: { hits: bounded.hits }, took: bounded.took };
      diagnostics = { ...bounded.diagnostics, threshold: bounded.threshold, timing: bounded.timing, requestCount: bounded.timing ? bounded.timing.requests + 1 : null, exhausted: bounded.exhausted };
    } finally {
      if (bounded?.pitId) {
        try { if (closeBoundedPit) await closeBoundedPit(bounded.pitId); else await closePit(bounded.pitId); diagnostics.pitClosed = true; }
        catch (error) { diagnostics.pitClosed = false; console.error('PIT cleanup failed; its keep-alive will expire.', error); }
      }
    }
  }
  const documents = new Map([...data.wallpapers, ...data.fixtures].map(doc => [doc.id, doc]));
  const measured = new Map([...sourceData.wallpapers, ...sourceData.fixtures].map(doc => [doc.id, doc]));
  const hits = result.hits?.hits;
  if (!Array.isArray(hits)) throw httpError(502, 'Unexpected search response.');
  const mapped = hits.map(hit => {
    const id = hit._id ?? hit.id;
    const doc = documents.get(id);
    const areas = measured.get(id);
    if (!doc || doc.cohort !== cohort || !areas) throw httpError(502, 'The indexed corpus and local corpus metadata do not match.');
    const units = method.id === 'tokens' ? 100 : 10000;
    const cost = method.model === 'marginal' ? (colors.length * units - hit._score) / units : method.id === 'dynamic' ? hit.sort?.[0] : 1 - hit._score;
    return {
      id, title: doc.title || id, thumbnail: doc.thumbnail, filename: doc.filename,
      sourcePage: doc.sourcePage, synthetic: Boolean(doc.synthetic),
      score: hit._score, sort: hit.sort, error: typeof cost === 'number' ? Math.max(0, cost) : null,
      coverage: colors.map(color => ({ family: color.family, amount: areas.features[color.family] })),
    };
  });
  return {
    method: method.id, model: method.model, description: method.description, colors, cohort,
    eligibleDocuments: cohort === 'real' ? sourceData.wallpapers.length : sourceData.fixtures.length,
    coverageSource: cohort === 'fixture' ? 'Constructed fixture color areas.' : method.dataset ? 'Original-image coverage sample: about 65,000 jittered pixels, with no resize or interpolation. Both ranking and displayed areas use these samples.' : 'Historical coverage sample: image resized to fit within 256 × 256 pixels. Resizing can change narrow color membership.',
    wallMs: performance.now() - started, opensearchMs: result.took ?? null,
    generatedAt: sourceData.generatedAt, diagnostics, hits: mapped,
    request: request ?? { note: method.id.startsWith('adaptive-') ? 'Adaptive search widens a globally safe error bound without token seeds. See diagnostics and GLOBAL-OPTIONS.md.' : 'Certified search uses a seed request and globally safe final search. See diagnostics and GLOBAL-OPTIONS.md.' },
  };
}

async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw httpError(415, 'Use application/json.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, 'Search request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'Invalid JSON.'); }
}

const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function createGlobalServer() {
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/search') {
        if (request.method !== 'POST') throw httpError(405, 'Search uses POST.');
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) throw httpError(403, 'Cross-origin searches are disabled.');
        if (searches >= MAX_SEARCHES) throw httpError(429, 'Four searches are already running. Try again shortly.');
        const input = await readBody(request);
        if (searches >= MAX_SEARCHES) throw httpError(429, 'Four searches are already running. Try again shortly.');
        searches++;
        try { json(response, 200, await executeSearch(input)); } finally { searches--; }
        return;
      }
      if (url.pathname === '/api/config') {
        if (request.method !== 'GET') throw httpError(405, 'Configuration uses GET.');
        const data = await dataset();
        const methods = await Promise.all(METHODS.map(async method => ({ ...method, available: (!method.module || await stat(resolve(ROOT, method.module)).then(() => true, () => false)) && (!method.dataset || await stat(resolve(ROOT, method.dataset)).then(() => true, () => false)) })));
        const originalData = methods.some(method => method.dataset && method.available) ? await dataset('global-multi-data.json') : null;
        json(response, 200, { families: data.families, methods, realCount: data.wallpapers.length, fixtureCount: data.fixtures.length, generatedAt: data.generatedAt, originalGeneratedAt: originalData?.generatedAt ?? null });
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw httpError(405, 'Only static reads and the search API are supported.');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/global.html' : url.pathname);
      if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\\') || pathname.includes('\0')) throw httpError(404, 'Not found.');
      const path = await realpath(resolve(ROOT, `.${pathname}`));
      if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || !mime[extname(path)]) throw httpError(404, 'Not found.');
      const info = await stat(path);
      if (!info.isFile()) throw httpError(404, 'Not found.');
      response.writeHead(200, { 'content-type': mime[extname(path)] + (/\.(html|mjs|js|css|md|json)$/.test(path) ? '; charset=utf-8' : ''), 'content-length': info.size, 'cache-control': /\.(html|mjs|js|json)$/.test(path) ? 'no-store' : 'public, max-age=300' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : error.name === 'TimeoutError' ? 504 : 500);
      if (!response.headersSent) json(response, status, { error: status === 500 ? 'The experiment is not ready or the search failed. Check the server log.' : error.message });
      else response.destroy();
      if (status >= 500) console.error(error);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('Invalid COLOR_GLOBAL_UI_PORT.');
  const server = createGlobalServer();
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.listen(PORT, '0.0.0.0', () => console.log(`Global color comparison: http://zerotwo:${PORT}/global.html (OpenSearch ${ENDPOINT}, fixed indexes ${INDEX}, ${MULTI_INDEX})`));
}
