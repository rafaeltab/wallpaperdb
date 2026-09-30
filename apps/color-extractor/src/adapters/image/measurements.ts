import { COLOR_ANCHORS, COLOR_CUTOFFS, COLOR_FEATURE_NAMES } from '@wallpaperdb/events';
import type { ColorMeasurements } from '../../capabilities/extraction/index.js';

type Lab = readonly [number, number, number];
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

function rgbToLab(rgb: readonly number[]): Lab {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function hsv([r, g, b]: readonly number[]): Lab {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h =
    d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, max === 0 ? 0 : d / max, max];
}
function coordinates([l, a, b]: Lab) {
  const divisor = Math.max(l, 1e-6),
    relativeA = a / divisor,
    relativeB = b / divisor;
  const strength = smoothstep((Math.hypot(relativeA, relativeB) - 0.03) / 0.09);
  return {
    l,
    a,
    b,
    relativeA,
    relativeB,
    strength,
    lightnessWeight: 1 - 0.75 * strength,
    beta: 0.5 * strength,
    visibility: smoothstep((l - 0.08) / 0.16),
    chroma: Math.hypot(a, b),
  };
}
const anchors = COLOR_ANCHORS.map((anchor) =>
  coordinates(
    rgbToLab(
      [1, 3, 5].map((offset) => Number.parseInt(anchor.hex.slice(offset, offset + 2), 16) / 255)
    )
  )
);

function hueQuality(pixel: ReturnType<typeof coordinates>, anchor: ReturnType<typeof coordinates>) {
  const dl = pixel.l - anchor.l,
    da = pixel.a - anchor.a,
    db = pixel.b - anchor.b;
  let distance: number;
  if (anchor.strength === 0) distance = Math.hypot(dl, da, db);
  else {
    const relativeA = anchor.l * (pixel.relativeA - anchor.relativeA);
    const relativeB = anchor.l * (pixel.relativeB - anchor.relativeB);
    distance = Math.sqrt(
      (anchor.lightnessWeight * dl) ** 2 +
        (1 - anchor.beta) * (da * da + db * db) +
        anchor.beta * (relativeA * relativeA + relativeB * relativeB)
    );
  }
  const relativeVisibility =
    anchor.visibility > 0 ? Math.min(1, pixel.visibility / anchor.visibility) : 1;
  const visibility = 1 - anchor.strength + anchor.strength * relativeVisibility;
  let gate = 1;
  if (anchor.strength !== 0) {
    const product = pixel.chroma * anchor.chroma;
    const cosine =
      product > 1e-14
        ? Math.max(-1, Math.min(1, (pixel.a * anchor.a + pixel.b * anchor.b) / product))
        : null;
    const angle = cosine === null ? null : (Math.acos(cosine) * 180) / Math.PI;
    const weight = angle === null || angle >= 30 - 1e-12 ? 0 : smoothstep((30 - angle) / 20);
    gate = 1 - anchor.strength + anchor.strength * weight;
  }
  return {
    support: distance / 0.24 <= 1 + 1e-12 && visibility > 0 && gate > 0,
    quality: visibility * Math.max(0, 1 - distance / 0.24) * gate,
  };
}
const hueRegions: Readonly<Record<string, readonly [number, number]>> = {
  red: [4, 46],
  orange: [29, 25],
  yellow: [58, 24],
  green: [127, 61],
  teal: [172, 29],
  cyan: [191, 32],
  blue: [234, 47],
  purple: [282, 38],
  pink: [334, 44],
  brown: [29, 28],
};
function namedMembership(rgb: readonly number[]) {
  const [h, s, v] = hsv(rgb),
    [l, a, b] = rgbToLab(rgb),
    chroma = Math.hypot(a, b);
  const result: Record<string, { area: number; quality: number }> = {};
  const assign = (name: string, inside: boolean, core: number) => {
    result[name] = { area: inside ? 1 : 0, quality: inside ? 0.5 + 0.5 * clamp(core) : 0 };
  };
  for (const [name, [center, width]] of Object.entries(hueRegions)) {
    const hueDistance = Math.abs(((h - center + 540) % 360) - 180);
    let inside = hueDistance <= width && s >= 0.18 && v >= 0.09 && chroma >= 0.018;
    if (name === 'pink') inside = inside && l >= 0.56;
    if (name === 'brown') inside = inside && l >= 0.22 && l <= 0.65;
    const palePenalty = name === 'red' ? 1 - clamp((l - 0.72) / 0.24) * 0.65 : 1;
    const hueCore = 1 - hueDistance / width;
    const vividness = Math.sqrt(s) * Math.sqrt(v);
    assign(name, inside, hueCore * vividness * palePenalty);
  }
  assign('strict_grayscale', chroma <= 0.005, 1 - chroma / 0.005);
  assign('grayscale', chroma <= 0.035, 1 - chroma / 0.035);
  assign('near_neutral', chroma <= 0.065, 1 - chroma / 0.065);
  assign('black', l <= 0.25, 1 - l / 0.25);
  assign(
    'gray',
    chroma <= 0.045 && l >= 0.2 && l <= 0.88,
    (1 - chroma / 0.045) * (1 - Math.abs(l - 0.54) / 0.34)
  );
  assign('white', chroma <= 0.055 && l >= 0.86, ((1 - chroma / 0.055) * (l - 0.86)) / 0.14);
  assign('dark', l <= 0.5, 1 - l / 0.5);
  assign('light', l >= 0.72, (l - 0.72) / 0.28);
  assign('bright', v >= 0.72 && l >= 0.55, (v - 0.72) / 0.28);
  assign('vivid', s >= 0.55 && v >= 0.5, (((s - 0.55) / 0.45) * (v - 0.5)) / 0.5);
  assign('muted', s <= 0.4 && chroma <= 0.085, 1 - chroma / 0.085);
  return result;
}

/** Preserve the frozen hue-index and corpus-features accumulation orders. */
export function measurePixels(rgba: Uint8Array): ColorMeasurements {
  if (rgba.length !== 128 * 128 * 4)
    throw new Error('Expected the complete 128 by 128 RGBA sample');
  const total = rgba.length / 4,
    colors = new Map<number, number>();
  const sums: Record<string, { area: number; qualityMass: number }> = Object.fromEntries(
    COLOR_FEATURE_NAMES.map((name) => [name, { area: 0, qualityMass: 0 }])
  );
  const hueCounts = Array<number>(12).fill(0);
  let chromatic = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] / 255;
    const channels = [0, 1, 2].map((c) => Math.round(rgba[offset + c] * alpha));
    const rgb = channels.map((c) => c / 255);
    const key = (channels[0] << 16) | (channels[1] << 8) | channels[2];
    colors.set(key, (colors.get(key) ?? 0) + 1);
    for (const [name, match] of Object.entries(namedMembership(rgb))) {
      sums[name].area += match.area;
      sums[name].qualityMass += match.area * match.quality;
    }
    const [h, s, v] = hsv(rgb);
    if (s >= 0.2 && v >= 0.15) {
      hueCounts[Math.min(11, Math.floor(h / 30))]++;
      chromatic++;
    }
  }
  const entropy = chromatic
    ? -hueCounts.reduce(
        (n, count) => (count ? n + (count / chromatic) * Math.log(count / chromatic) : n),
        0
      ) / Math.log(12)
    : 0;
  const monochromatic = 1 - entropy;
  const rainbow =
    (hueCounts.filter((count) => count / total >= 0.01).length / 12) * (chromatic / total);
  sums.monochromatic = { area: monochromatic * total, qualityMass: monochromatic * total };
  sums.rainbow = { area: rainbow * total, qualityMass: rainbow * total };
  const masses = new Float64Array(5 * 256),
    qualityMasses = new Float64Array(5 * 256);
  for (const [rgb, count] of colors) {
    const pixel = coordinates(
      rgbToLab([(rgb >>> 16) / 255, ((rgb >>> 8) & 255) / 255, (rgb & 255) / 255])
    );
    for (let index = 0; index < anchors.length; index++) {
      const match = hueQuality(pixel, anchors[index]);
      if (!match.support) continue;
      for (let level = 0; level < COLOR_CUTOFFS.length; level++) {
        const cutoff = COLOR_CUTOFFS[level];
        if (match.quality + 1e-12 < cutoff) break;
        const offset = level * 256 + index;
        masses[offset] += count;
        qualityMasses[offset] += count * Math.max(cutoff, match.quality);
      }
    }
  }
  return {
    version: 'shade-hue-256-v1',
    sampleCount: 16384,
    layers: COLOR_CUTOFFS.map((cutoff, level) => ({
      cutoff,
      coverage: Array.from({ length: 256 }, (_, index) =>
        Math.round((masses[level * 256 + index] / total) * 10000)
      ),
      quality: Array.from({ length: 256 }, (_, index) => {
        const offset = level * 256 + index;
        return masses[offset] ? Math.fround(qualityMasses[offset] / masses[offset]) : 0;
      }),
    })),
    named: Object.fromEntries(
      Object.entries(sums).map(([name, sum]) => [
        name,
        {
          coverage: Math.round((sum.area / total) * 10000),
          quality: sum.area ? Math.fround(sum.qualityMass / sum.area) : 0,
        },
      ])
    ),
  };
}
