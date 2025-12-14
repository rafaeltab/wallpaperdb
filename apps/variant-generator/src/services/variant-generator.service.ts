import { injectable, inject } from 'tsyringe';
import {
  withSpan,
  withSpanSync,
  Attributes,
  recordCounter,
  recordHistogram,
} from '@wallpaperdb/core/telemetry';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';
import { MinioConnection } from '../connections/minio.js';
import { ResolutionMatcherService } from './resolution-matcher.service.js';
import { EventsService, type GeneratedVariant } from './events.service.js';
import type { Config, ResolutionPreset } from '../config.js';

/**
 * Service for generating wallpaper variants at different resolutions.
 *
 * Orchestrates the variant generation flow:
 * 1. Determine applicable resolution presets based on aspect ratio
 * 2. Download original file from MinIO
 * 3. Generate variants using Sharp (streaming for memory efficiency)
 * 4. Upload variants to MinIO
 * 5. Publish wallpaper.variant.uploaded events
 */
@injectable()
export class VariantGeneratorService {
  constructor(
    @inject(MinioConnection) private readonly minio: MinioConnection,
    @inject(ResolutionMatcherService) private readonly resolutionMatcher: ResolutionMatcherService,
    @inject(EventsService) private readonly events: EventsService,
    @inject('config') private readonly config: Config
  ) {}

  /**
   * Generate all applicable variants for a wallpaper.
   *
   * @param wallpaper - The wallpaper.uploaded event data
   * @returns Array of generated variant metadata
   */
  async generateVariants(wallpaper: WallpaperUploadedEvent['wallpaper']): Promise<GeneratedVariant[]> {
    return await withSpan(
      'variant-generator.generate_all',
      {
        [Attributes.WALLPAPER_ID]: wallpaper.id,
        [Attributes.FILE_WIDTH]: wallpaper.width,
        [Attributes.FILE_HEIGHT]: wallpaper.height,
        [Attributes.FILE_MIME_TYPE]: wallpaper.mimeType,
      },
      async (span) => {
        // Skip non-image files
        if (wallpaper.fileType !== 'image') {
          span.setAttribute('skip_reason', 'not_image');
          recordCounter('variant_generator.skipped', 1, { reason: 'not_image' });
          return [];
        }

        // Get applicable presets
        const presets = this.resolutionMatcher.getApplicablePresets(
          wallpaper.width,
          wallpaper.height
        );

        if (presets.length === 0) {
          span.setAttribute('skip_reason', 'no_applicable_presets');
          recordCounter('variant_generator.skipped', 1, { reason: 'no_presets' });
          return [];
        }

        span.setAttribute('presets_count', presets.length);

        const startTime = Date.now();
        const generatedVariants: GeneratedVariant[] = [];

        // Generate each variant sequentially to avoid memory pressure
        for (const preset of presets) {
          try {
            const variant = await this.generateSingleVariant(wallpaper, preset);
            generatedVariants.push(variant);

            // Publish event for this variant
            await this.events.publishVariantUploaded(variant);

            recordCounter('variant_generator.variant_generated', 1, {
              preset_label: preset.label,
              format: wallpaper.mimeType,
            });
          } catch (error) {
            console.error(
              `[VariantGenerator] Failed to generate variant ${preset.label} for ${wallpaper.id}:`,
              error
            );
            recordCounter('variant_generator.variant_failed', 1, {
              preset_label: preset.label,
              format: wallpaper.mimeType,
            });
            // Continue with other variants - don't fail the whole batch
          }
        }

        const durationMs = Date.now() - startTime;
        span.setAttribute('generated_count', generatedVariants.length);
        span.setAttribute('duration_ms', durationMs);

        recordHistogram('variant_generator.batch_duration_ms', durationMs, {
          presets_count: presets.length.toString(),
        });

        return generatedVariants;
      }
    );
  }

  /**
   * Generate a single variant at the specified resolution.
   *
   * Uses Sharp streaming for memory-efficient processing:
   * 1. Stream original from MinIO
   * 2. Pipe through Sharp transformer
   * 3. Collect in memory buffer (necessary for file size calculation)
   * 4. Upload to MinIO
   *
   * @param wallpaper - The wallpaper metadata
   * @param preset - The target resolution preset
   * @returns Generated variant metadata
   */
  private async generateSingleVariant(
    wallpaper: WallpaperUploadedEvent['wallpaper'],
    preset: ResolutionPreset
  ): Promise<GeneratedVariant> {
    return await withSpan(
      'variant-generator.generate_single',
      {
        [Attributes.WALLPAPER_ID]: wallpaper.id,
        [Attributes.RESIZE_WIDTH]: preset.width,
        [Attributes.RESIZE_HEIGHT]: preset.height,
        preset_label: preset.label,
      },
      async (span) => {
        const startTime = Date.now();

        // Determine file extension from mime type
        const extension = this.getExtensionFromMimeType(wallpaper.mimeType);
        const storageKey = `${wallpaper.id}/variant_${preset.width}x${preset.height}.${extension}`;

        // Download original from MinIO
        const getCommand = new GetObjectCommand({
          Bucket: wallpaper.storageBucket,
          Key: wallpaper.storageKey,
        });
        const response = await this.minio.getClient().send(getCommand);

        if (!response.Body) {
          throw new Error(`Failed to download original file: ${wallpaper.storageKey}`);
        }

        const originalStream = response.Body as Readable;

        // Create Sharp transformer
        const transformer = this.createTransformer(wallpaper.mimeType, preset);

        // Process image and collect into buffer
        const chunks: Buffer[] = [];
        const outputStream = new PassThrough();

        outputStream.on('data', (chunk) => {
          chunks.push(chunk);
        });

        // Pipe: original → Sharp → output
        await pipeline(originalStream, transformer, outputStream);

        const buffer = Buffer.concat(chunks);
        const fileSizeBytes = buffer.length;

        span.setAttribute('output_size_bytes', fileSizeBytes);

        // Upload to MinIO
        const putCommand = new PutObjectCommand({
          Bucket: wallpaper.storageBucket,
          Key: storageKey,
          Body: buffer,
          ContentType: wallpaper.mimeType,
        });
        await this.minio.getClient().send(putCommand);

        const durationMs = Date.now() - startTime;
        span.setAttribute('duration_ms', durationMs);

        recordHistogram('variant_generator.single_duration_ms', durationMs, {
          preset_label: preset.label,
          format: extension,
        });

        return {
          wallpaperId: wallpaper.id,
          width: preset.width,
          height: preset.height,
          aspectRatio: preset.width / preset.height,
          format: wallpaper.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
          fileSizeBytes,
          storageKey,
          storageBucket: wallpaper.storageBucket,
          createdAt: new Date(),
        };
      }
    );
  }

  /**
   * Create a Sharp transformer configured for the target resolution and format.
   */
  private createTransformer(mimeType: string, preset: ResolutionPreset): sharp.Sharp {
    return withSpanSync(
      'variant-generator.create_transformer',
      {
        [Attributes.RESIZE_WIDTH]: preset.width,
        [Attributes.RESIZE_HEIGHT]: preset.height,
        [Attributes.FILE_MIME_TYPE]: mimeType,
      },
      (span) => {
        // Create Sharp instance with safety limits
        const transformer = sharp({
          limitInputPixels: 268402689, // 16384 x 16384 pixels
          sequentialRead: true, // Memory efficient
          failOnError: false, // Graceful degradation
        });

        // Configure resize - fit inside dimensions, preserve aspect ratio
        transformer.resize(preset.width, preset.height, {
          fit: sharp.fit.inside,
          withoutEnlargement: true,
        });

        // Apply format-specific encoding
        if (mimeType === 'image/jpeg') {
          transformer.jpeg({ quality: this.config.jpegQuality, progressive: true });
          span.setAttribute(Attributes.IMAGE_FORMAT, 'jpeg');
          span.setAttribute(Attributes.IMAGE_QUALITY, this.config.jpegQuality);
        } else if (mimeType === 'image/png') {
          transformer.png({ compressionLevel: this.config.pngCompressionLevel });
          span.setAttribute(Attributes.IMAGE_FORMAT, 'png');
          span.setAttribute('compression_level', this.config.pngCompressionLevel);
        } else if (mimeType === 'image/webp') {
          transformer.webp({ quality: this.config.webpQuality });
          span.setAttribute(Attributes.IMAGE_FORMAT, 'webp');
          span.setAttribute(Attributes.IMAGE_QUALITY, this.config.webpQuality);
        }

        return transformer;
      }
    );
  }

  /**
   * Get file extension from MIME type.
   */
  private getExtensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        return 'jpg'; // Fallback
    }
  }
}
