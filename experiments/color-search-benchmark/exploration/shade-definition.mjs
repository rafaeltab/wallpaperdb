// THROWAWAY PROTOTYPE: directional shade tolerance; new measurements, unchanged anchors.
import { CUTOFF_REFERENCE_RADIUS, cutoffLevel } from './cutoff-definition.mjs';
import { cutoffQueryComponents, cutoffQueryDefinition } from './cutoff-blend.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';

export const SHADE_METRIC = Object.freeze({
  version: 1, lightnessWeight: .25, chromaticNormalization: .5,
  relativeChromaTransition: Object.freeze([.03, .12]),
  visibilityLightnessTransition: Object.freeze([.08, .24]), epsilon: 1e-6,
});
const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const validLab = lab => Array.isArray(lab) && lab.length === 3 && lab.every(Number.isFinite);

// Shared allocation-light path for offline extraction. The public pair API validates inputs.
export function shadeCoordinates(lab) {
  const [l, a, b] = lab, divisor = Math.max(l, SHADE_METRIC.epsilon);
  const relativeA = a / divisor, relativeB = b / divisor;
  const strength = smoothstep((Math.hypot(relativeA, relativeB) - .03) / .09);
  return { l, a, b, relativeA, relativeB, strength,
    lightnessWeight: 1 - .75 * strength, beta: .5 * strength,
    visibility: smoothstep((l - .08) / .16) };
}
export function shadeQualityForCoordinates(pixel, anchor) {
  const dl = pixel.l - anchor.l, da = pixel.a - anchor.a, db = pixel.b - anchor.b;
  let distance;
  if (anchor.strength === 0) distance = Math.hypot(dl, da, db);
  else {
    const relativeA = anchor.l * (pixel.relativeA - anchor.relativeA);
    const relativeB = anchor.l * (pixel.relativeB - anchor.relativeB);
    distance = Math.sqrt((anchor.lightnessWeight * dl) ** 2 + (1 - anchor.beta) * (da * da + db * db)
      + anchor.beta * (relativeA * relativeA + relativeB * relativeB));
  }
  const relativeVisibility = anchor.visibility > 0 ? Math.min(1, pixel.visibility / anchor.visibility) : 1;
  const visibility = 1 - anchor.strength + anchor.strength * relativeVisibility;
  const referenceQuality = visibility * Math.max(0, 1 - distance / CUTOFF_REFERENCE_RADIUS);
  return { distance, referenceQuality, support: distance / CUTOFF_REFERENCE_RADIUS <= 1 + 1e-12 && visibility > 0,
    visibility, chromaticStrength: anchor.strength };
}
export function shadeReferenceQuality(lab, anchorLab) {
  if (!validLab(lab) || !validLab(anchorLab)) throw Error('Expected finite pixel and anchor OKLab colors.');
  return shadeQualityForCoordinates(shadeCoordinates(lab), shadeCoordinates(anchorLab));
}
export function shadeIndexForCount(bucketCount = 1024) {
  overlapRegionsForCount(bucketCount);
  return `color-exploration-shade-${bucketCount}-real-v1`;
}
function componentsFor({ profile = 'all-levels', cutoff = 0, cutoffBlendExponent = 0 } = {}) {
  if (profile !== 'all-levels' && profile !== 'hard') throw Error('Shade measurements support only hard or all-levels profiles.');
  cutoffLevel(cutoff);
  return cutoffQueryComponents(profile, cutoff, cutoffBlendExponent);
}
export function shadeDefinition(options = {}) {
  const { bucketCount = 1024, profile = 'all-levels', cutoff = 0, cutoffBlendExponent = 0 } = options;
  const components = componentsFor({ profile, cutoff, cutoffBlendExponent });
  return { ...cutoffQueryDefinition({ bucketCount, profile, cutoff, cutoffBlendExponent }), metric: 'shade-aware',
    metricParameters: SHADE_METRIC, components,
    colorSpace: 'Directional OKLab shade similarity with partial chromatic-ratio normalization',
    radius: null,
    referenceQuality: 'q = visibility × max(0, 1 - shade distance / 0.24). Chromatic anchors use L weight 0.25 and 50% relative-chroma normalization; neutral anchors preserve Euclidean OKLab. Smooth anchor and visibility transitions apply.',
    support: 'Each hard layer admits q >= cutoff inside finite distance support with nonzero visibility. A zero quality cutoff does not admit colors outside that support.',
    precision: 'Provisional shade tolerance, not a symmetric exact-color distance. Picked colors still choose the nearest unchanged anchor. Original precise-color metrics remain available.',
    coverage: 'Hard components store physical pixel area under the revised metric. Combined coverage is a display summary, not a union or the scoring input.',
  };
}
export function shadeMembership(lab, region, options = {}) {
  const result = shadeReferenceQuality(lab, region.lab);
  let weight = 0, weightedQuality = 0;
  for (const component of componentsFor(options)) {
    const admitted = result.support && result.referenceQuality + 1e-12 >= component.cutoff;
    if (!admitted) continue;
    weight += component.weight;
    weightedQuality += component.weight * Math.max(component.cutoff, result.referenceQuality);
  }
  return { ...result, area: weight, weight, quality: weight ? weightedQuality / weight : 0 };
}
