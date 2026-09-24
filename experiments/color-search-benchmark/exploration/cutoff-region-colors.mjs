// Read-only examples of alternate pixel memberships; no wallpaper ranking.
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { cutoffWeight } from './cutoff-definition.mjs';
import { cutoffQueryDefinition, cutoffQueryMembership } from './cutoff-blend.mjs';
import { colorAtlasGeometry } from './web/overlap-color-layout.mjs';

const latticeSteps = 10;
const maxSamples = 1024;
const cacheLimit = 16;
const samplesByMembership = new Map();

function hslRgb(hue, saturation, lightness) {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map(offset => {
    const phase = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(phase - 3, 9 - phase, 1))));
  });
}

// Reject out-of-gamut linear RGB before gamma encoding and RGB8 rounding.
// This matches the inverse coefficients used by the original region sampler.
function inGamutRgb([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s,
  ];
  if (channels.some(value => value < -1e-7 || value > 1 + 1e-7)) return null;
  return channels.map(value => {
    const linear = Math.min(1, Math.max(0, value));
    const gamma = linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055;
    return Math.round(gamma * 255);
  });
}

function colorSample(rgb, region, parameters, components, context = null) {
  const hex = '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
  const lab = Object.freeze(rgbToLab(rgb.map(value => value / 255)));
  const { distance, referenceQuality, weight } = cutoffQueryMembership(lab, region, parameters);
  const details = components.map(component => {
    const pixelWeight = cutoffWeight(distance, component.kernel, component.cutoff);
    const support = cutoffWeight(distance, 'hard', component.cutoff);
    const quality = support ? Math.max(component.cutoff, referenceQuality) : 0;
    return Object.freeze({
      kernel: component.kernel, cutoff: component.cutoff,
      scoreWeight: component.weight, pixelWeight, matches: pixelWeight > 0,
      referenceQuality, quality,
      weightedArea: component.weight * pixelWeight,
      weightedQuality: component.weight * pixelWeight * quality,
    });
  });
  return Object.freeze({
    ...(context ?? {}), hex, lab, distance,
    quality: referenceQuality, referenceQuality, weight, matches: weight > 0,
    displayWeight: weight * referenceQuality,
    isAnchor: !context && hex === region.hex,
    components: Object.freeze(details),
  });
}

function buildContextPlanes(region, parameters, components) {
  const { hueColumns, neutralColumn, rows, hueStart, hueStep, axisStep } = colorAtlasGeometry(region.hex);
  const planes = {};
  for (const axis of ['lightness', 'saturation']) {
    const samples = [];
    for (let row = 0; row < rows; row++) for (let column = 0; column <= neutralColumn; column++) {
      if (axis === 'saturation' && column === neutralColumn && row > 0) continue;
      const hue = (hueStart + (column % hueColumns) * hueStep) % 360;
      const saturation = column === neutralColumn ? 0 : axis === 'saturation' ? row * axisStep : 1;
      const lightness = axis === 'lightness' ? row * axisStep : .5;
      samples.push(colorSample(hslRgb(hue, saturation, lightness), region, parameters, components, { column, row, contextOnly: true }));
    }
    planes[axis] = Object.freeze(samples);
  }
  return Object.freeze(planes);
}

function buildSamples(region, definition) {
  const parameters = { profile: definition.profile, cutoff: definition.cutoff, ...(definition.profile === 'all-levels' ? { cutoffBlendExponent: definition.cutoffBlendExponent } : {}) };
  const components = definition.components;
  const latticeStep = definition.radius / latticeSteps;
  const unique = new Map();
  const add = channels => {
    const sample = colorSample(channels, region, parameters, components);
    // At hard cutoff zero, quality zero can still count at the finite boundary.
    if (sample.matches && !unique.has(sample.hex)) unique.set(sample.hex, sample);
  };
  add(region.rgb.map(value => Math.round(value * 255)));
  for (let l = -latticeSteps; l <= latticeSteps; l++) {
    for (let a = -latticeSteps; a <= latticeSteps; a++) {
      for (let b = -latticeSteps; b <= latticeSteps; b++) {
        if (l * l + a * a + b * b > latticeSteps * latticeSteps) continue;
        const rgb = inGamutRgb(region.lab.map((value, index) => value + [l, a, b][index] * latticeStep));
        if (rgb) add(rgb);
      }
    }
  }
  const anchor = unique.get(region.hex);
  const others = [...unique.values()].filter(sample => !sample.isAnchor).sort((left, right) =>
    left.lab[0] - right.lab[0] || Math.atan2(left.lab[2], left.lab[1]) - Math.atan2(right.lab[2], right.lab[1]) || left.hex.localeCompare(right.hex));
  const retained = others.length < maxSamples ? others : Array.from({ length: maxSamples - 1 }, (_, index) => others[Math.round(index * (others.length - 1) / (maxSamples - 2))]);
  const samples = Object.freeze([anchor, ...retained]);
  return Object.freeze({
    samples, contextPlanes: buildContextPlanes(region, parameters, components),
    sampling: Object.freeze({
      kind: 'representative-region-colors',
      source: 'Displayable sRGB colors inside this membership support; not pixels measured in a wallpaper.',
      space: 'OKLab', latticeStep, maxSamples,
      candidateCount: unique.size, returnedCount: samples.length, truncated: samples.length < unique.size,
      quality: 'Reference quality q = max(0, 1 - distance / 0.24). A color counts when membership weight is positive, including the finite hard-cutoff-zero boundary even when q is zero.',
      weight: 'Per-pixel membership weight. Hard profiles count fully within support; smooth profiles measure effective area. Consensus shows score-weighted component memberships for explanation.',
      display: 'Suggested square size: membership weight × reference quality, with a visible minimum for counting zero-quality boundary colors. This is a pixel-level visual guide, not the final wallpaper score.',
      consensus: 'OpenSearch computes scores for each cutoff separately and combines those scores with the component score weights. These displayed weighted pixel memberships are not a stored blended descriptor or a substitute for the score calculation.',
      controls: 'Wallpaper minimum-quality and quality-influence controls do not change these pixel memberships. The minimum-quality gate applies to the wallpaper conditional mean for each component.',
      method: 'Local OKLab support lattice, sRGB gamut rejection, RGB8 rounding and exact membership recheck; anchor included. Large sets are evenly sampled in lightness/hue order.',
      context: 'Reference HSL planes include counting and nonmatching RGB8 colors. Lightness varies at full saturation; saturation varies at half lightness. Neutral cells use zero saturation. Nominal hue coordinates remain defined for gray, black and white.',
    }),
  });
}

export function cutoffRegionColors({ regionIndex, bucketCount = 1024, profile = 'hard', cutoff = .5, cutoffBlendExponent } = {}) {
  if (!Number.isInteger(regionIndex) || regionIndex < 0 || regionIndex >= OVERLAP_REGIONS.length) throw Error('Invalid overlap region index.');
  const bank = overlapRegionsForCount(bucketCount);
  const region = bank.find(candidate => candidate.index === regionIndex);
  if (!region) throw Error('The region is not part of the selected bucket bank.');
  const definition = cutoffQueryDefinition({ bucketCount, profile, cutoff, ...(cutoffBlendExponent === undefined ? {} : { cutoffBlendExponent }) });
  const cacheKey = `${regionIndex}:${profile}:${definition.cutoff}:${definition.cutoffBlendExponent ?? ''}`;
  let cached = samplesByMembership.get(cacheKey);
  if (!cached) cached = buildSamples(region, definition);
  // Same anchor/profile/cutoff/blend has identical examples in all four banks.
  samplesByMembership.delete(cacheKey);
  samplesByMembership.set(cacheKey, cached);
  if (samplesByMembership.size > cacheLimit) samplesByMembership.delete(samplesByMembership.keys().next().value);
  return { region: { index: region.index, key: region.key, hex: region.hex, lab: region.lab }, definition, ...cached };
}
