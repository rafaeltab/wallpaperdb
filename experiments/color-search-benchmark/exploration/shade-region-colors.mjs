// Read-only pixel examples for the experimental shade-aware geometry.
// Sampling covers the full sRGB gamut; the old local OKLab sphere is not a bound.
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { shadeDefinition, shadeMembership } from './shade-definition.mjs';
import { hueDefinition, hueMembership } from './hue-definition.mjs';
import { colorAtlasGeometry } from './web/overlap-color-layout.mjs';

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

function colorSample(rgb, region, parameters, components, membership, context = null) {
  const hex = '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
  const lab = Object.freeze(rgbToLab(rgb.map(value => value / 255)));
  const { distance, referenceQuality, weight, hueGapDegrees, hueGate } = membership(lab, region, parameters);
  const details = components.map(component => {
    const { weight: pixelWeight, quality } = membership(lab, region, { profile: component.kernel, cutoff: component.cutoff });
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
    ...(hueGate === undefined ? {} : { hueGapDegrees, hueGate }),
    quality: referenceQuality, referenceQuality, weight, matches: weight > 0,
    displayWeight: weight * referenceQuality,
    isAnchor: !context && hex === region.hex,
    components: Object.freeze(details),
  });
}

function buildContextPlanes(region, parameters, components, membership) {
  const { hueColumns, neutralColumn, rows, hueStart, hueStep, axisStep } = colorAtlasGeometry(region.hex);
  const planes = {};
  for (const axis of ['lightness', 'saturation']) {
    const samples = [];
    for (let row = 0; row < rows; row++) for (let column = 0; column <= neutralColumn; column++) {
      if (axis === 'saturation' && column === neutralColumn && row > 0) continue;
      const hue = (hueStart + (column % hueColumns) * hueStep) % 360;
      const saturation = column === neutralColumn ? 0 : axis === 'saturation' ? row * axisStep : 1;
      const lightness = axis === 'lightness' ? row * axisStep : .5;
      samples.push(colorSample(hslRgb(hue, saturation, lightness), region, parameters, components, membership, { column, row, contextOnly: true }));
    }
    planes[axis] = Object.freeze(samples);
  }
  return Object.freeze(planes);
}

function buildSamples(region, definition, membership) {
  const parameters = { profile: definition.profile, cutoff: definition.cutoff,
    ...(definition.profile === 'all-levels' ? { cutoffBlendExponent: definition.cutoffBlendExponent } : {}) };
  const components = definition.components;
  const unique = new Map();
  const seen = new Set();
  const add = channels => {
    const key = channels.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const sample = colorSample(channels, region, parameters, components, membership);
    if (sample.matches) unique.set(sample.hex, sample);
  };
  const anchorRgb = region.rgb.map(value => Math.round(value * 255));
  add(anchorRgb);
  // Fine RGB8 offsets keep narrow layers visible even around black and white.
  const offsets = [-16, -8, -4, -2, -1, 0, 1, 2, 4, 8, 16];
  for (const r of offsets) for (const g of offsets) for (const b of offsets) {
    add(anchorRgb.map((value, index) => Math.max(0, Math.min(255, value + [r, g, b][index]))));
  }
  const { hueColumns, rows, hueStart, hueStep, axisStep } = colorAtlasGeometry(region.hex);
  for (let hue = 0; hue < hueColumns; hue++) for (let s = 0; s < rows; s++) for (let l = 0; l < rows; l++) {
    add(hslRgb((hueStart + hue * hueStep) % 360, s * axisStep, l * axisStep));
  }
  const anchor = unique.get(region.hex);
  const others = [...unique.values()].filter(sample => !sample.isAnchor).sort((left, right) =>
    left.lab[0] - right.lab[0] || Math.atan2(left.lab[2], left.lab[1]) - Math.atan2(right.lab[2], right.lab[1]) || left.hex.localeCompare(right.hex));
  const retained = others.length < maxSamples ? others : Array.from({ length: maxSamples - 1 }, (_, index) => others[Math.round(index * (others.length - 1) / (maxSamples - 2))]);
  const samples = Object.freeze([anchor, ...retained]);
  return Object.freeze({
    samples, contextPlanes: buildContextPlanes(region, parameters, components, membership),
    sampling: Object.freeze({
      kind: 'representative-region-colors', space: 'sRGB sampled through HSL', maxSamples,
      source: `Displayable sRGB colors accepted by ${definition.metric} membership; not pixels measured in a wallpaper.`,
      candidateCount: unique.size, returnedCount: samples.length, truncated: samples.length < unique.size,
      quality: `Reference quality comes from the same ${definition.metric} metric used to measure the wallpaper index. Neutral anchors retain the original metric.`,
      weight: 'Each cutoff counts pixels with sufficient reference quality. Combined views blend the five separate hard memberships using the inspected score weights.',
      display: 'Square size uses membership weight × reference quality, with a tiny visible minimum for nonmatches.',
      consensus: 'OpenSearch computes scores for each cutoff separately and combines those scores with the component score weights. These displayed weighted pixel memberships are not a stored blended descriptor or a substitute for the score calculation.',
      controls: 'Wallpaper minimum-quality and quality-influence controls do not change these pixel memberships. The minimum-quality gate applies to the wallpaper conditional mean for each component.',
      method: 'Full-gamut HSL lattice in 5° hue and 5% saturation/lightness steps, plus fine RGB8 anchor offsets; exact membership recheck after rounding. Large sets are evenly sampled in lightness/hue order. These representative samples do not enumerate every RGB color.',
      context: 'Reference HSL planes retain matching and nonmatching RGB8 colors. Lightness varies at full saturation; saturation varies at half lightness. Neutral cells use zero saturation.',
    }),
  });
}

function regionColors({ regionIndex, bucketCount = 1024, profile = 'all-levels', cutoff = 0, cutoffBlendExponent } = {}, define, membership) {
  if (!Number.isInteger(regionIndex) || regionIndex < 0 || regionIndex >= OVERLAP_REGIONS.length) throw Error('Invalid overlap region index.');
  const region = overlapRegionsForCount(bucketCount).find(candidate => candidate.index === regionIndex);
  if (!region) throw Error('The region is not part of the selected bucket bank.');
  const definition = define({ bucketCount, profile, cutoff, ...(cutoffBlendExponent === undefined ? {} : { cutoffBlendExponent }) });
  const cacheKey = `${definition.metric}:${regionIndex}:${profile}:${definition.cutoff}:${definition.cutoffBlendExponent ?? ''}`;
  let cached = samplesByMembership.get(cacheKey);
  if (!cached) cached = buildSamples(region, definition, membership);
  samplesByMembership.delete(cacheKey);
  samplesByMembership.set(cacheKey, cached);
  if (samplesByMembership.size > cacheLimit) samplesByMembership.delete(samplesByMembership.keys().next().value);
  return { region: { index: region.index, key: region.key, hex: region.hex, lab: region.lab }, definition, ...cached };
}

export const shadeRegionColors = options => regionColors(options, shadeDefinition, shadeMembership);
export const hueRegionColors = options => regionColors(options, hueDefinition, hueMembership);
