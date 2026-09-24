// Execution-only assessment; all rankings and scores come from OpenSearch.
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { INDEX, STORE, searchIndex, hash } from './service.mjs';
import { buildPrecisionPrecomputedQuery, PRECISION_PRECOMPUTED_SCRIPT } from './methods-precision-precomputed.mjs';

const cachedPrefix = `def paletteLW = doc['palette_lab_lw'];\ndef paletteAB = doc['palette_lab_ab'];\ndef originalPalette = doc['palette32_packed'];\n`;
const repeatedSource = PRECISION_PRECOMPUTED_SCRIPT.startsWith(cachedPrefix)
  ? PRECISION_PRECOMPUTED_SCRIPT.slice(cachedPrefix.length).replaceAll('paletteLW', "doc['palette_lab_lw']").replaceAll('paletteAB', "doc['palette_lab_ab']").replaceAll('originalPalette', "doc['palette32_packed']")
  : PRECISION_PRECOMPUTED_SCRIPT;
const cachedSource = cachedPrefix + repeatedSource.replaceAll("doc['palette_lab_lw']", 'paletteLW').replaceAll("doc['palette_lab_ab']", 'paletteAB').replaceAll("doc['palette32_packed']", 'originalPalette');
const queries = ['#ff2200', '#4c8c72', '#808080', '#080808', '#dd6600', '#8030b0', '#20b8d0'].map(swatchHex => ({ swatchHex }));
queries.push({ mode: 'vibe', targets: [{ color: '#ff2200', space: 'oklab', tolerance: { distance: 0 }, edgeWeight: 0.5 }] });
queries.push({ mode: 'vibe', targets: [{ color: '#4c8c72', space: 'oklab', tolerance: { distance: 0.2 }, edgeWeight: 1 }] });
const request = (query, cached, limit = 20) => {
  const body = buildPrecisionPrecomputedQuery({ query, limit });
  body.query.script_score.script.source = cached ? cachedSource : repeatedSource;
  return body;
};
const parity = [];
for (const query of queries) {
  const reference = await searchIndex(INDEX, request(query, false, 1000));
  const cached = await searchIndex(INDEX, request(query, true, 1000));
  if (JSON.stringify(reference.hits) !== JSON.stringify(cached.hits)) throw new Error('Cached doc-value scorer changed scores/order');
  parity.push({ query, identicalScoresAndOrder: true, documents: reference.hits.length });
}
for (const query of queries.slice(0, 7)) for (const cached of [false, true]) for (let i = 0; i < 3; i++) await searchIndex(INDEX, request(query, cached));
const latency = { repeatedLookup: [], cachedLists: [] };
for (let repeat = 0; repeat < 105; repeat++) for (const cached of repeat % 2 ? [true, false] : [false, true]) {
  const query = queries[repeat % 7], started = performance.now();
  const response = await searchIndex(INDEX, request(query, cached));
  latency[cached ? 'cachedLists' : 'repeatedLookup'].push({ query: query.swatchHex, elapsedMs: performance.now() - started, serviceTookMs: response.evidence.serviceTookMs });
}
const percentile = (array, p) => [...array].sort((a, b) => a - b)[Math.ceil(p * array.length) - 1];
const summary = Object.fromEntries(Object.entries(latency).map(([name, samples]) => [name, { count: samples.length, p50Ms: percentile(samples.map(s => s.elapsedMs), 0.5), p95Ms: percentile(samples.map(s => s.elapsedMs), 0.95), meanServiceMs: samples.reduce((a, s) => a + s.serviceTookMs, 0) / samples.length, meanWallMs: samples.reduce((a, s) => a + s.elapsedMs, 0) / samples.length }]));
const result = { createdAt: new Date().toISOString(), index: INDEX, baselineModuleHash: hash(await readFile(new URL('./methods-precision-precomputed.mjs', import.meta.url))), baselineScriptHash: hash(repeatedSource), cachedScriptHash: hash(cachedSource), baselineScript: repeatedSource, cachedScript: cachedSource, parity, latency, summary, caveat: '545 assets, seven varied timed queries, alternating one client; execution-only comparison, not million-document evidence.' };
const filename = path.join(STORE, `precision-docvalues-cache-probe-${result.createdAt.replaceAll(':', '-')}.json`);
await writeFile(filename, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: filename, parityCases: parity.length, scoreComparisons: parity.reduce((sum, p) => sum + p.documents, 0), summary, baselineScriptHash: result.baselineScriptHash, cachedScriptHash: result.cachedScriptHash }));
