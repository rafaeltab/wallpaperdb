// Throwaway service-backed color search browser. Search order belongs to the provider.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const web = new URL('./web/', import.meta.url);
const staticFiles = new Map([
  ['/', [fileURLToPath(new URL('index.html', web)), 'text/html; charset=utf-8']],
  ['/assets/browser.js', [fileURLToPath(new URL('browser.js', web)), 'text/javascript; charset=utf-8']],
  ['/assets/browser.css', [fileURLToPath(new URL('browser.css', web)), 'text/css; charset=utf-8']],
]);
const imageTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.gif': 'image/gif' };
const namedTarget = (name, color, percent) => ({ name, color, ...(percent === undefined ? {} : { percent }), edgeWeight: 0.5 });
export const browserPresets = [
  { label: 'Feels red', query: { mode: 'vibe', targets: [namedTarget('red', '#ed3030')] } },
  { label: 'Dark', query: { mode: 'vibe', targets: [namedTarget('dark', '#101014')] } },
  { label: 'Grayscale', query: { mode: 'vibe', targets: [namedTarget('grayscale', '#808080')] } },
  { label: 'Bright and vivid', query: { mode: 'vibe', targets: [namedTarget('bright', '#ffe550'), namedTarget('vivid', '#ff6633')] } },
  { label: '40% green, rest free', query: { mode: 'proportions', targets: [namedTarget('green', '#25a34a', 40)], unspecifiedRemainderPercent: 60 } },
  { label: '50% red + 50% green', query: { mode: 'proportions', targets: [namedTarget('red', '#ed3030', 50), namedTarget('green', '#25a34a', 50)], unspecifiedRemainderPercent: 0 } },
  { label: '80% grayscale + 20% red', query: { mode: 'proportions', targets: [namedTarget('grayscale', '#808080', 80), namedTarget('red', '#ed3030', 20)], unspecifiedRemainderPercent: 0 } },
  { label: '80% grayscale + 10% red, rest free', query: { mode: 'proportions', targets: [namedTarget('grayscale', '#808080', 80), namedTarget('red', '#ed3030', 10)], unspecifiedRemainderPercent: 10 } },
  { label: '70% reddish + 30% dark', query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 70, space: 'oklab', tolerance: { distance: 0.2 }, edgeWeight: 0.5 }, { color: '#000000', percent: 30, space: 'oklab', tolerance: { distance: 0.5 }, edgeWeight: 0.5 }], unspecifiedRemainderPercent: 0 } },
  { label: 'Five rainbow colors', query: { mode: 'proportions', targets: [namedTarget('red', '#ed3030', 20), namedTarget('orange', '#f48124', 20), namedTarget('yellow', '#f0d438', 20), namedTarget('green', '#25a34a', 20), namedTarget('blue', '#2872de', 20)], unspecifiedRemainderPercent: 0 } },
  { label: 'Trans flag palette', query: { mode: 'proportions', targets: [{ color: '#5bcefa', percent: 40 }, { color: '#f5a9b8', percent: 40 }, { color: '#ffffff', percent: 20 }], unspecifiedRemainderPercent: 0 } },
  { label: 'Precise orange-red', query: { mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: 0.15 }, edgeWeight: 0.5 }] } },
  { label: 'Dark grayscale · HSL range', query: { mode: 'vibe', targets: [{ color: '#000000', space: 'hsl', tolerance: { h: 1, s: 0.02, l: 0.1 }, edgeWeight: 0.5 }] } },
  { label: 'Dark with bright spots', query: { mode: 'vibe', targets: [namedTarget('dark', '#101014'), namedTarget('bright', '#fff6cc')] } },
  { label: 'Picked orange-red · method defaults', query: { mode: 'vibe', targets: [{ color: '#ff2200' }] } },
];

function error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function validateRequest(body, methodIds) {
  if (!body || !methodIds.has(body.methodId)) throw error('Choose a registered method.');
  if (body.includeFixtures !== undefined && typeof body.includeFixtures !== 'boolean') throw error('Fixture inclusion must be true or false.');
  const limit = body.limit ?? 24;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw error('Result count must be between 1 and 100.');
  const query = body.query;
  if (!query || !['vibe', 'proportions'].includes(query.mode)) throw error('Choose vibe or proportions mode.');
  if (!Array.isArray(query.targets) || query.targets.length < 1 || query.targets.length > 8) throw error('Choose between one and eight targets.');
  let total = 0;
  for (const target of query.targets) {
    if (!target || !/^#[0-9a-f]{6}$/i.test(target.color ?? '')) throw error('Each color must use a six-digit hex value.');
    if (target.name !== undefined && (typeof target.name !== 'string' || target.name.length > 64)) throw error('Invalid target name.');
    if (target.percent !== undefined && (!Number.isFinite(target.percent) || target.percent < 0 || target.percent > 100)) throw error('Target percentages must be between 0 and 100.');
    if (query.mode === 'proportions' && target.percent === undefined) throw error('Each proportion target needs a percentage.');
    total += target.percent ?? 0;
    if (target.space !== undefined && !['oklab', 'rgb', 'hsv', 'hsl'].includes(target.space)) throw error('Unsupported color space.');
    if (target.edgeWeight !== undefined && (!Number.isFinite(target.edgeWeight) || target.edgeWeight < 0 || target.edgeWeight > 1)) throw error('Edge weight must be between zero and one.');
    if (target.tolerance !== undefined) {
      if (!target.tolerance || typeof target.tolerance !== 'object' || Array.isArray(target.tolerance)) throw error('Invalid tolerance.');
      for (const [key, value] of Object.entries(target.tolerance)) {
        if (!['distance', 'r', 'g', 'b', 'h', 's', 'v', 'l'].includes(key) || !Number.isFinite(value) || value < 0 || value > 1) throw error('Range distances must be between zero and one.');
      }
    }
  }
  if (query.mode === 'proportions' && total > 100.000001) throw error('Requested portions cannot exceed 100%.');
  if (query.unspecifiedRemainderPercent !== undefined && (!Number.isFinite(query.unspecifiedRemainderPercent) || Math.abs(query.unspecifiedRemainderPercent - (100 - total)) > 0.000001)) throw error('The unspecified remainder must complete the requested portions to 100%.');
  return { methodId: body.methodId, query, limit, includeFixtures: body.includeFixtures ?? false };
}

async function readJson(request) {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw error('Use application/json.', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65536) throw error('Request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw error('Invalid JSON.'); }
}

function sendJson(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(encoded) });
  response.end(encoded);
}

async function serveFile(request, response, filename, type, image = false) {
  const metadata = await stat(filename).catch(() => null);
  if (!metadata?.isFile()) throw error('Asset unavailable.', 404);
  response.writeHead(200, {
    'content-type': type,
    'content-length': metadata.size,
    'cache-control': image ? 'private, max-age=3600' : 'no-cache',
    ...(image ? { 'content-security-policy': "default-src 'none'; sandbox" } : {}),
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filename).on('error', () => response.destroy()).pipe(response);
}

export function createBrowserServer({ methods, corpus, search, description, reportUrl, findingsUrl, getFindingsHtml, presets = browserPresets, requestTimeoutMs = 15000 }) {
  if (!Array.isArray(methods) || !Array.isArray(corpus) || typeof search !== 'function') throw new Error('Browser requires methods, corpus, and a service search function.');
  const methodIds = new Set(methods.map((method) => method.id));
  const assets = new Map(corpus.map((asset) => [asset.id, asset]));
  const fixtureCount = corpus.reduce((sum, asset) => sum + (asset.cohort === 'controlled-fixture' ? 1 : 0), 0);
  if (assets.size !== corpus.length) throw new Error('Corpus IDs must be unique.');
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'same-origin');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url, 'http://color-browser.invalid');
      if (url.pathname === '/api/search') {
        if (request.method !== 'POST') throw error('Use POST for searches.', 405);
        const payload = validateRequest(await readJson(request), methodIds);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('Search request timed out.')), requestTimeoutMs);
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        const started = performance.now();
        let result;
        try { result = await search({ ...payload, signal: controller.signal }); }
        finally { clearTimeout(timer); }
        const elapsedMs = performance.now() - started;
        if (controller.signal.aborted) throw error('Search exceeded the browser request timeout.', 504);
        if (!Array.isArray(result?.hits)) throw error('Search service returned invalid hits.', 502);
        const seen = new Set();
        const hits = result.hits.map((hit) => {
          if (!assets.has(hit.id)) throw error('Search service returned an unregistered corpus ID.', 502);
          if (!Number.isFinite(hit.score) || seen.has(hit.id)) throw error('Search service returned an invalid score or duplicate result.', 502);
          seen.add(hit.id);
          return { ...hit, imageUrl: `/api/images/${encodeURIComponent(hit.id)}`, thumbnailUrl: `/api/images/${encodeURIComponent(hit.id)}?thumbnail=1` };
        });
        sendJson(response, 200, { ...result, hits, methodId: payload.methodId, elapsedMs, exceedsOneSecond: elapsedMs > 1000 });
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw error('Only read requests are supported here.', 405);
      if (url.pathname === '/findings') {
        if (typeof getFindingsHtml !== 'function') throw error('Findings are not available yet.', 404);
        const html = await getFindingsHtml();
        if (typeof html !== 'string') throw error('The findings generator did not return HTML.', 502);
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(html),
          'content-security-policy': "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
        });
        response.end(request.method === 'HEAD' ? undefined : html);
        return;
      }
      if (url.pathname === '/api/meta') {
        sendJson(response, 200, { methods, corpusCount: corpus.length, wallpaperCount: corpus.length - fixtureCount, fixtureCount, description: description ?? 'Real search-service queries over the shared wallpaper corpus.', reportUrl, findingsUrl, presets });
        return;
      }
      if (url.pathname === '/health') {
        sendJson(response, 200, { ok: true, methods: methods.length, corpusCount: corpus.length });
        return;
      }
      if (url.pathname.startsWith('/api/images/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/images/'.length));
        const asset = assets.get(id);
        if (!asset) throw error('Unknown image.', 404);
        const thumbnail = typeof asset.thumbnail === 'string' ? asset.thumbnail : asset.thumbnail?.filename;
        const filename = url.searchParams.has('thumbnail') && thumbnail ? thumbnail : asset.filename;
        const type = imageTypes[extname(filename).toLowerCase()];
        if (!type) throw error('Unsupported image type.', 404);
        await serveFile(request, response, filename, type, true);
        return;
      }
      const asset = staticFiles.get(url.pathname);
      if (!asset) throw error('Not found.', 404);
      await serveFile(request, response, ...asset);
    } catch (cause) {
      if (!response.headersSent) sendJson(response, cause.status ?? 500, { error: cause.message ?? 'Search failed.' });
      else response.destroy();
    }
  });
}

export async function startBrowserServer(options) {
  const server = createBrowserServer(options);
  server.listen(options.port ?? 8225, options.host ?? '0.0.0.0');
  await once(server, 'listening');
  return server;
}
