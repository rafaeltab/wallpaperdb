// THROWAWAY PROTOTYPE: nested subsets of the original measured anchor bank.
// Existing 1024-region geometry and field IDs are deliberately unchanged.
import { OVERLAP_DEFINITION, OVERLAP_REGIONS, nearestOverlapRegion } from './overlap-regions.mjs';

export const OVERLAP_BUCKET_COUNTS = Object.freeze([16, 64, 256, 1024]);
const distanceSquared = (left, right) => left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);

function validateCount(count) {
  if (!OVERLAP_BUCKET_COUNTS.includes(count)) throw Error('Overlap bucket count must be one of 16, 64, 256, or 1024.');
  return count;
}

function buildNestedRegions() {
  const minimum = new Float64Array(OVERLAP_REGIONS.length).fill(Infinity);
  const selected = new Set(), traversal = [];
  const select = index => {
    selected.add(index); traversal.push(OVERLAP_REGIONS[index]);
    for (const region of OVERLAP_REGIONS) minimum[region.index] = Math.min(minimum[region.index], distanceSquared(region.lab, OVERLAP_REGIONS[index].lab));
  };
  // The original bank starts with the eight RGB cube corners in RGB loop order.
  for (let index = 0; index < 8; index++) select(index);
  while (traversal.length < 256) {
    let farthest = -1, distance = -1;
    for (const region of OVERLAP_REGIONS) if (!selected.has(region.index) && minimum[region.index] > distance) {
      farthest = region.index; distance = minimum[region.index];
    }
    select(farthest);
  }
  return new Map(OVERLAP_BUCKET_COUNTS.map(count => [count, count === 1024 ? OVERLAP_REGIONS : Object.freeze(traversal.slice(0, count))]));
}

const banks = buildNestedRegions();
const definitions = new Map(OVERLAP_BUCKET_COUNTS.map(count => [count, count === 1024 ? OVERLAP_DEFINITION : Object.freeze({
  ...OVERLAP_DEFINITION, anchorCount: count,
  anchors: 'The original eight RGB cube corners, then deterministic farthest-point traversal of the original 1024 anchors; 16, 64 and 256 are nested prefixes. Original anchor IDs and fields are retained.',
  projection: 'Exact measured coverage and quality fields projected from the original immutable 1024-region corpus; radius, edge quality, preprocessing and scoring are unchanged.',
})]));

export function overlapRegionsForCount(count = 1024) { return banks.get(validateCount(count)); }
export function overlapDefinitionForCount(count = 1024) { return definitions.get(validateCount(count)); }
export function overlapIndexForCount(count = 1024) {
  validateCount(count);
  return count === 1024 ? 'color-exploration-overlap-real-v1' : `color-exploration-overlap-${count}-real-v1`;
}
export function nearestOverlapRegionForCount(lab, count = 1024) {
  validateCount(count);
  if (count === 1024) return nearestOverlapRegion(lab);
  if (!Array.isArray(lab) || lab.length !== 3 || !lab.every(Number.isFinite)) throw Error('Expected finite OKLab color');
  let nearest = banks.get(count)[0], minimum = Infinity;
  for (const region of banks.get(count)) {
    const distance = distanceSquared(lab, region.lab);
    if (distance < minimum) { minimum = distance; nearest = region; }
  }
  return nearest;
}
