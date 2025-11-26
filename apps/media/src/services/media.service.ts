import { GetObjectCommand } from "@aws-sdk/client-s3";
import { inject, injectable } from "tsyringe";
import type { Readable } from "node:stream";
import { MinioConnection } from "../connections/minio.js";
import { WallpaperRepository } from "../repositories/wallpaper.repository.js";

/**
 * Service for retrieving wallpaper files from object storage.
 */
@injectable()
export class MediaService {
	constructor(
		@inject(WallpaperRepository) private readonly repository: WallpaperRepository,
		@inject(MinioConnection) private readonly minio: MinioConnection,
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
}
