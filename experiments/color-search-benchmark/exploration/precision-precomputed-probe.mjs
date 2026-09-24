// Offline diagnostic: both reference and experimental scores/rankings come from OpenSearch.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { INDEX, STORE, searchIndex, hash, loadFeatures } from './service.mjs';
import { rgbToLab } from './corpus-colors.mjs';
import { buildPrecisionTypedQuery } from './methods-precision-typed.mjs';
import { buildPrecisionPrecomputedQuery, LAB_ERROR, searchPrecisionPrecomputedBounded } from './methods-precision-precomputed.mjs';

const queryCases = ['#ff2200', '#4c8c72', '#808080', '#080808'].map(swatchHex => ({ id: swatchHex, query: { swatchHex } }));
queryCases.push({ id: 'zero-radius', query: { mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: 0 }, edgeWeight: 0.5 }] } });
queryCases.push({ id: 'flat-edge', query: { mode: 'vibe', targets: [{ color: '#4c8c72', space: 'oklab', tolerance: { distance: 0.2 }, edgeWeight: 1 }] } });
const feature = (await loadFeatures()).find(f => f.id === 'wallpaper-042') ?? (await loadFeatures())[0];
const rgb = Math.floor(feature.palette32_packed[0] / 65536);
const lab = rgbToLab([(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255]);
const anchor = rgbToLab([1, 34 / 255, 0]);
const boundary = Math.hypot(...lab.map((v, i) => v - anchor[i]));
for (const delta of [-0.25, 0, 0.25]) queryCases.push({ id: `centroid-edge-${delta}`, query: { mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: boundary + delta * LAB_ERROR }, edgeWeight: 0.5 }] } });
const results = [];
for (const item of queryCases) {
  const body = buildPrecisionTypedQuery({ query: item.query, limit: 1000 });
  const reference = await searchIndex(INDEX, body);
  const actual = await searchIndex(INDEX, buildPrecisionPrecomputedQuery({ query: item.query, limit: 1000 }));
  const scoreMap = new Map(reference.hits.map(hit => [hit.id, hit.score]));
  const { radius, edgeWeight } = body.query.script_score.script.params;
  const bound = radius > 0 ? (1 - edgeWeight) * LAB_ERROR / radius + 2e-7 : 2e-7;
  const errors = actual.hits.map(hit => Math.abs(hit.score - scoreMap.get(hit.id)));
  const bounded = await searchPrecisionPrecomputedBounded({ index: INDEX, query: item.query, limit: 20 });
  const topIds = new Set(reference.hits.slice(0, 20).map(hit => hit.id));
  const row = { ...item, documents: actual.hits.length, maximumScoreError: Math.max(...errors), meanScoreError: errors.reduce((a, b) => a + b, 0) / errors.length, statedScoreErrorBound: bound, violations: errors.filter(e => e > bound).length, top20IdOverlap: actual.hits.slice(0, 20).filter(hit => topIds.has(hit.id)).length, completeOrderEqual: actual.hits.every((hit, i) => hit.id === reference.hits[i]?.id), boundedOwnObjectiveParity: JSON.stringify(bounded.hits) === JSON.stringify(actual.hits.slice(0, 20)) };
  if (row.documents !== 545 || row.violations || !row.boundedOwnObjectiveParity) throw new Error(`Precomputed parity failure: ${JSON.stringify(row)}`);
  results.push(row);
}
const latency = {};
const methods = { typed: buildPrecisionTypedQuery, precomputed: buildPrecisionPrecomputedQuery };
for (const [name, build] of Object.entries(methods)) {
  for (const item of queryCases.slice(0, 4)) for (let i = 0; i < 3; i++) await searchIndex(INDEX, build({ query: item.query, limit: 20 }));
  latency[name] = [];
}
// Alternate methods to reduce ordering bias from a slowly changing service load.
for (let repeat = 0; repeat < 30; repeat++) for (const name of repeat % 2 ? ['precomputed', 'typed'] : ['typed', 'precomputed']) {
  const item = queryCases[repeat % 4], started = performance.now();
  const response = await searchIndex(INDEX, methods[name]({ query: item.query, limit: 20 }));
  latency[name].push({ query: item.id, elapsedMs: performance.now() - started, serviceTookMs: response.evidence.serviceTookMs });
}
const percentile = (array, p) => [...array].sort((a, b) => a - b)[Math.ceil(p * array.length) - 1];
const summary = Object.fromEntries(Object.entries(latency).map(([name, samples]) => [name, { p50Ms: percentile(samples.map(x => x.elapsedMs), 0.5), p95Ms: percentile(samples.map(x => x.elapsedMs), 0.95), meanServiceMs: samples.reduce((sum, x) => sum + x.serviceTookMs, 0) / samples.length }]));
const result = { createdAt: new Date().toISOString(), index: INDEX, sourceHashes: Object.fromEntries(await Promise.all(['methods-precision-precomputed.mjs', 'methods-precision-typed.mjs', 'precision-precomputed-probe.mjs'].map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))]))), coordinateDistanceErrorBound: LAB_ERROR, cases: results, latency, summary, caveat: '545 assets and one client; this tests representation and relative query cost, not million-document scalability.' };
const filename = path.join(STORE, `precision-precomputed-probe-${result.createdAt.replaceAll(':', '-')}.json`);
await writeFile(filename, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: filename, cases: results, summary }));
