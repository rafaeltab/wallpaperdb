import { singleton } from 'tsyringe';

export interface ColorInput {
  color: string;
  amount: number;
  spread?: number;
}

export interface ColorSortInput {
  colors: ColorInput[];
}

export type SpreadStrategy = 'linear' | 'exponential' | 'exact';

export interface ColorSortConfig {
  spreadStrategy: SpreadStrategy;
  minSigma: number;
  maxSigma: number;
  defaultSpread: number;
}

export type OkLabColor = [number, number, number];

const HUE_BINS = 12;
const SAT_BINS = 2;
const VAL_BINS = 2;
const CHROMATIC_BINS = HUE_BINS * SAT_BINS * VAL_BINS;
const ACHROMATIC_BINS = 16;
const TOTAL_BINS = CHROMATIC_BINS + ACHROMATIC_BINS;
const ACHROMATIC_SATURATION_THRESHOLD = 0.1;

function resolveSpreadStrategy(spreadStrategy?: SpreadStrategy): SpreadStrategy {
  if (spreadStrategy) {
    return spreadStrategy;
  }

  const configuredStrategy = process.env.COLOR_SPREAD_STRATEGY;
  if (!configuredStrategy) {
    return 'linear';
  }

  if (
    configuredStrategy === 'linear' ||
    configuredStrategy === 'exponential' ||
    configuredStrategy === 'exact'
  ) {
    return configuredStrategy;
  }

  throw new Error(
    `Invalid COLOR_SPREAD_STRATEGY: ${configuredStrategy}. Expected one of: linear, exponential, exact`
  );
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToSrgb(hex: string): [number, number, number] {
  const match = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const value = Number.parseInt(match[1], 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return [r, g, b];
}

export function linearRgbToOklab(r: number, g: number, b: number): OkLabColor {
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

export function hexToOklab(hex: string): OkLabColor {
  const [r, g, b] = hexToSrgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return linearRgbToOklab(lr, lg, lb);
}

export function hsvToSrgb(h: number, s: number, v: number): [number, number, number] {
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

export function hsvToOklab(h: number, s: number, v: number): OkLabColor {
  const [r, g, b] = hsvToSrgb(h, s, v);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return linearRgbToOklab(lr, lg, lb);
}

export function computeBinCenters(): OkLabColor[] {
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

export function oklabDistance(a: OkLabColor, b: OkLabColor): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

export function computeSigma(
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

export function gaussianWeight(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

export function findNearestBin(color: OkLabColor): number {
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

@singleton()
export class ColorSortService {
  private readonly config: ColorSortConfig;

  constructor(config?: Partial<ColorSortConfig>) {
    this.config = {
      spreadStrategy: resolveSpreadStrategy(config?.spreadStrategy),
      minSigma: config?.minSigma ?? 0.1,
      maxSigma: config?.maxSigma ?? 0.5,
      defaultSpread: config?.defaultSpread ?? 0.5,
    };
  }

  buildQueryVector(input: ColorSortInput): number[] {
    this.validateInput(input);

    const vector = new Float64Array(TOTAL_BINS);

    for (const colorInput of input.colors) {
      const oklab = hexToOklab(colorInput.color);
      const spread = colorInput.spread ?? this.config.defaultSpread;
      const sigma = computeSigma(
        spread,
        this.config.spreadStrategy,
        this.config.minSigma,
        this.config.maxSigma
      );

      if (this.config.spreadStrategy === 'exact') {
        const nearestBin = findNearestBin(oklab);
        vector[nearestBin] += colorInput.amount;
      } else {
        for (let i = 0; i < TOTAL_BINS; i++) {
          const distance = oklabDistance(oklab, BIN_CENTERS[i]);
          const weight = colorInput.amount * gaussianWeight(distance, sigma);
          vector[i] += weight;
        }
      }
    }

    return Array.from(vector);
  }

  private validateInput(input: ColorSortInput): void {
    if (!input.colors || input.colors.length === 0) {
      throw new Error('Colors array must not be empty');
    }

    for (const c of input.colors) {
      if (!c.color || !/^#[0-9a-fA-F]{6}$/.test(c.color)) {
        throw new Error(`Invalid hex color: ${c.color}`);
      }
      if (c.amount <= 0) {
        throw new Error(`Amount must be positive, got: ${c.amount}`);
      }
      if (c.spread !== undefined && (c.spread < 0 || c.spread > 1)) {
        throw new Error(`Spread must be in [0, 1], got: ${c.spread}`);
      }
    }
  }
}
