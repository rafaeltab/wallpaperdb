// Throwaway diagnostic UI. Existing comparison server and scoring remain unchanged.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMED_COLORS } from './corpus-colors.mjs';
import { overlapParameters } from './methods-overlap.mjs';
import { cutoffParameters } from './methods-cutoff.mjs';
import { CUTOFF_LEVELS, cutoffLevel } from './cutoff-definition.mjs';
import { CUTOFF_QUERY_PROFILES } from './cutoff-blend.mjs';
import { OVERLAP_BUCKET_COUNTS } from './overlap-banks.mjs';
import { overlapRegionColors } from './overlap-region-colors.mjs';
import { cutoffRegionColors } from './cutoff-region-colors.mjs';
import { shadeRegionColors, hueRegionColors } from './shade-region-colors.mjs';
import { interpretQuery } from './query.mjs';

const staticFiles = new Map([
  ['/', ['overlap-inspector.html', 'text/html; charset=utf-8']],
  ['/assets/overlap-inspector.js', ['overlap-inspector.js', 'text/javascript; charset=utf-8']],
  ['/assets/overlap-color-layout.mjs', ['overlap-color-layout.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/overlap-color-layers.mjs', ['overlap-color-layers.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/overlap-inspector.css', ['overlap-inspector.css', 'text/css; charset=utf-8']],
].map(([route, [file, type]]) => [route, [fileURLToPath(new URL(`./web/${file}`, import.meta.url)), type]]));
const imageTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}
async function readJson(request) {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw failure('Use application/json.', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw failure('Query request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw failure('Invalid JSON.'); }
}
async function fileResponse(request, response, filename, type, image = false) {
  const info = await stat(filename).catch(() => null);
  if (!info?.isFile()) throw failure('Asset unavailable.', 404);
  response.writeHead(200, {
    'content-type': type, 'content-length': info.size, 'cache-control': image ? 'private, max-age=3600' : 'no-cache',
    ...(image ? { 'content-security-policy': "default-src 'none'; sandbox" } : {}),
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filename).on('error', () => response.destroy()).pipe(response);
}
function validateQuery(query) {
  const compiled = interpretQuery(query);
  if (!compiled.supported) throw failure(compiled.reason);
  return query;
}
function validateParameters(method, supplied = {}) {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw failure('Parameters must be an object.');
  try { return String(method).startsWith('cutoff-') ? cutoffParameters(method, supplied) : overlapParameters(method, supplied); }
  catch (cause) { throw failure(cause.message); }
}

const defaultRegionColors = args => args.metric === 'shade-hue-aware' ? hueRegionColors(args) : args.metric === 'shade-aware' ? shadeRegionColors(args) : args.profile ? cutoffRegionColors(args) : overlapRegionColors(args);
export function createOverlapInspectorServer({ corpus, methods, search, inspect, regionColors = defaultRegionColors, presets = overlapPresets, namedColors = NAMED_COLORS, requestTimeoutMs = 30000 }) {
  if (!Array.isArray(corpus) || typeof search !== 'function' || typeof inspect !== 'function') throw Error('Inspector requires corpus, service search and diagnostics.');
  const methodIds = new Set(methods.map(method => method.id));
  const assets = new Map(corpus.map(asset => [asset.id, asset]));
  if (assets.size !== corpus.length) throw Error('Duplicate corpus IDs.');
  const fixtures = corpus.filter(asset => asset.cohort === 'controlled-fixture').length;
  const imageUrls = id => ({ imageUrl: `/api/images/${encodeURIComponent(id)}`, thumbnailUrl: `/api/images/${encodeURIComponent(id)}?thumbnail=1` });
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url, 'http://overlap-inspector.invalid');
      if (['/api/search', '/api/inspect'].includes(url.pathname)) {
        if (request.method !== 'POST') throw failure('Use POST.', 405);
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('A query object is required.');
        const query = validateQuery(body.query);
        const method = body.methodId ?? methods[0].id;
        if (!methodIds.has(method)) throw failure('Unknown overlapping-color method.');
        const parameters = validateParameters(method, body.parameters);
        const inspecting = url.pathname === '/api/inspect';
        if (inspecting && !assets.has(body.id)) throw failure('Unknown wallpaper.', 404);
        const limit = body.limit ?? 24;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw failure('Result count must be between 1 and 100.');
        if (body.includeFixtures !== undefined && typeof body.includeFixtures !== 'boolean') throw failure('Fixture inclusion must be true or false.');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('Diagnostic request timed out.')), requestTimeoutMs);
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        const started = performance.now();
        let result;
        try {
          result = inspecting
            ? await inspect({ method, id: body.id, query, parameters, signal: controller.signal })
            : await search({ method, query, parameters, limit, includeFixtures: body.includeFixtures ?? false, signal: controller.signal });
        } finally { clearTimeout(timer); }
        if (controller.signal.aborted) throw failure('The service request timed out.', 504);
        const elapsedMs = performance.now() - started;
        if (inspecting) {
          send(response, 200, { ...result, parameters: result?.parameters ?? parameters, id: body.id, query, ...imageUrls(body.id), elapsedMs });
        } else {
          if (!Array.isArray(result?.hits)) throw failure('Search service returned invalid results.', 502);
          const seen = new Set();
          const hits = result.hits.map(hit => {
            if (!assets.has(hit.id) || !Number.isFinite(hit.score) || seen.has(hit.id)) throw failure('Search service returned an invalid or unregistered result.', 502);
            seen.add(hit.id);
            return { ...hit, ...imageUrls(hit.id) };
          });
          send(response, 200, { ...result, parameters: result.parameters ?? parameters, hits, query, methodId: method, elapsedMs, exceedsOneSecond: elapsedMs >= 1000 });
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw failure('Use a read request.', 405);
      if (url.pathname === '/api/region-colors') {
        const allowed = new Set(['regionIndex', 'bucketCount', 'profile', 'cutoff', 'cutoffBlendExponent', 'metric']);
        for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw failure('Invalid region color parameters.');
        const regionIndex = url.searchParams.get('regionIndex');
        const bucketCount = url.searchParams.get('bucketCount') ?? '1024';
        if (!/^(0|[1-9]\d*)$/.test(regionIndex ?? '')) throw failure('A valid region index is required.');
        if (!/^(16|64|256|1024)$/.test(bucketCount)) throw failure('Bucket count must be 16, 64, 256, or 1024.');
        const profile = url.searchParams.get('profile'), cutoff = url.searchParams.get('cutoff');
        const metric = url.searchParams.get('metric');
        if (metric !== null && !['shade-aware', 'shade-hue-aware'].includes(metric)) throw failure('Unknown color membership metric.');
        if (metric !== null && !['hard', 'all-levels'].includes(profile)) throw failure('Shade-aware geometry requires a hard or all-levels profile.');
        if (profile !== null && !CUTOFF_QUERY_PROFILES.some(item => item.id === profile)) throw failure('Unknown pixel membership profile.');
        if (cutoff !== null && profile === null) throw failure('A profile is required with a pixel cutoff.');
        if (cutoff !== null) {
          if (cutoff.trim() === '') throw failure('A pixel cutoff is required.');
          try { cutoffLevel(Number(cutoff)); } catch (cause) { throw failure(cause.message); }
        }
        const exponent = url.searchParams.get('cutoffBlendExponent');
        if (exponent !== null && profile !== 'all-levels') throw failure('A cutoff blend exponent requires the all-levels profile.');
        if (exponent !== null && (exponent.trim() === '' || !Number.isFinite(Number(exponent)) || Number(exponent) < 0 || Number(exponent) > 6)) throw failure('Cutoff blend exponent must be between 0 and 6.');
        let result;
        try { result = await regionColors({ regionIndex: Number(regionIndex), bucketCount: Number(bucketCount), ...(metric !== null ? { metric } : {}), ...(profile !== null ? { profile, cutoff: profile === 'all-levels' ? 0 : cutoff === null ? .5 : Number(cutoff) } : {}), ...(profile === 'all-levels' ? { cutoffBlendExponent: exponent === null ? 0 : Number(exponent) } : {}) }); }
        catch (cause) { throw failure(cause.message); }
        send(response, 200, result);
        return;
      }
      if (url.pathname === '/api/config') {
        send(response, 200, { methods, bucketCounts: OVERLAP_BUCKET_COUNTS, defaultBucketCount: 1024, cutoffLevels: CUTOFF_LEVELS, cutoffProfiles: CUTOFF_QUERY_PROFILES, corpus: { total: corpus.length, real: corpus.length - fixtures, fixtures }, presets, namedColors, comparisonUrl: 'http://zerotwo:8225/' });
        return;
      }
      if (url.pathname.startsWith('/api/images/')) {
        const asset = assets.get(decodeURIComponent(url.pathname.slice('/api/images/'.length)));
        if (!asset) throw failure('Unknown wallpaper.', 404);
        const thumbnail = typeof asset.thumbnail === 'string' ? asset.thumbnail : asset.thumbnail?.filename;
        const filename = url.searchParams.has('thumbnail') && thumbnail ? thumbnail : asset.filename;
        const type = imageTypes[extname(filename).toLowerCase()];
        if (!type) throw failure('Unsupported image type.', 404);
        await fileResponse(request, response, filename, type, true);
        return;
      }
      const file = staticFiles.get(url.pathname);
      if (!file) throw failure('Not found.', 404);
      await fileResponse(request, response, ...file);
    } catch (cause) {
      if (!response.headersSent) send(response, cause.status ?? 500, { error: cause.message ?? 'Inspection failed.' });
      else response.destroy();
    }
  });
}

export const overlapPresets = [
  { label: 'Picked bright red', query: { mode: 'vibe', targets: [{ color: '#ff0000' }] } },
  { label: 'Named red', query: { mode: 'vibe', targets: [{ name: 'red', color: '#ef2020' }] } },
  { label: '40% green, rest free', query: { mode: 'proportions', targets: [{ name: 'green', color: '#209040', percent: 40 }] } },
  { label: '80% grayscale + 20% red', query: { mode: 'proportions', targets: [{ name: 'grayscale', color: '#808080', percent: 80 }, { name: 'red', color: '#ef2020', percent: 20 }] } },
  { label: '50% green + 50% red', query: { mode: 'proportions', targets: [{ name: 'green', color: '#209040', percent: 50 }, { name: 'red', color: '#ef2020', percent: 50 }] } },
  { label: 'Precise orange-red', query: { mode: 'vibe', targets: [{ color: '#ff2200' }] } },
  { label: 'Dark', query: { mode: 'vibe', targets: [{ name: 'dark', color: '#101010' }] } },
];
