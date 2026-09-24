// Offline selectivity diagnostic, not a runtime search implementation.
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadFeatures, STORE, INDEX, api, hash, searchIndex } from './service.mjs';
import { interpretQuery, membership } from './query.mjs';
import { prepareCellBounds, winningCells } from './methods-palette-bounded.mjs';
import { searchPrecisionTypedBounded } from './methods-precision-typed.mjs';
import { RANK_FEATURE_INDEX } from './rank-features-index.mjs';
import { WORKLOAD } from './workload.mjs';

const features = await loadFeatures(), bounds = await prepareCellBounds(), support = 0.05;
const queries = WORKLOAD.filter(item => item.query.swatchHex);
queries.push({ id: 'broad-muted-green-radius040', query: { mode: 'vibe', targets: [{ color: '#4c8c72', space: 'oklab', tolerance: { distance: 0.4 }, edgeWeight: 0.5 }] } });
const cellOf = rgb => (rgb >> 20) * 256 + ((rgb >> 12) & 15) * 16 + ((rgb >> 4) & 15);
const roundedUpCount = count => {
  const step = 2 ** Math.max(0, Math.floor(Math.log2(count)) - 8);
  return Math.ceil(count / step) * step;
};
const documents = features.map(feature => {
  const cells = new Map(), palette = feature.palette32_packed.map(packed => {
    const rgb = Math.floor(packed / 65536), count = packed % 65536, cell = cellOf(rgb);
    cells.set(cell, (cells.get(cell) ?? 0) + count);
    return { rgb: [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255], mass: count / feature.palette_total };
  });
  return { id: feature.id, palette, cells: [...cells].map(([cell, count]) => ({ cell, mass: count / feature.palette_total, upperMass: roundedUpCount(count) / feature.palette_total })) };
});
const rows = [];
for (const item of queries) {
  const target = interpretQuery(item.query).targets[0], radius = target.ranges[0].distance;
  const qualityUpper = bounds.cells.map(cell => {
    const distance = Math.hypot(...cell.min.map((low, axis) => Math.max(0, low - target.lab[axis], target.lab[axis] - cell.max[axis])));
    if (distance > radius + 1e-8) return 0;
    return radius > 0 ? 1 - (1 - target.edgeWeight) * Math.min(1, distance / radius) : 1;
  });
  const evaluated = documents.map(doc => {
    let area = 0, mass = 0;
    for (const centroid of doc.palette) {
      const match = membership(centroid.rgb, target);
      area += centroid.mass * match.area;
      mass += centroid.mass * match.quality;
    }
    const upper = doc.cells.reduce((sum, entry) => sum + entry.upperMass * qualityUpper[entry.cell], 0);
    if (![area, mass, upper].every(Number.isFinite)) throw new Error('Nonfinite diagnostic membership');
    if (upper + 1e-12 < mass) throw new Error('Cell mass upper bound underestimates actual quality mass');
    return { id: doc.id, cells: doc.cells, mass, upper, score: area > 0 ? mass / Math.max(area, support) : 0 };
  });
  const seed = await searchPrecisionTypedBounded({ index: INDEX, query: item.query, limit: 20 });
  // Sorting is confined to this offline reference diagnostic, never a query path.
  const ideal = [...evaluated].sort((a, b) => b.score - a.score)[19].score;
  const assess = threshold => {
    const existence = new Set(winningCells({ bounds, target, threshold }).cells ?? bounds.cells.map(c => c.cell));
    const minimumMass = Math.max(0, (threshold - 2e-6) * support - 2e-6);
    let exists = 0, massOnly = 0, combined = 0, idealMassCombined = 0, winners = 0, lostWinners = 0;
    for (const doc of evaluated) {
      const survivesExistence = doc.cells.some(entry => existence.has(entry.cell));
      const survivesMass = doc.upper >= minimumMass;
      if (survivesExistence) exists++;
      if (survivesMass) massOnly++;
      if (survivesExistence && survivesMass) combined++;
      if (survivesExistence && doc.mass >= minimumMass) idealMassCombined++;
      if (doc.score >= threshold - 2e-6) { winners++; if (!survivesExistence || !survivesMass) lostWinners++; }
    }
    if (lostWinners) throw new Error('A necessary-bound diagnostic lost a possible winner');
    return { threshold, minimumMass, existenceCells: existence.size, existenceSurvivors: exists, massOnlySurvivors: massOnly, combinedSurvivors: combined, reductionAmongExistence: exists ? (exists - combined) / exists : 0, idealExactMassCombinedSurvivors: idealMassCombined, winners, lostWinners };
  };
  rows.push({ id: item.id, query: item.query, fullRangeMassClauseCount: qualityUpper.filter(q => q > 0).length, actualSeed: assess(seed.evidence.threshold), idealTop20Threshold: assess(ideal) });
}

// Read-only feasibility probe on the existing rank-feature index: a gate must
// reject a low-feature document before the outer script can execute for it.
const rankQuery = { rank_feature: { field: 'utilities.vibe_red', linear: {} } };
const originals = await searchIndex(RANK_FEATURE_INDEX, { size: 1000, _source: false, query: rankQuery, sort: [{ _score: 'desc' }, { id: 'asc' }] });
const cutoff = originals.hits[19].score, rejected = originals.hits.find(hit => hit.score < cutoff)?.id;
if (!rejected) throw new Error('Feasibility probe needs a below-cutoff document');
const guardedScript = { lang: 'painless', source: "if (doc['id'].value.equals(params.rejected)) throw new IllegalStateException('mass_gate_probe_rejected_document'); return 1.0;", params: { rejected } };
const gate = { function_score: { query: rankQuery, min_score: cutoff } };
const guarded = await searchIndex(RANK_FEATURE_INDEX, { size: 1000, _source: false, track_total_hits: true, query: { script_score: { query: gate, script: guardedScript } }, sort: [{ _score: 'desc' }, { id: 'asc' }] });
const expected = originals.hits.filter(hit => hit.score >= cutoff).map(hit => hit.id).sort();
if (JSON.stringify(guarded.hits.map(hit => hit.id)) !== JSON.stringify(expected)) throw new Error('Native gate returned an unexpected set');
let controlThrew = false;
try { await api(`${RANK_FEATURE_INDEX}/_search`, { method: 'POST', body: { size: 1000, query: { script_score: { query: rankQuery, script: guardedScript } } } }); }
catch (error) { if (!error.message.includes('mass_gate_probe_rejected_document')) throw error; controlThrew = true; }
if (!controlThrew) throw new Error('Guard control did not execute its rejected-document branch');
const result = { createdAt: new Date().toISOString(), index: INDEX, documents: documents.length, sourceHash: hash(await readFile(new URL('./palette-mass-assessment.mjs', import.meta.url))), sourceFeaturesHash: hash(features), minimumSupport: support, rows, feasibilityProbe: { index: RANK_FEATURE_INDEX, cutoff, originalPositiveMatches: originals.hits.length, gatedMatches: guarded.hits.length, deliberatelyRejectedId: rejected, innerGatePreventedOuterScript: true, ungatedControlThrew: true }, limitations: ['Offline analytic mass bounds, not an implemented/indexed palette-mass query.', 'Only existing 545 assets; does not predict million-document selectivity or timings.', 'Native boost/product/sum rounding requires conservative handling in an implementation.', 'OpenSearch 2.11 function_score creates the inner scorer with COMPLETE, losing competitive top-k block skipping.'] };
const filename = path.join(STORE, `palette-mass-assessment-${result.createdAt.replaceAll(':', '-')}.json`);
await writeFile(filename, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: filename, rows, feasibilityProbe: result.feasibilityProbe }));
