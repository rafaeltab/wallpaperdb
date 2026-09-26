import { Schema } from 'effect';
interface ColorPreference {
  color: string;
  amount: number;
  spread?: number;
}
type SpreadStrategy = 'linear' | 'exponential' | 'exact';
type OkLabColor = [number, number, number];
const HUE_BINS = 12;
const SAT_BINS = 2;
const VAL_BINS = 2;
const CHROMATIC_BINS = HUE_BINS * SAT_BINS * VAL_BINS;
const ACHROMATIC_BINS = 16;
const TOTAL_BINS = CHROMATIC_BINS + ACHROMATIC_BINS;
const ACHROMATIC_SATURATION_THRESHOLD = 0.1;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToSrgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return [r, g, b];
}

function linearRgbToOklab(r: number, g: number, b: number): OkLabColor {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const okb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  return [L, a, okb];
}

function hexToOklab(hex: string): OkLabColor {
  const [r, g, b] = hexToSrgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return linearRgbToOklab(lr, lg, lb);
}

function hsvToSrgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r1: number, g1: number, b1: number;

  if (h < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (h < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }

  return [r1 + m, g1 + m, b1 + m];
}

function hsvToOklab(h: number, s: number, v: number): OkLabColor {
  const [r, g, b] = hsvToSrgb(h, s, v);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return linearRgbToOklab(lr, lg, lb);
}

function computeBinCenters(): OkLabColor[] {
  const centers: OkLabColor[] = [];

  for (let hueBin = 0; hueBin < HUE_BINS; hueBin++) {
    for (let satBin = 0; satBin < SAT_BINS; satBin++) {
      for (let valBin = 0; valBin < VAL_BINS; valBin++) {
        const h = hueBin * 30 + 15;
        const s = satBin === 0 ? (ACHROMATIC_SATURATION_THRESHOLD + 0.5) / 2 : 0.75;
        const v = valBin === 0 ? 0.25 : 0.75;
        centers.push(hsvToOklab(h, s, v));
      }
    }
  }

  for (let valBin = 0; valBin < ACHROMATIC_BINS; valBin++) {
    const v = (valBin + 0.5) / ACHROMATIC_BINS;
    centers.push(hsvToOklab(0, 0, v));
  }

  return centers;
}

const BIN_CENTERS: OkLabColor[] = computeBinCenters();

function oklabDistance(a: OkLabColor, b: OkLabColor): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function computeSigma(
  spread: number,
  strategy: SpreadStrategy,
  minSigma: number,
  maxSigma: number
): number {
  switch (strategy) {
    case 'linear':
      return minSigma + spread * (maxSigma - minSigma);
    case 'exponential':
      return minSigma * (maxSigma / minSigma) ** spread;
    case 'exact':
      return 0;
  }
}

function gaussianWeight(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

function findNearestBin(color: OkLabColor): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < BIN_CENTERS.length; i++) {
    const d = oklabDistance(color, BIN_CENTERS[i]);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return minIdx;
}

const validColor = Schema.is(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)));
const validAmount = Schema.is(Schema.Finite.check(Schema.isGreaterThan(0)));
const validSpread = Schema.is(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })));
const nonEmptyColors = Schema.is(Schema.Array(Schema.Unknown).check(Schema.isMinLength(1)));

export function validateColors(colors: ColorPreference[]): string | undefined {
  if (colors.length > 64) return 'Color search accepts at most 64 preferences';
  if (!nonEmptyColors(colors)) return 'Colors array must not be empty';
  for (const preference of colors) {
    if (!validColor(preference.color)) return 'Invalid hex color: expected #RRGGBB';
    if (!validAmount(preference.amount)) return 'Amount must be positive and finite';
    if (preference.spread !== undefined && !validSpread(preference.spread))
      return 'Spread must be in [0, 1]';
  }
  return undefined;
}

export function buildColorVector(colors: ColorPreference[], strategy: SpreadStrategy): number[] {
  const vector = new Float64Array(TOTAL_BINS);
  for (const preference of colors) {
    const oklab = hexToOklab(preference.color);
    const sigma = computeSigma(preference.spread ?? 0.5, strategy, 0.1, 0.5);
    if (strategy === 'exact') {
      vector[findNearestBin(oklab)] += preference.amount;
    } else {
      for (let i = 0; i < TOTAL_BINS; i++) {
        vector[i] +=
          preference.amount * gaussianWeight(oklabDistance(oklab, BIN_CENTERS[i]), sigma);
      }
    }
  }
  return Array.from(vector);
}
