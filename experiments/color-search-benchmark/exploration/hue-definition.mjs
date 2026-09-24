// THROWAWAY PROTOTYPE: preserve frozen shade tolerance, then require closer hue.
import { shadeCoordinates, shadeQualityForCoordinates, shadeDefinition } from './shade-definition.mjs';
import { cutoffQueryComponents } from './cutoff-blend.mjs';
import { cutoffLevel } from './cutoff-definition.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';

export const HUE_METRIC = Object.freeze({ version: 1, coreDegrees: 10, edgeDegrees: 30,
  transition: 'clamped smoothstep', nearNeutral: 'Blend gate by unchanged anchor chromatic strength', angleBoundaryTolerance: 1e-12 });
export function hueCoordinates(lab) {
  const coordinates = shadeCoordinates(lab);
  return { ...coordinates, chroma: Math.hypot(coordinates.a, coordinates.b) };
}
const validLab = lab => Array.isArray(lab) && lab.length === 3 && lab.every(Number.isFinite);
const smoothstep = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };

export function hueQualityForCoordinates(pixel, anchor) {
  const result = shadeQualityForCoordinates(pixel, anchor);
  // Hue is undefined for a neutral target. Preserve the old behavior exactly.
  if (anchor.strength === 0) { result.hueGate = 1; result.hueGapDegrees = null; return result; }
  const product = (pixel.chroma ?? Math.hypot(pixel.a, pixel.b)) * (anchor.chroma ?? Math.hypot(anchor.a, anchor.b));
  const cosine = product > 1e-14 ? Math.max(-1, Math.min(1, (pixel.a * anchor.a + pixel.b * anchor.b) / product)) : null;
  const hueGapDegrees = cosine === null ? null : Math.acos(cosine) * 180 / Math.PI;
  const hueWeight = hueGapDegrees === null || hueGapDegrees >= HUE_METRIC.edgeDegrees - HUE_METRIC.angleBoundaryTolerance ? 0
    : smoothstep((HUE_METRIC.edgeDegrees - hueGapDegrees) / (HUE_METRIC.edgeDegrees - HUE_METRIC.coreDegrees));
  const hueGate = 1 - anchor.strength + anchor.strength * hueWeight;
  // The frozen shade helper returns a fresh result; enrich it without another allocation per pixel/anchor pair.
  result.referenceQuality *= hueGate;
  result.support = result.support && hueGate > 0;
  result.hueGate = hueGate; result.hueGapDegrees = hueGapDegrees;
  return result;
}
export function hueReferenceQuality(lab, anchorLab) {
  if (!validLab(lab) || !validLab(anchorLab)) throw Error('Expected finite pixel and anchor OKLab colors.');
  return hueQualityForCoordinates(hueCoordinates(lab), hueCoordinates(anchorLab));
}
export function hueIndexForCount(bucketCount = 1024) {
  overlapRegionsForCount(bucketCount);
  return `color-exploration-shade-hue-${bucketCount}-real-v1`;
}
function componentsFor({ profile = 'all-levels', cutoff = 0, cutoffBlendExponent = 0 } = {}) {
  if (profile !== 'all-levels' && profile !== 'hard') throw Error('Hue measurements support only hard or all-levels profiles.');
  cutoffLevel(cutoff);
  return cutoffQueryComponents(profile, cutoff, cutoffBlendExponent);
}
export function hueDefinition(options = {}) {
  const original = shadeDefinition(options);
  return { ...original, metric: 'shade-hue-aware', hueParameters: HUE_METRIC,
    referenceQuality: original.referenceQuality + ' Then multiply by a hue gate: full through 10 circular OKLab degrees, smoothstep to zero at 30 degrees. Gate strength follows the anchor chromatic-strength transition.',
    support: 'Each hard layer admits adjusted quality >= cutoff, inside frozen shade support and with a positive hue gate. Pure neutral anchors retain their original membership.',
    precision: 'Provisional directional shade tolerance with stricter hue admission; nearest unchanged anchor. Original shade-aware and precise-color metrics remain available.',
  };
}
export function hueMembership(lab, region, options = {}) {
  const result = hueReferenceQuality(lab, region.lab);
  let weight = 0, weightedQuality = 0;
  for (const component of componentsFor(options)) {
    if (!result.support || result.referenceQuality + 1e-12 < component.cutoff) continue;
    weight += component.weight;
    weightedQuality += component.weight * Math.max(component.cutoff, result.referenceQuality);
  }
  return { ...result, area: weight, weight, quality: weight ? weightedQuality / weight : 0 };
}
