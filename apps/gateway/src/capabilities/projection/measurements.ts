import {
  COLOR_ANCHORS_SHA256,
  COLOR_CUTOFFS,
  COLOR_FEATURE_NAMES,
  COLOR_MEASUREMENT_VERSION,
  COLOR_REFERENCE_COMMIT,
} from '../catalogue/index.js';
import type { ProjectionChange } from './contract.js';

function validPair(coverage: number, quality: number): boolean {
  return (
    Number.isInteger(coverage) &&
    coverage >= 0 &&
    coverage <= 10000 &&
    Number.isFinite(quality) &&
    quality >= 0 &&
    quality <= 1 &&
    Math.fround(quality) === quality
  );
}
export function compatibleMeasurements(
  change: Extract<ProjectionChange, { _tag: 'ColorsMeasured' }>
): boolean {
  const { descriptor, provenance, original, wallpaperId } = change;
  if (
    descriptor.version !== COLOR_MEASUREMENT_VERSION ||
    descriptor.sampleCount !== 16384 ||
    descriptor.layers.length !== 5 ||
    original.owner !== 'ingestor' ||
    original.id !== wallpaperId ||
    provenance.referenceCommit !== COLOR_REFERENCE_COMMIT ||
    provenance.anchorsSha256 !== COLOR_ANCHORS_SHA256 ||
    !/^[a-f0-9]{64}$/.test(provenance.originalSha256)
  )
    return false;
  if (
    Object.keys(descriptor.named).length !== COLOR_FEATURE_NAMES.length ||
    !COLOR_FEATURE_NAMES.every((name) => {
      const pair = descriptor.named[name];
      return pair !== undefined && validPair(pair.coverage, pair.quality);
    })
  )
    return false;
  return descriptor.layers.every(
    (layer, level) =>
      layer.cutoff === COLOR_CUTOFFS[level] &&
      layer.coverage.length === 256 &&
      layer.quality.length === 256 &&
      layer.coverage.every(
        (coverage, index) =>
          validPair(coverage, layer.quality[index]) &&
          (coverage !== 0 || layer.quality[index] === 0) &&
          (level === 0 || coverage <= descriptor.layers[level - 1].coverage[index]) &&
          (coverage === 0 || layer.quality[index] + 1e-7 >= layer.cutoff)
      )
  );
}
