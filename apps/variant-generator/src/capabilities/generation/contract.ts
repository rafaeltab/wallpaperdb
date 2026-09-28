import { Context, type Effect, Schema } from 'effect';

export type AspectRatioCategory = 'ultrawide' | 'standard' | 'phone';

/**
 * Resolution preset definition
 */
export interface ResolutionPreset {
  width: number;
  height: number;
  label: string;
}

export interface GenerationInput {
  readonly wallpaperId: string;
  readonly fileType: 'image' | 'video';
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly storage:
    | { readonly owner: 'ingestor'; readonly id: string }
    | { readonly bucket: string; readonly key: string };
  readonly occurrence: { readonly source: string; readonly id: string };
  readonly timestamp: string;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface GeneratedVariant {
  readonly wallpaperId: string;
  /** Stable preset bounds identify the rendition independently of its encoded pixels. */
  readonly target: { readonly width: number; readonly height: number };
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly format: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly fileSizeBytes: number;
  readonly storageKey: string;
  readonly storageBucket: string;
  readonly createdAt: Date;
}

export type GenerationOutcome =
  | { readonly _tag: 'Skipped'; readonly reason: 'not_image' | 'no_presets' }
  | { readonly _tag: 'Generated'; readonly variants: readonly GeneratedVariant[] };

export class GenerationUnavailable extends Schema.TaggedError<GenerationUnavailable>()(
  'GenerationUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}

/**
 * Generates and stores one variant under its stable target identity. Repeating a
 * request preserves the first stored target and its metadata across encoding-policy
 * changes and different occurrences of the same immutable original. New targets
 * persist exact encoded dimensions and the input timestamp. Legacy targets retain
 * their nominal preset dimensions and, when absent, the input timestamp fallback.
 * Interruption stops the underlying image and storage work before completing.
 */
export interface VariantImages {
  generate(
    input: GenerationInput,
    preset: ResolutionPreset
  ): Effect.Effect<GeneratedVariant, GenerationUnavailable>;
}

export const VariantImages = Context.Service<VariantImages>(
  'wallpaperdb.variant-generator.generation.VariantImages'
);

/** Publication completes after durable acceptance; retries reuse the event occurrence identity. */
export interface VariantEvents {
  publish(result: {
    readonly input: GenerationInput;
    readonly variant: GeneratedVariant;
  }): Effect.Effect<void, GenerationUnavailable>;
}

export const VariantEvents = Context.Service<VariantEvents>(
  'wallpaperdb.variant-generator.generation.VariantEvents'
);

export interface GenerateVariants {
  generate(input: GenerationInput): Effect.Effect<GenerationOutcome, GenerationUnavailable>;
}

export const GenerateVariants = Context.Service<GenerateVariants>(
  'wallpaperdb.variant-generator.generation.GenerateVariants'
);
