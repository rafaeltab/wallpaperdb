// Throwaway diagnostic UI. Existing comparison server and scoring remain unchanged.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserPresets } from './browser.mjs';
import { NAMED_COLORS } from './corpus-colors.mjs';
import { interpretQuery } from './query.mjs';

const staticFiles = new Map([
  ['/', ['histogram-inspector.html', 'text/html; charset=utf-8']],
  ['/assets/histogram-inspector.js', ['histogram-inspector.js', 'text/javascript; charset=utf-8']],
  ['/assets/histogram-inspector.css', ['histogram-inspector.css', 'text/css; charset=utf-8']],
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

export function createHistogramInspectorServer({ corpus, method, search, inspect, presets = browserPresets, namedColors = NAMED_COLORS, requestTimeoutMs = 30000 }) {
  if (!Array.isArray(corpus) || typeof search !== 'function' || typeof inspect !== 'function') throw Error('Inspector requires corpus, service search and diagnostics.');
  const assets = new Map(corpus.map(asset => [asset.id, asset]));
  if (assets.size !== corpus.length) throw Error('Duplicate corpus IDs.');
  const fixtures = corpus.filter(asset => asset.cohort === 'controlled-fixture').length;
  const imageUrls = id => ({ imageUrl: `/api/images/${encodeURIComponent(id)}`, thumbnailUrl: `/api/images/${encodeURIComponent(id)}?thumbnail=1` });
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url, 'http://histogram-inspector.invalid');
      if (['/api/search', '/api/inspect'].includes(url.pathname)) {
        if (request.method !== 'POST') throw failure('Use POST.', 405);
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('A query object is required.');
        const query = validateQuery(body.query);
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
            ? await inspect({ id: body.id, query, signal: controller.signal })
            : await search({ query, limit, includeFixtures: body.includeFixtures ?? false, signal: controller.signal });
        } finally { clearTimeout(timer); }
        if (controller.signal.aborted) throw failure('The service request timed out.', 504);
        const elapsedMs = performance.now() - started;
        if (inspecting) {
          send(response, 200, { ...result, id: body.id, query, ...imageUrls(body.id), elapsedMs });
        } else {
          if (!Array.isArray(result?.hits)) throw failure('Search service returned invalid results.', 502);
          const seen = new Set();
          const hits = result.hits.map(hit => {
            if (!assets.has(hit.id) || !Number.isFinite(hit.score) || seen.has(hit.id)) throw failure('Search service returned an invalid or unregistered result.', 502);
            seen.add(hit.id);
            return { ...hit, ...imageUrls(hit.id) };
          });
          send(response, 200, { ...result, hits, query, methodId: method.id, elapsedMs, exceedsOneSecond: elapsedMs >= 1000 });
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw failure('Use a read request.', 405);
      if (url.pathname === '/api/config') {
        send(response, 200, { method, corpus: { total: corpus.length, real: corpus.length - fixtures, fixtures }, presets, namedColors, comparisonUrl: 'http://zerotwo:8225/' });
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
