import { Clock, Context, Effect, Layer, Metric, Schema } from 'effect';
export const ASPECT_RATIO_CATEGORIES = {
  ultrawide: { ratio: 21 / 9, tolerance: 0.1 },
  standard: { ratio: 16 / 9, tolerance: 0.15 },
  phone: { ratio: 9 / 18, tolerance: 0.25 },
} as const;

export type AspectRatioCategory = keyof typeof ASPECT_RATIO_CATEGORIES;

/**
 * Resolution preset definition
 */
export interface ResolutionPreset {
  width: number;
  height: number;
  label: string;
}

/**
 * Resolution presets grouped by aspect ratio category.
 * Only presets smaller than the original will be generated.
 */
export const RESOLUTION_PRESETS: Record<AspectRatioCategory, ResolutionPreset[]> = {
  // Standard (16:9) - monitors and TVs
  standard: [
    { width: 3840, height: 2160, label: '4K' },
    { width: 2560, height: 1440, label: '2K/1440p' },
    { width: 1920, height: 1080, label: '1080p' },
    { width: 1600, height: 900, label: '900p' },
    { width: 1280, height: 720, label: '720p' },
    { width: 854, height: 480, label: '480p' },
    { width: 640, height: 360, label: '360p' },
  ],

  // Ultrawide (21:9) - gaming monitors
  ultrawide: [
    { width: 5120, height: 2160, label: '5K Ultrawide' },
    { width: 3440, height: 1440, label: 'UWQHD' },
    { width: 2560, height: 1080, label: 'UWFHD' },
  ],

  // Phone (9:16 and taller) - mobile devices
  phone: [
    { width: 1440, height: 3200, label: 'QHD+ Phone' },
    { width: 1080, height: 2400, label: 'FHD+ Phone' },
    { width: 1080, height: 1920, label: 'FHD Phone' },
    { width: 720, height: 1280, label: 'HD Phone' },
    { width: 480, height: 854, label: 'SD Phone' },
  ],
};

/** Match categories in their declared precedence, including the boundary tolerance. */
export function matchAspectRatioCategory(
  width: number,
  height: number
): AspectRatioCategory | null {
  const ratio = width / height;
  for (const category of ['ultrawide', 'standard', 'phone'] as const) {
    const config = ASPECT_RATIO_CATEGORIES[category];
    if (Math.abs(ratio - config.ratio) <= config.ratio * config.tolerance) return category;
  }
  return null;
}

export function getApplicablePresets(width: number, height: number): ResolutionPreset[] {
  const category = matchAspectRatioCategory(width, height);
  return category === null
    ? []
    : RESOLUTION_PRESETS[category].filter(
        (preset) => preset.width < width && preset.height < height
      );
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
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly format: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly fileSizeBytes: number;
  readonly storageKey: string;
  readonly storageBucket: string;
  readonly createdAt: Date;
}

/** A rendition keeps one public identity independently of its storage provider and encoding policy. */
export function variantAssetReference(
  variant: Pick<GeneratedVariant, 'wallpaperId' | 'width' | 'height' | 'format'>
) {
  return {
    owner: 'variant-generator' as const,
    id: `${variant.wallpaperId}:${variant.width}x${variant.height}:${variant.format}`,
  };
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
 * persist the input timestamp; legacy targets retain the input timestamp fallback.
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

export const generationLayer = Layer.effect(
  GenerateVariants,
  Effect.gen(function* () {
    const images = yield* VariantImages;
    const events = yield* VariantEvents;
    return GenerateVariants.of({
      generate: Effect.fn('variant-generation.generate')(function* (input: GenerationInput) {
        if (input.fileType !== 'image') {
          yield* count('skipped', { reason: 'not_image' });
          return { _tag: 'Skipped', reason: 'not_image' } as const;
        }
        const category = matchAspectRatioCategory(input.width, input.height);
        yield* category === null
          ? count('aspect_ratio_no_match', {
              aspect_ratio: (input.width / input.height).toFixed(2),
            })
          : count('aspect_ratio_matches', { category });
        const presets = getApplicablePresets(input.width, input.height);
        if (category !== null) yield* count('presets_selected', { category }, presets.length);
        if (presets.length === 0) {
          yield* count('skipped', { reason: 'no_presets' });
          return { _tag: 'Skipped', reason: 'no_presets' } as const;
        }
        const start = yield* Clock.currentTimeMillis;

        const variants: GeneratedVariant[] = [];
        const failures: GenerationUnavailable[] = [];
        for (const preset of presets) {
          yield* Effect.gen(function* () {
            const variant = yield* images.generate(input, preset);
            yield* events.publish({ input, variant });
            variants.push(variant);
            yield* count('variant_generated', {
              preset_label: preset.label,
              format: input.mimeType,
            });
          }).pipe(
            Effect.catchTag('GenerationUnavailable', (failure) =>
              Effect.gen(function* () {
                failures.push(failure);
                yield* count('variant_failed', {
                  preset_label: preset.label,
                  format: input.mimeType,
                });
              })
            )
          );
        }
        const end = yield* Clock.currentTimeMillis;
        yield* Metric.update(
          Metric.histogram('variant_generator.batch_duration_ms', {
            boundaries: [10, 50, 100, 500, 1000, 5000, 10000, 30000, 60000, 120000],
            attributes: { presets_count: presets.length.toString() },
          }),
          end - start
        );
        if (failures.length > 0) return yield* Effect.fail(failures[0]);
        return { _tag: 'Generated', variants } as const;
      }),
    });
  })
);

function count(name: string, attributes: Record<string, string>, value = 1) {
  return Metric.update(
    Metric.counter(`variant_generator.${name}`, { incremental: true, attributes }),
    value
  );
}
