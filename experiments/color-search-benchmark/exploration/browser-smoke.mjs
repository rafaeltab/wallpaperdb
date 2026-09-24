// Integration/visual-API smoke checks. All result ordering comes from the live service.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CORPUS_STORE } from './service.mjs';

const base = process.env.COLOR_EXPLORATION_BROWSER ?? 'http://127.0.0.1:8225';
const metadata = await (await fetch(`${base}/api/meta`)).json();
const corpus = JSON.parse(await readFile(path.join(CORPUS_STORE, 'expanded-corpus.json'), 'utf8'));
const assets = Array.isArray(corpus) ? corpus : corpus.assets;
const fixtures = new Set(assets.filter((asset) => asset.cohort === 'controlled-fixture').map((asset) => asset.id));
const results = [];
const red = { mode: 'vibe', targets: [{ name: 'red', color: '#ed3030' }] };
const proportions = { mode: 'proportions', targets: [{ name: 'green', color: '#25a34a', percent: 40 }], unspecifiedRemainderPercent: 60 };
const picked = { mode: 'vibe', targets: [{ color: '#ff2200' }] };
const hsl = { mode: 'vibe', targets: [{ color: '#000000', space: 'hsl', tolerance: { h: 1, s: 0.02, l: 0.1 }, edgeWeight: 0.5 }] };
const rgb = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40, space: 'rgb', tolerance: { r: 0.2, g: 0.3, b: 0.3 }, edgeWeight: 0.5 }], unspecifiedRemainderPercent: 60 };
const hsv = { mode: 'vibe', targets: [{ color: '#ff2200', space: 'hsv', tolerance: { h: 0.2, s: 0.3, v: 0.4 }, edgeWeight: 0.5 }] };
const oklab = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 70, space: 'oklab', tolerance: { distance: 0.2 }, edgeWeight: 0.5 }, { color: '#000000', percent: 30, space: 'oklab', tolerance: { distance: 0.5 }, edgeWeight: 0.5 }], unspecifiedRemainderPercent: 0 };

async function search(methodId, query, { includeFixtures = false, limit = 12, label = methodId } = {}) {
  const response = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ methodId, query, includeFixtures, limit }), signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  assert.equal(response.status, 200, `${label}: ${body.error}`);
  assert.ok(Array.isArray(body.hits));
  assert.equal(new Set(body.hits.map((hit) => hit.id)).size, body.hits.length);
  for (let i = 0; i < body.hits.length; i++) {
    assert.ok(Number.isFinite(body.hits[i].score));
    if (i) assert.ok(body.hits[i - 1].score >= body.hits[i].score, `${label}: service results out of order`);
    if (!includeFixtures) assert.equal(fixtures.has(body.hits[i].id), false, `${label}: fixture leaked into wallpaper-only search`);
  }
  results.push({ label, methodId, supported: body.supported !== false, reason: body.reason, hitCount: body.hits.length, elapsedMs: body.elapsedMs,
    approximate: body.evidence?.approximate, engine: body.evidence?.engine, returnedFixtureCount: body.hits.filter((hit) => fixtures.has(hit.id)).length });
  return body;
}

for (const method of metadata.methods) {
  const smokeQuery = method.family === 'transport' ? proportions : method.engine === 'clickhouse' || method.family === 'palette-bounded' || method.searchKind?.startsWith('precision-') ? picked : red;
  const body = await search(method.id, smokeQuery);
  assert.notEqual(body.supported, false, `${method.id}: selected smoke query should be supported`);
  assert.ok(body.hits.length > 0, `${method.id}: empty results`);
  assert.equal(body.evidence.approximate, method.approximate ?? false, `${method.id}: retrieval metadata mismatch`);
  assert.equal(body.evidence.engine, method.engine ?? 'opensearch', `${method.id}: backend identity mismatch`);
}
for (const [label, query] of Object.entries({ picked, hsl, hsv, rgb, oklab })) {
  const body = await search('hybrid-relative-accents', query, { label: `hybrid-range-${label}` });
  assert.notEqual(body.supported, false);
  assert.ok(body.hits.length > 0);
}
const accents = await search('hybrid-relative-accents', { mode: 'vibe', targets: [{ name: 'dark', color: '#101014' }, { name: 'bright', color: '#fff6cc' }] }, { label: 'relative-bright-spots' });
assert.ok(accents.hits.length > 0);
const unsupported = await search('hsv-cosine-ann', hsl, { label: 'explicit-unsupported-hsl' });
assert.equal(unsupported.supported, false);
assert.ok(unsupported.reason);
assert.equal(unsupported.hits.length, 0);
const withFixtures = await search('hybrid-relative-accents', picked, { includeFixtures: true, limit: 100, label: 'precise-with-fixtures' });
assert.ok(withFixtures.hits.some((hit) => fixtures.has(hit.id)), 'Expected precise test swatches when fixtures are enabled');
await search('hybrid-relative-accents', picked, { includeFixtures: false, limit: 100, label: 'precise-without-fixtures' });
const image = await fetch(`${base}${withFixtures.hits[0].imageUrl}`);
assert.equal(image.status, 200);
assert.match(image.headers.get('content-type'), /^image\//);

const output = { createdAt: new Date().toISOString(), base, corpusCount: metadata.corpusCount, wallpaperCount: metadata.wallpaperCount, fixtureCount: metadata.fixtureCount,
  methodCount: metadata.methods.length, checks: results.length, results,
  note: 'Integration smoke observations under current shared machine load. These are not isolated performance measurements or new human judgments.' };
const directory = path.join(CORPUS_STORE, 'exploration/browser-qa');
await mkdir(directory, { recursive: true });
const filename = path.join(directory, `${output.createdAt.replaceAll(':', '-')}.json`);
await writeFile(filename, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ filename, methods: metadata.methods.length, checks: results.length, status: 'passed' }, null, 2));
