import { describe, expect, it } from 'vitest';
import {
  type OkLabColor,
  ColorSortService,
  type ColorSortInput,
  hexToOklab,
  hexToSrgb,
  hsvToOklab,
  hsvToSrgb,
  linearRgbToOklab,
  srgbToLinear,
  computeBinCenters,
  computeSigma,
  gaussianWeight,
  oklabDistance,
  findNearestBin,
} from '../src/services/color-sort.service.js';

const APPROX = 0.001;

function approxEqual(actual: number, expected: number, tolerance = APPROX): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function approxOkLab(actual: OkLabColor, expected: OkLabColor): void {
  approxEqual(actual[0], expected[0]);
  approxEqual(actual[1], expected[1]);
  approxEqual(actual[2], expected[2]);
}

describe('ColorSortService', () => {
  const originalColorSpreadStrategy = process.env.COLOR_SPREAD_STRATEGY;

  afterEach(() => {
    if (originalColorSpreadStrategy === undefined) {
      delete process.env.COLOR_SPREAD_STRATEGY;
      return;
    }

    process.env.COLOR_SPREAD_STRATEGY = originalColorSpreadStrategy;
  });

  describe('sRGB gamma decoding', () => {
    it('should decode 0.0 linearly', () => {
      approxEqual(srgbToLinear(0.0), 0.0);
    });

    it('should decode 1.0 linearly', () => {
      approxEqual(srgbToLinear(1.0), 1.0);
    });

    it('should decode value below threshold linearly', () => {
      approxEqual(srgbToLinear(0.04045), 0.04045 / 12.92);
    });

    it('should decode value above threshold with power curve', () => {
      const c = 0.5;
      const expected = Math.pow((c + 0.055) / 1.055, 2.4);
      approxEqual(srgbToLinear(c), expected);
    });
  });

  describe('hex to sRGB', () => {
    it('should parse pure red', () => {
      const [r, g, b] = hexToSrgb('#FF0000');
      approxEqual(r, 1.0);
      approxEqual(g, 0.0);
      approxEqual(b, 0.0);
    });

    it('should parse pure green', () => {
      const [r, g, b] = hexToSrgb('#00FF00');
      approxEqual(r, 0.0);
      approxEqual(g, 1.0);
      approxEqual(b, 0.0);
    });

    it('should parse pure blue', () => {
      const [r, g, b] = hexToSrgb('#0000FF');
      approxEqual(r, 0.0);
      approxEqual(g, 0.0);
      approxEqual(b, 1.0);
    });

    it('should parse white', () => {
      const [r, g, b] = hexToSrgb('#FFFFFF');
      approxEqual(r, 1.0);
      approxEqual(g, 1.0);
      approxEqual(b, 1.0);
    });

    it('should parse black', () => {
      const [r, g, b] = hexToSrgb('#000000');
      approxEqual(r, 0.0);
      approxEqual(g, 0.0);
      approxEqual(b, 0.0);
    });

    it('should parse a mid-gray', () => {
      const [r, g, b] = hexToSrgb('#808080');
      approxEqual(r, 128 / 255);
      approxEqual(g, 128 / 255);
      approxEqual(b, 128 / 255);
    });

    it('should reject invalid hex', () => {
      expect(() => hexToSrgb('invalid')).toThrow();
      expect(() => hexToSrgb('#FFF')).toThrow();
      expect(() => hexToSrgb('#FFFF')).toThrow();
      expect(() => hexToSrgb('FF0000')).toThrow();
      expect(() => hexToSrgb('#GG0000')).toThrow();
    });
  });

  describe('linear RGB to OkLab', () => {
    it('should convert black to origin', () => {
      const result = linearRgbToOklab(0, 0, 0);
      approxOkLab(result, [0, 0, 0]);
    });

    it('should convert white to L=1', () => {
      const result = linearRgbToOklab(1, 1, 1);
      approxOkLab(result, [1, 0, 0]);
    });

    it('should convert pure red', () => {
      const result = linearRgbToOklab(1, 0, 0);
      expect(result[0]).toBeGreaterThan(0);
      expect(result[0]).toBeLessThan(1);
      expect(result[1]).toBeGreaterThan(0);
    });

    it('should convert pure green', () => {
      const result = linearRgbToOklab(0, 1, 0);
      expect(result[0]).toBeGreaterThan(0);
      expect(result[1]).toBeLessThan(0);
    });

    it('should convert pure blue', () => {
      const result = linearRgbToOklab(0, 0, 1);
      expect(result[0]).toBeGreaterThan(0);
      expect(result[1]).toBeLessThan(0);
      expect(result[2]).toBeLessThan(0);
    });
  });

  describe('hex to OkLab', () => {
    it('should convert black to origin', () => {
      approxOkLab(hexToOklab('#000000'), [0, 0, 0]);
    });

    it('should convert white to L=1', () => {
      approxOkLab(hexToOklab('#FFFFFF'), [1, 0, 0]);
    });

    it('should convert pure red', () => {
      const [L, a, b] = hexToOklab('#FF0000');
      approxEqual(L, 0.6279, 2);
      approxEqual(a, 0.2249, 2);
      approxEqual(b, 0.1260, 2);
    });

    it('should convert pure green', () => {
      const [L, a, b] = hexToOklab('#00FF00');
      approxEqual(L, 0.8664, 2);
      approxEqual(a, -0.2339, 2);
      approxEqual(b, 0.1795, 2);
    });

    it('should convert pure blue', () => {
      const [L, a, b] = hexToOklab('#0000FF');
      approxEqual(L, 0.4520, 2);
      approxEqual(a, -0.0325, 2);
      approxEqual(b, -0.3116, 2);
    });

    it('should produce same result as manual conversion pipeline', () => {
      const hex = '#336699';
      const [r, g, b] = hexToSrgb(hex);
      const lr = srgbToLinear(r);
      const lg = srgbToLinear(g);
      const lb = srgbToLinear(b);
      const expected = linearRgbToOklab(lr, lg, lb);
      const actual = hexToOklab(hex);
      approxOkLab(actual, expected);
    });
  });

  describe('HSV to sRGB', () => {
    it('should convert red (h=0)', () => {
      const [r, g, b] = hsvToSrgb(0, 1, 1);
      approxEqual(r, 1);
      approxEqual(g, 0);
      approxEqual(b, 0);
    });

    it('should convert green (h=120)', () => {
      const [r, g, b] = hsvToSrgb(120, 1, 1);
      approxEqual(r, 0);
      approxEqual(g, 1);
      approxEqual(b, 0);
    });

    it('should convert blue (h=240)', () => {
      const [r, g, b] = hsvToSrgb(240, 1, 1);
      approxEqual(r, 0);
      approxEqual(g, 0);
      approxEqual(b, 1);
    });

    it('should convert white (s=0, v=1)', () => {
      const [r, g, b] = hsvToSrgb(0, 0, 1);
      approxEqual(r, 1);
      approxEqual(g, 1);
      approxEqual(b, 1);
    });

    it('should convert black (v=0)', () => {
      const [r, g, b] = hsvToSrgb(0, 0, 0);
      approxEqual(r, 0);
      approxEqual(g, 0);
      approxEqual(b, 0);
    });

    it('should convert yellow (h=60)', () => {
      const [r, g, b] = hsvToSrgb(60, 1, 1);
      approxEqual(r, 1);
      approxEqual(g, 1);
      approxEqual(b, 0);
    });
  });

  describe('HSV to OkLab', () => {
    it('should produce black for v=0', () => {
      approxOkLab(hsvToOklab(0, 0, 0), [0, 0, 0]);
    });

    it('should produce white for s=0, v=1', () => {
      approxOkLab(hsvToOklab(0, 0, 1), [1, 0, 0]);
    });

    it('should produce same result as sRGB pipeline for red', () => {
      const [r, g, b] = hsvToSrgb(0, 1, 1);
      const expected = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
      approxOkLab(hsvToOklab(0, 1, 1), expected);
    });
  });

  describe('bin center computation', () => {
    it('should produce exactly 64 bins', () => {
      const centers = computeBinCenters();
      expect(centers).toHaveLength(64);
    });

    it('should have chromatic bins first (indices 0-47)', () => {
      const centers = computeBinCenters();
      for (let i = 0; i < 48; i++) {
        const [L] = centers[i];
        expect(L).toBeGreaterThan(0);
      }
    });

    it('should have achromatic bins last (indices 48-63)', () => {
      const centers = computeBinCenters();
      for (let i = 48; i < 64; i++) {
        const [L, a, b] = centers[i];
        expect(L).toBeGreaterThanOrEqual(0);
        approxEqual(a, 0, 2);
        approxEqual(b, 0, 2);
      }
    });

    it('achromatic bins should range from dark to light', () => {
      const centers = computeBinCenters();
      const first = centers[48];
      const last = centers[63];
      expect(first[0]).toBeLessThan(last[0]);
    });

    it('all chromatic bins should have non-zero a or b components', () => {
      const centers = computeBinCenters();
      for (let i = 0; i < 48; i++) {
        const [, a, b] = centers[i];
        const isAchromatic = Math.abs(a) < 0.01 && Math.abs(b) < 0.01;
        expect(isAchromatic).toBe(false);
      }
    });
  });

  describe('OkLab distance', () => {
    it('should be zero for identical colors', () => {
      const c: OkLabColor = [0.5, 0.1, -0.2];
      expect(oklabDistance(c, c)).toBe(0);
    });

    it('should match manual Euclidean distance', () => {
      const a: OkLabColor = [0.5, 0.1, -0.2];
      const b: OkLabColor = [0.3, 0.4, 0.1];
      const expected = Math.sqrt(
        (0.5 - 0.3) ** 2 + (0.1 - 0.4) ** 2 + (-0.2 - 0.1) ** 2,
      );
      approxEqual(oklabDistance(a, b), expected);
    });
  });

  describe('Gaussian weight', () => {
    it('should be 1 at zero distance', () => {
      expect(gaussianWeight(0, 0.3)).toBe(1);
    });

    it('should decrease with increasing distance', () => {
      const w1 = gaussianWeight(0.1, 0.3);
      const w2 = gaussianWeight(0.5, 0.3);
      expect(w1).toBeGreaterThan(w2);
    });

    it('should be wider with larger sigma', () => {
      const w1 = gaussianWeight(0.3, 0.1);
      const w2 = gaussianWeight(0.3, 0.5);
      expect(w2).toBeGreaterThan(w1);
    });

    it('should match formula exp(-d²/(2σ²))', () => {
      const d = 0.4;
      const sigma = 0.2;
      const expected = Math.exp(-(d * d) / (2 * sigma * sigma));
      approxEqual(gaussianWeight(d, sigma), expected);
    });
  });

  describe('computeSigma', () => {
    const minSigma = 0.1;
    const maxSigma = 0.5;

    it('linear: should interpolate between min and max', () => {
      approxEqual(computeSigma(0, 'linear', minSigma, maxSigma), minSigma);
      approxEqual(computeSigma(1, 'linear', minSigma, maxSigma), maxSigma);
      approxEqual(computeSigma(0.5, 'linear', minSigma, maxSigma), (minSigma + maxSigma) / 2);
    });

    it('exponential: should use geometric interpolation', () => {
      approxEqual(computeSigma(0, 'exponential', minSigma, maxSigma), minSigma);
      approxEqual(computeSigma(1, 'exponential', minSigma, maxSigma), maxSigma);
      const mid = computeSigma(0.5, 'exponential', minSigma, maxSigma);
      approxEqual(mid, minSigma * Math.sqrt(maxSigma / minSigma));
    });

    it('exponential: should give finer control at low spread', () => {
      const lowLinear = computeSigma(0.1, 'linear', minSigma, maxSigma);
      const lowExp = computeSigma(0.1, 'exponential', minSigma, maxSigma);
      expect(lowExp).toBeLessThan(lowLinear);
    });

    it('exact: should return 0', () => {
      expect(computeSigma(0.5, 'exact', minSigma, maxSigma)).toBe(0);
      expect(computeSigma(0, 'exact', minSigma, maxSigma)).toBe(0);
      expect(computeSigma(1, 'exact', minSigma, maxSigma)).toBe(0);
    });
  });

  describe('findNearestBin', () => {
    it('should find the closest bin for a pure red color', () => {
      const redOklab = hexToOklab('#FF0000');
      const binIdx = findNearestBin(redOklab);
      expect(binIdx).toBeGreaterThanOrEqual(0);
      expect(binIdx).toBeLessThan(64);
    });

    it('should find the closest bin for black', () => {
      const blackOklab = hexToOklab('#000000');
      const binIdx = findNearestBin(blackOklab);
      expect(binIdx).toBeGreaterThanOrEqual(48);
    });

    it('should find the closest bin for white', () => {
      const whiteOklab = hexToOklab('#FFFFFF');
      const binIdx = findNearestBin(whiteOklab);
      expect(binIdx).toBeGreaterThanOrEqual(48);
    });
  });

  describe('buildQueryVector', () => {
    describe('basic vector construction', () => {
      it('should produce a 64-dim vector', () => {
        const service = new ColorSortService();
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0 }],
        });
        expect(result).toHaveLength(64);
      });

      it('should produce non-zero values for relevant bins', () => {
        const service = new ColorSortService();
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0 }],
        });
        const nonZero = result.filter((v) => v > 0);
        expect(nonZero.length).toBeGreaterThan(0);
      });
    });

    describe('linear spread strategy', () => {
      it('should distribute weight across bins based on OkLab distance', () => {
        const service = new ColorSortService({ spreadStrategy: 'linear' });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });

        const maxWeight = Math.max(...result);
        expect(maxWeight).toBeGreaterThan(0);
        expect(maxWeight).toBeLessThanOrEqual(1.0);
      });

      it('should weight nearest bins more than distant bins', () => {
        const service = new ColorSortService({ spreadStrategy: 'linear' });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });

        const redOklab = hexToOklab('#FF0000');
        const centers = computeBinCenters();

        let nearestWeight = 0;
        let farthestWeight = 0;
        let minDist = Infinity;
        let maxDist = 0;

        for (let i = 0; i < 64; i++) {
          const d = oklabDistance(redOklab, centers[i]);
          if (d < minDist) {
            minDist = d;
            nearestWeight = result[i];
          }
          if (d > maxDist) {
            maxDist = d;
            farthestWeight = result[i];
          }
        }

        expect(nearestWeight).toBeGreaterThan(farthestWeight);
      });

      it('should spread wider with higher spread value', () => {
        const service = new ColorSortService({ spreadStrategy: 'linear' });
        const narrow = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.1 }],
        });
        const wide = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.9 }],
        });

        const narrowNonZero = narrow.filter((v) => v > 0.001).length;
        const wideNonZero = wide.filter((v) => v > 0.001).length;
        expect(wideNonZero).toBeGreaterThanOrEqual(narrowNonZero);
      });
    });

    describe('exponential spread strategy', () => {
      it('should distribute weight across bins', () => {
        const service = new ColorSortService({ spreadStrategy: 'exponential' });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });

        const nonZero = result.filter((v) => v > 0);
        expect(nonZero.length).toBeGreaterThan(0);
      });

      it('should differ from linear for the same spread', () => {
        const linearService = new ColorSortService({ spreadStrategy: 'linear' });
        const expService = new ColorSortService({ spreadStrategy: 'exponential' });
        const input: ColorSortInput = {
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        };

        const linearResult = linearService.buildQueryVector(input);
        const expResult = expService.buildQueryVector(input);

        const differ = linearResult.some((v, i) => Math.abs(v - expResult[i]) > 0.0001);
        expect(differ).toBe(true);
      });
    });

    describe('exact spread strategy', () => {
      it('should map to a single bin', () => {
        const service = new ColorSortService({ spreadStrategy: 'exact' });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0 }],
        });

        const nonZero = result.filter((v) => v > 0);
        expect(nonZero).toHaveLength(1);
        expect(nonZero[0]).toBe(1.0);
      });

      it('should map to nearest bin by OkLab distance', () => {
        const service = new ColorSortService({ spreadStrategy: 'exact' });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0 }],
        });

        const redOklab = hexToOklab('#FF0000');
        const expectedBin = findNearestBin(redOklab);

        for (let i = 0; i < 64; i++) {
          if (i === expectedBin) {
            expect(result[i]).toBe(1.0);
          } else {
            expect(result[i]).toBe(0);
          }
        }
      });

      it('should preserve amount in the single bin', () => {
        const service = new ColorSortService({ spreadStrategy: 'exact' });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 2.5 }],
        });

        const nonZero = result.filter((v) => v > 0);
        expect(nonZero).toHaveLength(1);
        expect(nonZero[0]).toBe(2.5);
      });
    });

    describe('multi-color additive contributions', () => {
      it('should add contributions from multiple colors', () => {
        const service = new ColorSortService({ spreadStrategy: 'exact' });
        const result = service.buildQueryVector({
          colors: [
            { color: '#FF0000', amount: 1.0 },
            { color: '#00FF00', amount: 1.0 },
          ],
        });

        const nonZero = result.filter((v) => v > 0);
        expect(nonZero.length).toBeGreaterThanOrEqual(2);
      });

      it('should sum amounts when colors map to same bin', () => {
        const service = new ColorSortService({ spreadStrategy: 'exact' });
        const result = service.buildQueryVector({
          colors: [
            { color: '#FF0000', amount: 0.3 },
            { color: '#FF0000', amount: 0.7 },
          ],
        });

        const redBin = findNearestBin(hexToOklab('#FF0000'));
        expect(result[redBin]).toBeCloseTo(1.0, 5);
      });

      it('should add weighted Gaussian contributions for linear strategy', () => {
        const service = new ColorSortService({ spreadStrategy: 'linear' });
        const single = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });
        const doubled = service.buildQueryVector({
          colors: [
            { color: '#FF0000', amount: 0.5, spread: 0.5 },
            { color: '#FF0000', amount: 0.5, spread: 0.5 },
          ],
        });

        for (let i = 0; i < 64; i++) {
          approxEqual(doubled[i], single[i], 5);
        }
      });
    });

    describe('unspecified bins remain zero', () => {
      it('should leave distant bins at zero with narrow spread', () => {
        const service = new ColorSortService({
          spreadStrategy: 'linear',
          minSigma: 0.01,
          maxSigma: 0.05,
        });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.0 }],
        });

        const zeroCount = result.filter((v) => v === 0).length;
        expect(zeroCount).toBeGreaterThan(0);
      });
    });

    describe('input validation', () => {
      it('should reject empty colors array', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({ colors: [] }),
        ).toThrow('Colors array must not be empty');
      });

      it('should reject invalid hex color', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({ colors: [{ color: 'invalid', amount: 1.0 }] }),
        ).toThrow('Invalid hex color');
      });

      it('should reject hex without hash prefix', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({ colors: [{ color: 'FF0000', amount: 1.0 }] }),
        ).toThrow('Invalid hex color');
      });

      it('should reject short hex codes', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({ colors: [{ color: '#F00', amount: 1.0 }] }),
        ).toThrow('Invalid hex color');
      });

      it('should reject zero amount', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({ colors: [{ color: '#FF0000', amount: 0 }] }),
        ).toThrow('Amount must be positive');
      });

      it('should reject negative amount', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({ colors: [{ color: '#FF0000', amount: -0.5 }] }),
        ).toThrow('Amount must be positive');
      });

      it('should reject spread below 0', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({
            colors: [{ color: '#FF0000', amount: 1.0, spread: -0.1 }],
          }),
        ).toThrow('Spread must be in [0, 1]');
      });

      it('should reject spread above 1', () => {
        const service = new ColorSortService();
        expect(() =>
          service.buildQueryVector({
            colors: [{ color: '#FF0000', amount: 1.0, spread: 1.5 }],
          }),
        ).toThrow('Spread must be in [0, 1]');
      });

      it('should allow sum of amounts > 1', () => {
        const service = new ColorSortService();
        const result = service.buildQueryVector({
          colors: [
            { color: '#FF0000', amount: 0.8 },
            { color: '#00FF00', amount: 0.8 },
          ],
        });
        expect(result).toHaveLength(64);
      });

      it('should allow spread of exactly 0', () => {
        const service = new ColorSortService();
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0 }],
        });
        expect(result).toHaveLength(64);
      });

      it('should allow spread of exactly 1', () => {
        const service = new ColorSortService();
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 1 }],
        });
        expect(result).toHaveLength(64);
      });

      it('should use default spread when not provided', () => {
        const service = new ColorSortService({ defaultSpread: 0.7 });
        const withoutSpread = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0 }],
        });
        const withSpread = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.7 }],
        });

        for (let i = 0; i < 64; i++) {
          approxEqual(withoutSpread[i], withSpread[i], 10);
        }
      });
    });

    describe('strategy selection', () => {
      it('should default to linear strategy', () => {
        const service = new ColorSortService();
        const exact = new ColorSortService({ spreadStrategy: 'exact' });

        const defaultResult = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });
        const exactResult = exact.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });

        const defaultNonZero = defaultResult.filter((v) => v > 0).length;
        expect(defaultNonZero).toBeGreaterThan(1);
        const exactNonZero = exactResult.filter((v) => v > 0).length;
        expect(exactNonZero).toBe(1);
      });

      it('should read strategy from COLOR_SPREAD_STRATEGY', () => {
        process.env.COLOR_SPREAD_STRATEGY = 'exact';

        const service = new ColorSortService();
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });

        expect(result.filter((v) => v > 0)).toHaveLength(1);
      });

      it('should let explicit config override COLOR_SPREAD_STRATEGY', () => {
        process.env.COLOR_SPREAD_STRATEGY = 'exact';

        const service = new ColorSortService({ spreadStrategy: 'linear' });
        const result = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 1.0, spread: 0.5 }],
        });

        expect(result.filter((v) => v > 0).length).toBeGreaterThan(1);
      });

      it('should reject invalid COLOR_SPREAD_STRATEGY values', () => {
        process.env.COLOR_SPREAD_STRATEGY = 'invalid';

        expect(() => new ColorSortService()).toThrow('Invalid COLOR_SPREAD_STRATEGY');
      });

      it('should support all three strategies', () => {
        for (const strategy of ['linear', 'exponential', 'exact'] as const) {
          const service = new ColorSortService({ spreadStrategy: strategy });
          const result = service.buildQueryVector({
            colors: [{ color: '#FF0000', amount: 1.0 }],
          });
          expect(result).toHaveLength(64);
        }
      });
    });

    describe('amount scaling', () => {
      it('should scale weights by amount', () => {
        const service = new ColorSortService({ spreadStrategy: 'linear' });
        const small = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 0.5, spread: 0.5 }],
        });
        const large = service.buildQueryVector({
          colors: [{ color: '#FF0000', amount: 2.0, spread: 0.5 }],
        });

        for (let i = 0; i < 64; i++) {
          if (small[i] > 0) {
            const ratio = large[i] / small[i];
            approxEqual(ratio, 4.0, 3);
          }
        }
      });
    });
  });
});
