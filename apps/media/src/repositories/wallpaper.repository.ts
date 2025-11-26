import { eq, sql } from "drizzle-orm";
import { inject, injectable } from "tsyringe";
import type { DatabaseClient } from "../connections/database.js";
import { DatabaseConnection } from "../connections/database.js";
import { wallpapers, type NewWallpaper, type Wallpaper } from "../db/schema.js";

/**
 * Repository for wallpaper data access operations.
 * Handles database CRUD operations for wallpapers.
 */
@injectable()
export class WallpaperRepository {
	private readonly db: DatabaseClient["db"];

	constructor(@inject(DatabaseConnection) dbConnection: DatabaseConnection) {
		this.db = dbConnection.getClient().db;
	}

	/**
	 * Insert or update wallpaper (idempotent operation).
	 * Uses UPSERT to handle duplicate events gracefully.
	 *
	 * @param wallpaper - The wallpaper data to insert/update
	 * @returns The inserted or updated wallpaper
	 */
	async upsert(wallpaper: NewWallpaper): Promise<Wallpaper> {
		const [result] = await this.db
			.insert(wallpapers)
			.values(wallpaper)
			.onConflictDoUpdate({
				target: wallpapers.id,
				set: {
					storageBucket: sql`excluded.storage_bucket`,
					storageKey: sql`excluded.storage_key`,
					mimeType: sql`excluded.mime_type`,
					width: sql`excluded.width`,
					height: sql`excluded.height`,
					fileSizeBytes: sql`excluded.file_size_bytes`,
				},
			})
			.returning();

		return result;
	}

	/**
	 * Find wallpaper by ID.
	 *
	 * @param id - The wallpaper ID
	 * @returns The wallpaper if found, null otherwise
	 */
	async findById(id: string): Promise<Wallpaper | null> {
		const [result] = await this.db
			.select()
			.from(wallpapers)
			.where(eq(wallpapers.id, id))
			.limit(1);

		return result ?? null;
	}
}
