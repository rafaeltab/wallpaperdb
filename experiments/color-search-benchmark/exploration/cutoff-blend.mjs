// Query-only blends of unchanged indexed measurements. Keep extraction geometry frozen.
import { CUTOFF_LEVELS, CUTOFF_PROFILES, CUTOFF_REFERENCE_RADIUS, cutoffComponents, cutoffDefinition, cutoffMembership, cutoffWeight } from './cutoff-definition.mjs';

export const CUTOFF_QUERY_PROFILES = Object.freeze([...CUTOFF_PROFILES, Object.freeze({
  id: 'all-levels', label: 'All cutoffs',
  description: 'Blend all five hard cutoffs. Equal weights at zero; increasing the distribution exponent favors stricter cutoffs while retaining every level.',
})]);

export function cutoffQueryComponents(profile = 'hard', cutoff = .5, cutoffBlendExponent = 0) {
  if (profile !== 'all-levels') return cutoffComponents(profile, cutoff);
  if (!Number.isFinite(cutoffBlendExponent) || cutoffBlendExponent < 0 || cutoffBlendExponent > 6) throw Error('cutoffBlendExponent must be between 0 and 6.');
  const maximumCutoff = CUTOFF_LEVELS.at(-1).cutoff;
  const weights = CUTOFF_LEVELS.map(level => Math.exp(cutoffBlendExponent * (level.cutoff / maximumCutoff - 1)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return CUTOFF_LEVELS.map((level, i) => ({ kernel: 'hard', cutoff: level.cutoff, weight: weights[i] / total }));
}

export function cutoffQueryDefinition(options = {}) {
  if (options.profile !== 'all-levels') return cutoffDefinition(options);
  const { bucketCount = 1024, cutoffBlendExponent = 0 } = options;
  const components = cutoffQueryComponents('all-levels', 0, cutoffBlendExponent);
  return { ...cutoffDefinition({ bucketCount, profile: 'hard', cutoff: 0 }), profile: 'all-levels', cutoffBlendExponent, components,
    coverage: 'Each component stores literal physical area. Blended coverage is a display summary; component scores are computed independently.',
    blend: 'Every stored cutoff contributes with normalized exp(cutoffBlendExponent × (cutoff / 0.9 − 1)) weights. The minimum average quality gate can still zero individual score terms.',
  };
}

export function cutoffQueryMembership(lab, region, options = {}) {
  if (options.profile !== 'all-levels') return cutoffMembership(lab, region, options);
  if (!Array.isArray(lab) || lab.length !== 3 || !lab.every(Number.isFinite)) throw Error('Expected finite OKLab color.');
  const distance = Math.hypot(...lab.map((value, index) => value - region.lab[index]));
  const referenceQuality = Math.max(0, 1 - distance / CUTOFF_REFERENCE_RADIUS);
  let weight = 0, weightedQuality = 0;
  for (const component of cutoffQueryComponents('all-levels', 0, options.cutoffBlendExponent)) {
    const support = cutoffWeight(distance, 'hard', component.cutoff);
    const componentWeight = component.weight * support;
    weight += componentWeight;
    weightedQuality += componentWeight * Math.max(component.cutoff, referenceQuality);
  }
  return { area: weight, quality: weight ? weightedQuality / weight : 0, weight, distance, referenceQuality };
}
