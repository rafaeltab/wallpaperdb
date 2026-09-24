// THROWAWAY PROTOTYPE: independent overlapping neighborhoods, not a partition.
import { NAMED_COLORS, rgbToLab } from './corpus-colors.mjs';

export const OVERLAP_DEFINITION = Object.freeze({
  version: 1, anchorCount: 1024, radius: .12, edgeWeight: .5, sampleSize: 128,
  colorSpace: 'Euclidean OKLab from sRGB',
  anchors: 'Eight RGB cube corners and unique named-color seeds, then deterministic farthest-point selection from a 17³ sRGB grid.',
  coverage: 'Fraction of sampled pixels at OKLab distance <= 0.12; integer basis points (0..10000).',
  quality: 'Conditional mean of 1 - 0.5 * distance / 0.12 among matching pixels, float32; zero when none match.',
  overlap: 'Each pixel independently contributes to every matching region. Areas are marginal and must not be summed as union coverage.',
  preprocessing: 'Sharp auto-orientation, sRGB conversion, alpha retained, 128x128 fill resize, then RGB rounded after alpha compositing onto black.',
  precision: 'Picked colors use the nearest indexed anchor. Binary support and edge-quality behavior are fixed at indexing time.',
});

const hexFor = rgb => '#' + rgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
const rgbFor = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
const distanceSquared = (left, right) => (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2;

function buildRegions() {
  const candidates = [], seen = new Set();
  const add = rgb => {
    const hex = hexFor(rgb);
    if (seen.has(hex)) return;
    seen.add(hex);
    // The candidate grid uses exact RGB8 values, so displayed hexadecimal anchors are exact.
    const exactRgb = rgbFor(hex);
    candidates.push({ hex, rgb: exactRgb, lab: rgbToLab(exactRgb) });
  };
  for (const r of [0, 1]) for (const g of [0, 1]) for (const b of [0, 1]) add([r, g, b]);
  for (const hex of Object.values(NAMED_COLORS)) add(rgbFor(hex));
  const seedCount = candidates.length;
  for (let r = 0; r <= 16; r++) for (let g = 0; g <= 16; g++) for (let b = 0; b <= 16; b++) add([r / 16, g / 16, b / 16]);
  const minimum = new Float64Array(candidates.length).fill(Infinity), selected = new Uint8Array(candidates.length), indexes = [];
  const select = index => {
    indexes.push(index); selected[index] = 1;
    for (let candidate = 0; candidate < candidates.length; candidate++) {
      const distance = distanceSquared(candidates[index].lab, candidates[candidate].lab);
      if (distance < minimum[candidate]) minimum[candidate] = distance;
    }
  };
  for (let index = 0; index < seedCount; index++) select(index);
  while (indexes.length < OVERLAP_DEFINITION.anchorCount) {
    let farthest = -1, distance = -1;
    for (let index = 0; index < candidates.length; index++) if (!selected[index] && minimum[index] > distance) { farthest = index; distance = minimum[index]; }
    select(farthest);
  }
  return Object.freeze(indexes.map((candidate, index) => Object.freeze({ index, key: 'o' + String(index).padStart(4, '0'), ...candidates[candidate], rgb: Object.freeze(candidates[candidate].rgb), lab: Object.freeze(candidates[candidate].lab) })));
}

export const OVERLAP_REGIONS = buildRegions();
export function regionFields(index) {
  if (!Number.isInteger(index) || index < 0 || index >= OVERLAP_REGIONS.length) throw Error('Invalid overlap region index');
  const key = OVERLAP_REGIONS[index].key;
  return { coverage: 'cov_' + key, quality: 'quality_' + key };
}
export function nearestOverlapRegion(lab) {
  if (!Array.isArray(lab) || lab.length !== 3 || !lab.every(Number.isFinite)) throw Error('Expected finite OKLab color');
  let nearest = OVERLAP_REGIONS[0], minimum = Infinity;
  for (const region of OVERLAP_REGIONS) {
    const distance = distanceSquared(lab, region.lab);
    if (distance < minimum) { minimum = distance; nearest = region; }
  }
  return nearest;
}
export function overlapMembership(lab, region) {
  const normalized = Math.sqrt(distanceSquared(lab, region.lab)) / OVERLAP_DEFINITION.radius;
  return normalized <= 1 + 1e-12 ? { area: 1, quality: 1 - (1 - OVERLAP_DEFINITION.edgeWeight) * Math.min(1, normalized) } : { area: 0, quality: 0 };
}
