// Read-only display examples of the indexed region geometry, never wallpaper ranking.
import { rgbToLab } from './corpus-colors.mjs';
import { OVERLAP_DEFINITION, OVERLAP_REGIONS, overlapMembership } from './overlap-regions.mjs';
import { overlapDefinitionForCount, overlapRegionsForCount } from './overlap-banks.mjs';
import { colorAtlasGeometry } from './web/overlap-color-layout.mjs';

const latticeSteps = 10;
const latticeStep = OVERLAP_DEFINITION.radius / latticeSteps;
const maxSamples = 1024;
const cacheLimit = 32;
const samplesByRegion = new Map();

function hslRgb(hue, saturation, lightness) {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map(offset => {
    const phase = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(phase - 3, 9 - phase, 1))));
  });
}

function buildContextPlanes(region) {
  const { hueColumns, neutralColumn, rows, hueStart, hueStep, axisStep } = colorAtlasGeometry(region.hex);
  const planes = {};
  for (const axis of ['lightness', 'saturation']) {
    const samples = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column <= neutralColumn; column++) {
        // Exact grays have zero saturation, so there are no neutral cells above
        // that row in the saturation view. Lightness supports a full gray ramp.
        if (axis === 'saturation' && column === neutralColumn && row > 0) continue;
        const hue = (hueStart + (column % hueColumns) * hueStep) % 360;
        const saturation = column === neutralColumn ? 0 : axis === 'saturation' ? row * axisStep : 1;
        const lightness = axis === 'lightness' ? row * axisStep : .5;
        const rgb = hslRgb(hue, saturation, lightness);
        const hex = '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
        const lab = rgbToLab(rgb.map(value => value / 255));
        const membership = overlapMembership(lab, region);
        samples.push(Object.freeze({
          column, row, hex, lab: Object.freeze(lab), quality: membership.quality,
          distance: Math.hypot(...lab.map((value, index) => value - region.lab[index])),
          isAnchor: false, matches: Boolean(membership.area), contextOnly: true,
        }));
      }
    }
    planes[axis] = Object.freeze(samples);
  }
  return Object.freeze(planes);
}

// Same inverse coefficients as ranges.mjs, but test the *unclipped* linear RGB
// first: clipping an out-of-gamut lattice point would misrepresent the sphere.
function inGamutRgb([L, a, b]) {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s,
  ];
  // Rounded inverse matrices need a tiny tolerance at sRGB cube boundaries.
  if (channels.some(value => value < -1e-7 || value > 1 + 1e-7)) return null;
  return channels.map(value => {
    const linear = Math.min(1, Math.max(0, value));
    const gamma = linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055;
    return Math.round(gamma * 255);
  });
}

function buildSamples(region) {
  const unique = new Map();
  const add = channels => {
    const hex = '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('');
    if (unique.has(hex)) return;
    // Membership belongs to the actual displayed RGB8 color after rounding.
    const lab = rgbToLab(channels.map(value => value / 255));
    const membership = overlapMembership(lab, region);
    if (!membership.area) return;
    const distance = Math.hypot(...lab.map((value, index) => value - region.lab[index]));
    unique.set(hex, Object.freeze({ hex, lab: Object.freeze(lab), quality: membership.quality, distance, isAnchor: hex === region.hex }));
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
  // Evenly retain examples across the lightness/hue-ordered lattice when the
  // sphere contains more displayable samples than the bounded UI needs.
  const retained = others.length < maxSamples ? others : Array.from({ length: maxSamples - 1 }, (_, index) => others[Math.round(index * (others.length - 1) / (maxSamples - 2))]);
  const samples = Object.freeze([anchor, ...retained]);
  return Object.freeze({
    samples,
    contextPlanes: buildContextPlanes(region),
    sampling: Object.freeze({
      kind: 'representative-region-colors',
      source: 'Displayable sRGB colors inside this region; not pixels measured in a wallpaper.',
      space: 'OKLab', latticeStep, maxSamples,
      candidateCount: unique.size, returnedCount: samples.length, truncated: samples.length < unique.size,
      quality: 'Raw pixel membership: 1 at the anchor and 0.5 at the radius. Wallpaper quality is the average over matching pixels; query tuning does not change these samples.',
      method: 'Local OKLab sphere lattice, sRGB gamut rejection, RGB8 rounding and membership recheck; exact anchor included. Large sets are evenly sampled in lightness/hue order.',
      context: 'Reference HSL planes include accepted and nonmatching RGB8 colors, with membership rechecked after rounding. Lightness varies at 100% saturation; saturation varies at 50% lightness. Neutral cells use zero saturation. Their nominal hue coordinates are retained even for hue-free black, white and gray.',
    }),
  });
}

export function overlapRegionColors({ regionIndex, bucketCount = 1024 } = {}) {
  if (!Number.isInteger(regionIndex) || regionIndex < 0 || regionIndex >= OVERLAP_REGIONS.length) throw Error('Invalid overlap region index.');
  const bank = overlapRegionsForCount(bucketCount);
  const region = bank.find(candidate => candidate.index === regionIndex);
  if (!region) throw Error('The region is not part of the selected bucket bank.');
  let cached = samplesByRegion.get(regionIndex);
  if (!cached) cached = buildSamples(region);
  // Bounded LRU, shared by all counts because original region geometry is fixed.
  samplesByRegion.delete(regionIndex);
  samplesByRegion.set(regionIndex, cached);
  if (samplesByRegion.size > cacheLimit) samplesByRegion.delete(samplesByRegion.keys().next().value);
  return {
    region: { index: region.index, key: region.key, hex: region.hex, lab: region.lab },
    definition: overlapDefinitionForCount(bucketCount), ...cached,
  };
}
