import { Context, Effect, Layer, Schema } from 'effect';

export interface OriginalImage {
  readonly bucket: string;
  readonly key: string;
}
export interface ExtractionInput {
  readonly wallpaperId: string;
  readonly fileType: 'image' | 'video';
  readonly storage: OriginalImage;
  readonly occurrence: { readonly source: string; readonly id: string };
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}
export type ExtractionOutcome = { readonly _tag: 'Extracted' } | { readonly _tag: 'Skipped' };
export class ExtractionUnavailable extends Schema.TaggedError<ExtractionUnavailable>()(
  'ExtractionUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}
export interface ImageHistogram {
  extract(storage: OriginalImage): Effect.Effect<readonly number[], ExtractionUnavailable>;
}
export const ImageHistogram = Context.Service<ImageHistogram>(
  'wallpaperdb.color-extractor.extraction.ImageHistogram'
);
export interface ExtractedColors {
  readonly input: ExtractionInput;
  readonly histogram: readonly number[];
  readonly colorSpace: 'hsv';
}
/** Completes only after the result is durably published; retries preserve occurrence identity. */
export interface ColorEvents {
  publish(result: ExtractedColors): Effect.Effect<void, ExtractionUnavailable>;
}
export const ColorEvents = Context.Service<ColorEvents>(
  'wallpaperdb.color-extractor.extraction.ColorEvents'
);
export interface ExtractColors {
  extract(input: ExtractionInput): Effect.Effect<ExtractionOutcome, ExtractionUnavailable>;
}
export const ExtractColors = Context.Service<ExtractColors>(
  'wallpaperdb.color-extractor.extraction.ExtractColors'
);
export const extractionLayer = Layer.effect(
  ExtractColors,
  Effect.gen(function* () {
    const images = yield* ImageHistogram;
    const events = yield* ColorEvents;
    return ExtractColors.of({
      extract: Effect.fn('color-extraction.extract')(function* (input: ExtractionInput) {
        if (input.fileType !== 'image') return { _tag: 'Skipped' } as const;
        const histogram = yield* images.extract(input.storage);
        if (histogram.every((weight) => weight === 0)) return { _tag: 'Skipped' } as const;
        yield* events.publish({ input, histogram, colorSpace: 'hsv' });
        return { _tag: 'Extracted' } as const;
      }),
    });
  })
);

const HUE_BINS = 12;
const SAT_BINS = 2;
const VAL_BINS = 2;
const CHROMATIC_BINS = HUE_BINS * SAT_BINS * VAL_BINS;
const ACHROMATIC_BINS = 16;
const TOTAL_BINS = CHROMATIC_BINS + ACHROMATIC_BINS;
const ACHROMATIC_SATURATION_THRESHOLD = 0.1;

export function computeHistogram(rgbaPixels: Uint8Array): number[] {
  const bins = new Float64Array(TOTAL_BINS);
  const pixelCount = rgbaPixels.length / 4;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = rgbaPixels[offset] / 255;
    const g = rgbaPixels[offset + 1] / 255;
    const b = rgbaPixels[offset + 2] / 255;
    const a = rgbaPixels[offset + 3] / 255;

    if (a === 0) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    const v = max;
    const s = max === 0 ? 0 : delta / max;

    if (s < ACHROMATIC_SATURATION_THRESHOLD) {
      const valBin = Math.min(ACHROMATIC_BINS - 1, Math.floor(v * ACHROMATIC_BINS));
      bins[CHROMATIC_BINS + valBin] += a;
    } else {
      const h = computeHue(r, g, b, max, delta);
      const hueBin = Math.min(HUE_BINS - 1, Math.floor(h / 30));
      const satBin = s < 0.5 ? 0 : 1;
      const valBin = v < 0.5 ? 0 : 1;
      const idx = hueBin * (SAT_BINS * VAL_BINS) + satBin * VAL_BINS + valBin;
      bins[idx] += a;
    }
  }

  return normalize(bins);
}

function computeHue(r: number, g: number, b: number, max: number, delta: number): number {
  let h: number;
  if (max === r) {
    h = ((g - b) / delta) * 60;
  } else if (max === g) {
    h = ((b - r) / delta + 2) * 60;
  } else {
    h = ((r - g) / delta + 4) * 60;
  }
  if (h < 0) h += 360;
  return h;
}

function normalize(bins: Float64Array): number[] {
  const total = bins.reduce((sum, v) => sum + v, 0);
  if (total === 0) return Array.from(bins);
  return Array.from(bins, (v) => v / total);
}
