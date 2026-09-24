// Exact global precision search using conservative indexed palette-cell bounds.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { rgbToLab } from './corpus-colors.mjs';
import { interpretQuery } from './query.mjs';
import { buildQuery } from './methods.mjs';
import { buildDirectPaletteQuery } from './methods-direct-palette.mjs';
import { STORE, searchIndex } from './service.mjs';

export const PALETTE_BOUNDED_METHOD = Object.freeze({
  id: 'palette-precision-bounded', label: 'Direct precision with exact indexed palette-cell bounds',
  family: 'palette-bounded', representation: 'palette32-direct', approximate: false, searchKind: 'palette-bounded',
  requiredFields: ['palette32_packed', 'palette_total', 'palette_cells'],
  limitations: [
    'Only one picked-hex vibe target with an OKLab radius is supported.',
    'ANN proposes a seed; conservative cell bounds preserve every possible global winner for the final exact service query.',
    'The 32-color palette is still lossy, and weak bounds can require an exhaustive final score.',
    'Multiple service searches assume a stable index; production requires a consistent versioned search view/PIT.',
  ],
});
export const BOUNDS_FILENAME = path.join(STORE, 'palette-cell-bounds-v1.json');
const sourceHash = () => createHash('sha256').update(rgbToLab.toString()).digest('hex');

export function paletteCellIds(feature) {
  return [...new Set(feature.palette32_packed.map(packed => {
    const rgb = Math.floor(packed / 65536);
    return (rgb >> 20) * 256 + ((rgb >> 12) & 15) * 16 + ((rgb >> 4) & 15);
  }))];
}

export async function prepareCellBounds(filename = BOUNDS_FILENAME) {
  try { return validateBounds(JSON.parse(await readFile(filename, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const started = performance.now();
  const margin = 2e-6;
  const minima = new Float64Array(4096 * 3).fill(Infinity);
  const maxima = new Float64Array(4096 * 3).fill(-Infinity);
  const counts = new Uint32Array(4096);
  const linear = Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  for (let r = 0; r < 256; r++) {
    const rr = linear[r];
    for (let g = 0; g < 256; g++) {
      const gg = linear[g];
      for (let b = 0; b < 256; b++) {
        const bb = linear[b];
        const l = Math.cbrt(0.4122214708 * rr + 0.5363325363 * gg + 0.0514459929 * bb);
        const m = Math.cbrt(0.2119034982 * rr + 0.6806995451 * gg + 0.1073969566 * bb);
        const s = Math.cbrt(0.0883024619 * rr + 0.2817188376 * gg + 0.6299787005 * bb);
        const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
        const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
        const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
        const cell = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4), offset = cell * 3;
        minima[offset] = Math.min(minima[offset], L); maxima[offset] = Math.max(maxima[offset], L);
        minima[offset + 1] = Math.min(minima[offset + 1], a); maxima[offset + 1] = Math.max(maxima[offset + 1], a);
        minima[offset + 2] = Math.min(minima[offset + 2], labB); maxima[offset + 2] = Math.max(maxima[offset + 2], labB);
        counts[cell]++;
      }
    }
    if (r % 32 === 31) console.log(JSON.stringify({ phase: 'exhaustive-palette-cell-bounds', rgbPoints: (r + 1) * 65536, total: 16777216 }));
  }
  const result = { schemaVersion: 1, createdAt: new Date().toISOString(), rgbPoints: 16777216,
    cellCount: 4096, pointsPerCell: 4096, numericMargin: margin, colorTransformHash: sourceHash(),
    description: 'Coordinate extrema over every RGB8 point in each 16x16x16 RGB cell, padded outward for floating arithmetic; no corner-only approximation.',
    elapsedMs: performance.now() - started,
    cells: Array.from({ length: 4096 }, (_, cell) => ({ cell, count: counts[cell], min: Array.from(minima.slice(cell * 3, cell * 3 + 3), v => v - margin), max: Array.from(maxima.slice(cell * 3, cell * 3 + 3), v => v + margin) })),
  };
  validateBounds(result);
  await mkdir(path.dirname(filename), { recursive: true });
  // Fail if another run created the supposedly immutable bounds during computation.
  await writeFile(filename, JSON.stringify(result), { flag: 'wx' });
  return result;
}

export function validateBounds(bounds) {
  if (bounds.schemaVersion !== 1 || bounds.rgbPoints !== 16777216 || bounds.cellCount !== 4096 || bounds.cells?.length !== 4096 || bounds.colorTransformHash !== sourceHash()) throw new Error('Palette-cell bounds are incomplete or use a different color transform.');
  for (let i = 0; i < bounds.cells.length; i++) {
    const cell = bounds.cells[i];
    if (cell.cell !== i || cell.count !== 4096 || cell.min?.length !== 3 || cell.max?.length !== 3 || cell.min.some((value, axis) => !Number.isFinite(value) || !Number.isFinite(cell.max[axis]) || value > cell.max[axis])) throw new Error('Invalid palette-cell extent');
  }
  return bounds;
}
let boundsPromise;
async function loadBounds() {
  boundsPromise ??= readFile(BOUNDS_FILENAME, 'utf8').then(text => validateBounds(JSON.parse(text)));
  return boundsPromise;
}

export function supportsPaletteBounded(query) {
  const compiled = interpretQuery(query);
  if (!compiled.supported) return compiled;
  if (compiled.mode !== 'vibe' || compiled.targets.length !== 1 || compiled.targets[0].name || compiled.targets[0].ranges.length !== 1 || compiled.targets[0].ranges[0].space !== 'oklab') return { supported: false, reason: 'Exact palette-cell precision bounds support one picked hex in vibe mode with an OKLab radius only.' };
  return { supported: true, compiled, warnings: PALETTE_BOUNDED_METHOD.limitations };
}

export function winningCells({ bounds, target, threshold }) {
  if (!(threshold > 0)) return { cells: null, lowerScore: 0, distanceBound: null };
  const lowerScore = Math.max(0, threshold - 2e-6);
  if (!lowerScore) return { cells: null, lowerScore, distanceBound: null };
  const radius = target.ranges[0].distance;
  const radiusFraction = target.edgeWeight >= 1 ? 1 : Math.min(1, Math.max(0, (1 - lowerScore) / (1 - target.edgeWeight)));
  const distanceBound = radius * radiusFraction + bounds.numericMargin * 2;
  const cells = bounds.cells.filter(cell => {
    let squared = 0;
    for (let axis = 0; axis < 3; axis++) {
      const gap = Math.max(0, cell.min[axis] - target.lab[axis], target.lab[axis] - cell.max[axis]);
      squared += gap * gap;
    }
    return squared <= distanceBound * distanceBound;
  }).map(cell => cell.cell);
  return { cells, lowerScore, distanceBound };
}

export async function searchPaletteBounded({ index, seedIndex = index, query, limit = 20, eligibleIds, excludedIds, filter, parameters = {}, signal, bounds, search = searchIndex, buildExactQuery = buildDirectPaletteQuery }) {
  const check = supportsPaletteBounded(query);
  if (!check.supported) throw new Error(check.reason);
  const compiled = check.compiled;
  const seedLimit = Math.min(10000, Math.max(limit, parameters.seedLimit ?? 100));
  const base = { method: 'palette-direct-precision', query, limit, eligibleIds, excludedIds, filter, parameters };
  const target = compiled.targets[0];
  const seedQuery = { swatchHex: target.color, ...(compiled.subject ? { subjectRequest: compiled.subject } : {}) };
  const seed = await search(seedIndex, buildQuery({ method: parameters.seedMethod ?? 'rgb-cosine-ann', query: seedQuery, limit: seedLimit, eligibleIds, excludedIds, filter, parameters: { k: seedLimit } }), { signal });
  let scoredSeed = { hits: [], evidence: {} };
  if (seed.hits.length) {
    const seedFilter = [...(filter ? Array.isArray(filter) ? filter : [filter] : []), { ids: { values: seed.hits.map(hit => hit.id) } }];
    scoredSeed = await search(index, buildExactQuery({ ...base, filter: seedFilter }), { signal });
  }
  // ANN underfill cannot establish that all eligible documents were seen.
  const threshold = scoredSeed.hits.length >= limit ? scoredSeed.hits[limit - 1].score : 0;
  const loadedBounds = bounds ?? await loadBounds();
  const bound = winningCells({ bounds: loadedBounds, target, threshold });
  if (bound.cells?.length === 0) throw new Error('Positive seed score has no conservatively eligible palette cells.');
  const finalFilter = [...(filter ? Array.isArray(filter) ? filter : [filter] : []), ...(bound.cells && bound.cells.length < 4096 ? [{ terms: { palette_cells: bound.cells } }] : [])];
  const result = await search(index, buildExactQuery({ ...base, filter: finalFilter }), { signal });
  if (result.hits.length < Math.min(limit, scoredSeed.hits.length)) throw new Error('Bounded query lost seed winners; verify palette_cells index coverage and stable index state.');
  return { ...result, evidence: { ...result.evidence, strategy: 'exact-global-palette-cell-bounds', finalGloballyEligible: true, serviceSearches: seed.hits.length ? 3 : 2,
    seedIndex, seedCount: seed.hits.length, threshold, lowerScore: bound.lowerScore, distanceBound: bound.distanceBound,
    eligibleCellCount: bound.cells?.length ?? 4096, boundsColorTransformHash: loadedBounds.colorTransformHash,
    seedServiceTookMs: seed.evidence?.serviceTookMs, exactSeedServiceTookMs: scoredSeed.evidence?.serviceTookMs,
    guarantee: 'Any image that can tie or beat the seed kth score has a centroid at least that good; its RGB cell passes a conservative OKLab box-distance test. The final OpenSearch query searches every such image.',
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--prepare-bounds')) {
  const result = await prepareCellBounds();
  console.log(JSON.stringify({ output: BOUNDS_FILENAME, elapsedMs: result.elapsedMs, cells: result.cellCount, rgbPoints: result.rgbPoints }));
}
