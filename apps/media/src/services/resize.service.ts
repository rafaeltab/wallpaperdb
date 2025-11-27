import { injectable } from "tsyringe";
import { withSpanSync, Attributes, recordCounter, recordHistogram } from "@wallpaperdb/core/telemetry";
import sharp from "sharp";
import type { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ResizeOptions {
	width?: number;
	height?: number;
	fit: "contain" | "cover" | "fill";
	mimeType: string;
}

/**
 * Service for resizing images using Sharp.
 * Uses streaming transformations for memory efficiency.
 */
@injectable()
export class ResizeService {
	/**
	 * Resize an image stream.
	 * Returns a readable stream of the transformed image.
	 * Uses Sharp's streaming mode for memory-efficient processing.
	 */
	async resizeImage(
		inputStream: Readable,
		options: ResizeOptions,
	): Promise<Readable> {
		return withSpanSync(
			"media.resize.setup_pipeline",
			{
				[Attributes.RESIZE_WIDTH]: options.width,
				[Attributes.RESIZE_HEIGHT]: options.height,
				[Attributes.RESIZE_FIT_MODE]: options.fit,
				[Attributes.FILE_MIME_TYPE]: options.mimeType,
			},
			(span) => {
				const startTime = Date.now();

				// Create Sharp transformer with limits for decompression bomb protection
				const transformer = sharp({
					limitInputPixels: 268402689, // 16384 x 16384 pixels
					sequentialRead: true, // Memory efficient
					failOnError: false, // Graceful degradation
				});

				// Apply resize if width or height is specified
				if (options.width || options.height) {
					// Map fit modes to Sharp's fit options
					if (options.fit === "contain") {
						transformer.resize(options.width, options.height, {
							fit: sharp.fit.inside, // Fit within dimensions, preserve aspect
							withoutEnlargement: true, // Never upscale
						});
					} else if (options.fit === "cover") {
						transformer.resize(options.width, options.height, {
							fit: sharp.fit.cover, // Fill dimensions completely, crop excess
							position: sharp.strategy.entropy, // Smart cropping
							withoutEnlargement: true, // Never upscale
						});
					} else if (options.fit === "fill") {
						transformer.resize(options.width, options.height, {
							fit: sharp.fit.fill, // Stretch to exact dimensions (distort if needed)
							// Note: No withoutEnlargement for fill mode - user wants exact dimensions
						});
					}
				}

				// Apply format-specific encoding
				if (options.mimeType === "image/jpeg") {
					transformer.jpeg({ quality: 90, progressive: true });
					span.setAttribute(Attributes.IMAGE_FORMAT, "jpeg");
					span.setAttribute(Attributes.IMAGE_QUALITY, 90);
				} else if (options.mimeType === "image/png") {
					transformer.png({ compressionLevel: 6 });
					span.setAttribute(Attributes.IMAGE_FORMAT, "png");
				} else if (options.mimeType === "image/webp") {
					transformer.webp({ quality: 90 });
					span.setAttribute(Attributes.IMAGE_FORMAT, "webp");
					span.setAttribute(Attributes.IMAGE_QUALITY, 90);
				}

				// Create output stream
				const outputStream = new PassThrough();

				// Setup duration metric
				const setupDurationMs = Date.now() - startTime;
				recordHistogram("media.resize.setup_duration_ms", setupDurationMs, {
					[Attributes.RESIZE_FIT_MODE]: options.fit,
					[Attributes.IMAGE_FORMAT]: options.mimeType.split("/")[1],
				});

				// Pipe input → transformer → output (non-blocking)
				// Track pipeline errors but don't block return
				pipeline(inputStream, transformer, outputStream).catch((error) => {
					recordCounter("media.resize.pipeline.errors", 1, {
						error_type: error.constructor.name,
					});
					console.error("Sharp pipeline error:", error);
				});

				return outputStream;
			},
		);
	}
}
