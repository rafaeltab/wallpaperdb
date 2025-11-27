import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { eq, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { DatabaseConnection } from '../connections/database.js';
import { type NewWallpaper, type Wallpaper, wallpapers } from '../db/schema.js';

/**
 * Repository for wallpaper data access operations.
 * Handles database CRUD operations for wallpapers.
 */
@injectable()
export class WallpaperRepository {
  get db() {
    return this.dbConnection.getClient().db;
  }

  constructor(@inject(DatabaseConnection) private readonly dbConnection: DatabaseConnection) {}

  /**
   * Insert or update wallpaper (idempotent operation).
   * Uses UPSERT to handle duplicate events gracefully.
   *
   * @param wallpaper - The wallpaper data to insert/update
   * @returns The inserted or updated wallpaper
   */
  async upsert(wallpaper: NewWallpaper): Promise<Wallpaper> {
    return await withSpan(
      'db.wallpaper.upsert',
      { [Attributes.WALLPAPER_ID]: wallpaper.id },
      async () => {
        const startTime = Date.now();

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

        const durationMs = Date.now() - startTime;

        recordCounter('db.queries.total', 1, {
          table: 'wallpapers',
          operation: 'upsert',
        });

        recordHistogram('db.query_duration_ms', durationMs, {
          table: 'wallpapers',
          operation: 'upsert',
        });

        return result;
      }
    );
  }

  /**
   * Find wallpaper by ID.
   *
   * @param id - The wallpaper ID
   * @returns The wallpaper if found, null otherwise
   */
  async findById(id: string): Promise<Wallpaper | null> {
    return await withSpan(
      'db.wallpaper.find_by_id',
      { [Attributes.WALLPAPER_ID]: id },
      async (span) => {
        const startTime = Date.now();

        const [result] = await this.db
          .select()
          .from(wallpapers)
          .where(eq(wallpapers.id, id))
          .limit(1);

        const durationMs = Date.now() - startTime;
        const found = result !== undefined;

        span.setAttribute('db.query.found', found);

        recordCounter('db.queries.total', 1, {
          table: 'wallpapers',
          operation: 'find_by_id',
          found: found.toString(),
        });

        recordHistogram('db.query_duration_ms', durationMs, {
          table: 'wallpapers',
          operation: 'find_by_id',
        });

        return result ?? null;
      }
    );
  }
}
