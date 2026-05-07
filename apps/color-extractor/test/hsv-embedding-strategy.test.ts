import { describe, it, expect } from "vitest";
import { HsvEmbeddingStrategy } from "../src/services/hsv-embedding-strategy";

describe("HsvEmbeddingStrategy", () => {
  const strategy = new HsvEmbeddingStrategy();

  describe("single pure red pixel", () => {
    it("produces a 64-dim normalized vector with weight in the correct chromatic bin", () => {
      const rgba = new Uint8Array([255, 0, 0, 255]);
      const result = strategy.computeHistogram(rgba);

      expect(result).toHaveLength(64);
      expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 10);

      const redBin = 0 * 4 + 1 * 2 + 1;
      expect(result[redBin]).toBeCloseTo(1.0, 10);

      for (let i = 0; i < 64; i++) {
        if (i !== redBin) {
          expect(result[i]).toBe(0);
        }
      }
    });
  });

  describe("all-black image", () => {
    it("classifies black pixels as achromatic in the lowest value bin", () => {
      const rgba = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]);
      const result = strategy.computeHistogram(rgba);

      expect(result).toHaveLength(64);
      expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 10);

      const blackBin = 48 + 0;
      expect(result[blackBin]).toBeCloseTo(1.0, 10);

      for (let i = 0; i < 64; i++) {
        if (i !== blackBin) {
          expect(result[i]).toBe(0);
        }
      }
    });
  });

  describe("all-white image", () => {
    it("classifies white pixels as achromatic in the highest value bin", () => {
      const rgba = new Uint8Array([255, 255, 255, 255]);
      const result = strategy.computeHistogram(rgba);

      expect(result).toHaveLength(64);
      expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 10);

      const whiteBin = 48 + 15;
      expect(result[whiteBin]).toBeCloseTo(1.0, 10);

      for (let i = 0; i < 64; i++) {
        if (i !== whiteBin) {
          expect(result[i]).toBe(0);
        }
      }
    });
  });

  describe("alpha weighting", () => {
    it("weights pixel contributions by alpha channel value", () => {
      const fullAlphaRed = new Uint8Array([255, 0, 0, 255]);
      const halfAlphaRed = new Uint8Array([255, 0, 0, 128]);
      const quarterAlphaBlue = new Uint8Array([0, 0, 255, 64]);

      const rgba = new Uint8Array([
        ...fullAlphaRed,
        ...halfAlphaRed,
        ...quarterAlphaBlue,
      ]);
      const result = strategy.computeHistogram(rgba);

      const redBin = 0 * 4 + 1 * 2 + 1;
      const blueBin = 8 * 4 + 1 * 2 + 1;

      const redWeight = 1.0 + 128 / 255;
      const blueWeight = 64 / 255;
      const total = redWeight + blueWeight;

      expect(result[redBin]).toBeCloseTo(redWeight / total, 10);
      expect(result[blueBin]).toBeCloseTo(blueWeight / total, 10);
      expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 10);
    });
  });

  describe("fully transparent image", () => {
    it("returns a zero vector when all pixels are fully transparent", () => {
      const rgba = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 0]);
      const result = strategy.computeHistogram(rgba);

      expect(result).toHaveLength(64);
      expect(result.every((v) => v === 0)).toBe(true);
    });
  });

  describe("chromatic color bin assignments", () => {
    const chromaticColors: Array<{
      name: string;
      rgba: number[];
      hueBin: number;
    }> = [
      { name: "green", rgba: [0, 255, 0, 255], hueBin: 4 },
      { name: "blue", rgba: [0, 0, 255, 255], hueBin: 8 },
      { name: "yellow", rgba: [255, 255, 0, 255], hueBin: 2 },
      { name: "cyan", rgba: [0, 255, 255, 255], hueBin: 6 },
      { name: "magenta", rgba: [255, 0, 255, 255], hueBin: 10 },
    ];

    for (const { name, rgba, hueBin } of chromaticColors) {
      it(`places pure ${name} in chromatic bin at hue index ${hueBin}`, () => {
        const result = strategy.computeHistogram(
          new Uint8Array(rgba),
        );

        const expectedBin = hueBin * 4 + 1 * 2 + 1;
        expect(result).toHaveLength(64);
        expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(
          1.0,
          10,
        );
        expect(result[expectedBin]).toBeCloseTo(1.0, 10);

        for (let i = 0; i < 64; i++) {
          if (i !== expectedBin) {
            expect(result[i]).toBe(0);
          }
        }
      });
    }
  });

  describe("achromatic gray", () => {
    it("classifies mid-gray as achromatic in a mid-range value bin", () => {
      const rgba = new Uint8Array([128, 128, 128, 255]);
      const result = strategy.computeHistogram(rgba);

      expect(result).toHaveLength(64);
      expect(result.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1.0, 10);

      const grayValue = 128 / 255;
      const expectedBin = 48 + Math.min(15, Math.floor(grayValue * 16));
      expect(result[expectedBin]).toBeCloseTo(1.0, 10);

      for (let i = 0; i < 64; i++) {
        if (i !== expectedBin) {
          expect(result[i]).toBe(0);
        }
      }
    });
  });
});
