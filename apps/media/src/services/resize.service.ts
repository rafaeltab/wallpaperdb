import { injectable } from "tsyringe";
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
		} else if (options.mimeType === "image/png") {
			transformer.png({ compressionLevel: 6 });
		} else if (options.mimeType === "image/webp") {
			transformer.webp({ quality: 90 });
		}

		// Create output stream
		const outputStream = new PassThrough();

		// Pipe input → transformer → output (non-blocking)
		// Pipeline runs asynchronously - we return the stream immediately
		pipeline(inputStream, transformer, outputStream);

		return outputStream;
	}
}
