import { GetObjectCommand } from "@aws-sdk/client-s3";
import { inject, injectable } from "tsyringe";
import type { Readable } from "node:stream";
import { MinioConnection } from "../connections/minio.js";
import { WallpaperRepository } from "../repositories/wallpaper.repository.js";
import { ResizeService } from "./resize.service.js";
import { VariantSelectorService } from "./variant-selector.service.js";

/**
 * Service for retrieving wallpaper files from object storage.
 */
@injectable()
export class MediaService {
	constructor(
		@inject(WallpaperRepository) private readonly repository: WallpaperRepository,
		@inject(MinioConnection) private readonly minio: MinioConnection,
		@inject(ResizeService) private readonly resizeService: ResizeService,
		@inject(VariantSelectorService)
		private readonly variantSelector: VariantSelectorService,
	) {}

	/**
	 * Get wallpaper file stream and metadata.
	 *
	 * @param id - The wallpaper ID
	 * @returns Object containing file stream, mime type, and file size, or null if not found
	 */
	async getWallpaper(id: string): Promise<{
		stream: Readable;
		mimeType: string;
		fileSizeBytes: number;
	} | null> {
		// Query database for wallpaper metadata
		const wallpaper = await this.repository.findById(id);

		if (!wallpaper) {
			return null; // Wallpaper not found in database
		}

		try {
			// Get file from MinIO
			const command = new GetObjectCommand({
				Bucket: wallpaper.storageBucket,
				Key: wallpaper.storageKey,
			});

			const response = await this.minio.getClient().send(command);

			if (!response.Body) {
				throw new Error("MinIO returned no body");
			}

			return {
				stream: response.Body as Readable,
				mimeType: wallpaper.mimeType,
				fileSizeBytes: wallpaper.fileSizeBytes,
			};
		} catch (error) {
			// File not found in MinIO (or other S3 error)
			console.error(`Failed to retrieve file from MinIO for wallpaper ${id}:`, error);
			return null;
		}
	}

	/**
	 * Get wallpaper file stream with optional resizing.
	 *
	 * @param id - The wallpaper ID
	 * @param options - Resize options (width, height, fit mode)
	 * @returns Object containing file stream and mime type, or null if not found
	 * Note: No fileSizeBytes for resized images (unknown until streamed)
	 */
	async getWallpaperResized(
		id: string,
		options?: {
			width?: number;
			height?: number;
			fit: "contain" | "cover" | "fill";
		},
	): Promise<{
		stream: Readable;
		mimeType: string;
		fileSizeBytes?: number;
	} | null> {
		// Query database for wallpaper metadata
		const wallpaper = await this.repository.findById(id);

		if (!wallpaper) {
			return null; // Wallpaper not found in database
		}

		// Select best source (original or variant) for resize operation
		const selection = await this.variantSelector.selectSource(wallpaper, options);

		try {
			// Get file from MinIO using selected source
			const command = new GetObjectCommand({
				Bucket: selection.storageBucket,
				Key: selection.storageKey,
			});

			const response = await this.minio.getClient().send(command);

			if (!response.Body) {
				throw new Error("MinIO returned no body");
			}

			const inputStream = response.Body as Readable;

			// If resize requested, apply transformation
			if (options?.width || options?.height) {
				const resizedStream = await this.resizeService.resizeImage(inputStream, {
					width: options.width,
					height: options.height,
					fit: options.fit || "contain",
					mimeType: selection.mimeType,
				});

				return {
					stream: resizedStream,
					mimeType: selection.mimeType,
					// No fileSizeBytes for resized images (streaming, unknown size)
				};
			}

			// No resize, return original
			return {
				stream: inputStream,
				mimeType: selection.mimeType,
				fileSizeBytes: wallpaper.fileSizeBytes,
			};
		} catch (error) {
			// Variant file might be missing from MinIO - fallback to original
			if (selection.source === "variant") {
				console.warn(
					`Variant ${selection.variantId} file missing from MinIO, falling back to original`,
				);

				// Retry with original
				try {
					const command = new GetObjectCommand({
						Bucket: wallpaper.storageBucket,
						Key: wallpaper.storageKey,
					});

					const response = await this.minio.getClient().send(command);

					if (!response.Body) {
						throw new Error("MinIO returned no body");
					}

					const inputStream = response.Body as Readable;

					// Apply resize if requested
					if (options?.width || options?.height) {
						const resizedStream = await this.resizeService.resizeImage(
							inputStream,
							{
								width: options.width,
								height: options.height,
								fit: options.fit || "contain",
								mimeType: wallpaper.mimeType,
							},
						);

						return {
							stream: resizedStream,
							mimeType: wallpaper.mimeType,
						};
					}

					return {
						stream: inputStream,
						mimeType: wallpaper.mimeType,
						fileSizeBytes: wallpaper.fileSizeBytes,
					};
				} catch (fallbackError) {
					console.error(
						`Failed to retrieve original file from MinIO for wallpaper ${id}:`,
						fallbackError,
					);
					return null;
				}
			}

			// File not found in MinIO (or other S3 error)
			console.error(`Failed to retrieve file from MinIO for wallpaper ${id}:`, error);
			return null;
		}
	}
}
