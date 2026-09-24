import { Context, Effect, Layer, Schema } from 'effect';
import { HsvEmbeddingStrategy } from './histogram.js';

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
        yield* events.publish({ input, histogram, colorSpace: 'hsv' });
        return { _tag: 'Extracted' } as const;
      }),
    });
  })
);

/** Alpha-weighted 64-bin distribution; pure domain calculation with no dependencies. */
export function computeHistogram(rgbaPixels: Uint8Array): number[] {
  return new HsvEmbeddingStrategy().computeHistogram(rgbaPixels);
}
