// THROWAWAY PROTOTYPE: alternate pixel membership curves on unchanged anchors.
import { OVERLAP_DEFINITION, OVERLAP_REGIONS, regionFields } from './overlap-regions.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';

export const CUTOFF_REFERENCE_RADIUS = .24;
export const CUTOFF_LEVELS = Object.freeze([0, .25, .5, .75, .9].map(cutoff => Object.freeze({
  id: 'q' + String(Math.round(cutoff * 100)).padStart(2, '0'), cutoff,
  radius: CUTOFF_REFERENCE_RADIUS * (1 - cutoff), label: `${Math.round(cutoff * 100)}%`,
})));
export const CUTOFF_KERNELS = Object.freeze(['hard', 'feather', 'core-halo']);
export const CUTOFF_PROFILES = Object.freeze([
  { id: 'hard', label: 'Hard cutoff', description: 'Every pixel inside the selected support counts fully.' },
  { id: 'feather', label: 'Feathered cutoff', description: 'Pixel weight grows linearly from zero at the cutoff to one at the center.' },
  { id: 'core-halo', label: 'Full core, soft halo', description: 'The inner half-radius counts fully; the outer half fades to zero.' },
  { id: 'consensus', label: 'Multiple cutoffs', description: 'Blend this cutoff and the next two stricter cutoffs with 20%, 30%, and 50% score weights.' },
].map(Object.freeze));

export function cutoffLevel(cutoff = .5) {
  const level = CUTOFF_LEVELS.find(level => level.cutoff === cutoff);
  if (!level) throw Error('Pixel cutoff must be one of 0, 0.25, 0.5, 0.75, or 0.9.');
  return level;
}
export function cutoffComponents(profile = 'hard', cutoff = .5) {
  const level = cutoffLevel(cutoff);
  if (!CUTOFF_PROFILES.some(candidate => candidate.id === profile)) throw Error('Unknown pixel membership profile.');
  if (profile !== 'consensus') return [{ kernel: profile, cutoff, weight: 1 }];
  const first = CUTOFF_LEVELS.indexOf(level), combined = new Map();
  [.2, .3, .5].forEach((weight, offset) => {
    const selected = CUTOFF_LEVELS[Math.min(CUTOFF_LEVELS.length - 1, first + offset)].cutoff;
    combined.set(selected, (combined.get(selected) ?? 0) + weight);
  });
  return [...combined].map(([selected, weight]) => ({ kernel: 'hard', cutoff: selected, weight }));
}
export function cutoffFields(regionIndex, kernel, cutoff = .5) {
  regionFields(regionIndex);
  if (!CUTOFF_KERNELS.includes(kernel)) throw Error('Fields require a stored membership kernel.');
  const suffix = `${OVERLAP_REGIONS[regionIndex].key}_${kernel.replace('-', '_')}_${cutoffLevel(cutoff).id}`;
  return { coverage: 'cov_' + suffix, quality: 'quality_' + suffix };
}
export function cutoffIndexForCount(bucketCount = 1024) {
  overlapRegionsForCount(bucketCount);
  return `color-exploration-cutoff-${bucketCount}-real-v1`;
}
export function cutoffWeight(distance, kernel = 'hard', cutoff = .5) {
  const { radius } = cutoffLevel(cutoff);
  if (!Number.isFinite(distance) || distance < 0) throw Error('Expected a finite nonnegative OKLab distance.');
  if (!CUTOFF_KERNELS.includes(kernel)) throw Error('Unknown stored membership kernel.');
  const normalized = distance / radius;
  if (normalized > 1 + 1e-12) return 0;
  if (kernel === 'hard') return 1;
  const fraction = Math.max(0, 1 - Math.min(1, normalized));
  return kernel === 'feather' ? fraction : Math.min(1, fraction * 2);
}
export function cutoffMembership(lab, region, { profile = 'hard', cutoff = .5 } = {}) {
  if (!Array.isArray(lab) || lab.length !== 3 || !lab.every(Number.isFinite)) throw Error('Expected finite OKLab color.');
  const distance = Math.hypot(...lab.map((value, index) => value - region.lab[index]));
  const referenceQuality = Math.max(0, 1 - distance / CUTOFF_REFERENCE_RADIUS);
  let weight = 0, weightedQuality = 0, area = 0;
  for (const component of cutoffComponents(profile, cutoff)) {
    const current = cutoffWeight(distance, component.kernel, component.cutoff);
    const support = cutoffWeight(distance, 'hard', component.cutoff);
    const quality = support ? Math.max(component.cutoff, referenceQuality) : 0;
    weight += component.weight * current;
    weightedQuality += component.weight * current * quality;
    area += component.weight * support;
  }
  return { area, quality: weight ? weightedQuality / weight : 0, weight, distance, referenceQuality };
}
export function cutoffDefinition({ bucketCount = 1024, profile = 'hard', cutoff = .5 } = {}) {
  overlapRegionsForCount(bucketCount);
  const components = cutoffComponents(profile, cutoff);
  return {
    ...OVERLAP_DEFINITION, version: 1, anchorCount: bucketCount,
    radius: cutoffLevel(cutoff).radius, edgeWeight: cutoff, referenceRadius: CUTOFF_REFERENCE_RADIUS,
    profile, cutoff, components, levels: CUTOFF_LEVELS,
    referenceQuality: 'q = max(0, 1 - OKLab distance / 0.24). Each level has explicit bounded support; q=0 does not accept arbitrarily distant colors.',
    coverage: 'Weighted sampled pixel mass, rounded to integer basis points. Hard coverage is physical area; smooth profiles use effective area.',
    quality: 'Float32 conditional mean of reference quality weighted by membership. Zero when weighted mass is zero.',
    precision: 'Picked colors use the nearest unchanged anchor. Membership levels and kernels are measured offline; queries select or blend indexed measurements.',
  };
}
