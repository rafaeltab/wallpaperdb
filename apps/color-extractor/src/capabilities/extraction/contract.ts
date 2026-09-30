import { Context, type Effect, Schema } from 'effect';

export type OriginalImage =
  | { readonly owner: 'ingestor'; readonly id: string; readonly mimeType: string }
  | { readonly bucket: string; readonly key: string };

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

export interface ColorMeasurements {
  readonly version: 'shade-hue-256-v1';
  readonly sampleCount: 16384;
  readonly layers: readonly {
    readonly cutoff: number;
    readonly coverage: readonly number[];
    readonly quality: readonly number[];
  }[];
  readonly named: Readonly<Record<string, { readonly coverage: number; readonly quality: number }>>;
}
export interface MeasuredImage {
  readonly measurements: ColorMeasurements;
  readonly originalSha256: string;
}

export interface ImageMeasurements {
  extract(storage: OriginalImage): Effect.Effect<MeasuredImage, ExtractionUnavailable>;
}
export const ImageMeasurements = Context.Service<ImageMeasurements>(
  'wallpaperdb.color-extractor.extraction.ImageMeasurements'
);

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
