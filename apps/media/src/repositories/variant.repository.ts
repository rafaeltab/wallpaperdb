import { eq, and, gte, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { withSpan, Attributes, recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { DatabaseConnection } from '../connections/database.js';
import { variants, type Variant, type NewVariant } from '../db/schema.js';

/**
 * Repository for querying wallpaper variants.
 */
@injectable()
export class VariantRepository {
  constructor(@inject(DatabaseConnection) private readonly db: DatabaseConnection) {}

  /**
   * Find all variants for a wallpaper.
   *
   * @param wallpaperId - The wallpaper ID
   * @returns Array of variants (empty if none exist)
   */
  async findByWallpaperId(wallpaperId: string): Promise<Variant[]> {
    const client = this.db.getClient();

    const results = await client.db
      .select()
      .from(variants)
      .where(eq(variants.wallpaperId, wallpaperId));

    return results;
  }

  /**
   * Find the smallest suitable variant that meets minimum dimensions.
   * Returns the variant that:
   * - Has width >= minWidth AND height >= minHeight
   * - Has the smallest total pixel count (width * height)
   *
   * This optimizes for efficiency - we want the smallest variant that's
   * still large enough to resize down from.
   *
   * @param wallpaperId - The wallpaper ID
   * @param minWidth - Minimum required width
   * @param minHeight - Minimum required height
   * @returns The smallest suitable variant, or null if none found
   */
  async findSmallestSuitable(
    wallpaperId: string,
    minWidth: number,
    minHeight: number
  ): Promise<Variant | null> {
    return await withSpan(
      'db.variant.find_smallest_suitable',
      {
        [Attributes.WALLPAPER_ID]: wallpaperId,
        [Attributes.RESIZE_WIDTH]: minWidth,
        [Attributes.RESIZE_HEIGHT]: minHeight,
      },
      async (span) => {
        const startTime = Date.now();
        const client = this.db.getClient();

        const results = await client.db
          .select()
          .from(variants)
          .where(
            and(
              eq(variants.wallpaperId, wallpaperId),
              gte(variants.width, minWidth),
              gte(variants.height, minHeight)
            )
          )
          .orderBy(sql`(${variants.width} * ${variants.height}) ASC`)
          .limit(1);

        const durationMs = Date.now() - startTime;
        const result = results[0] || null;
        const found = result !== null;

        span.setAttribute('db.query.found', found);
        if (found && result) {
          span.setAttribute(Attributes.VARIANT_ID, result.id);
        }

        recordCounter('db.queries.total', 1, {
          table: 'variants',
          operation: 'find_smallest_suitable',
          found: found.toString(),
        });

        recordHistogram('db.query_duration_ms', durationMs, {
          table: 'variants',
          operation: 'find_smallest_suitable',
        });

        return result;
      }
    );
  }

  /**
   * Insert a new variant into the database.
   *
   * @param variant - The variant data to insert
   * @returns The inserted variant
   */
  async insert(variant: NewVariant): Promise<Variant> {
    return await withSpan(
      'db.variant.insert',
      {
        [Attributes.WALLPAPER_ID]: variant.wallpaperId,
        [Attributes.FILE_WIDTH]: variant.width,
        [Attributes.FILE_HEIGHT]: variant.height,
      },
      async (span) => {
        const startTime = Date.now();
        const client = this.db.getClient();

        const [result] = await client.db.insert(variants).values(variant).returning();

        const durationMs = Date.now() - startTime;

        span.setAttribute(Attributes.VARIANT_ID, result.id);

        recordCounter('db.queries.total', 1, {
          table: 'variants',
          operation: 'insert',
        });

        recordHistogram('db.query_duration_ms', durationMs, {
          table: 'variants',
          operation: 'insert',
        });

        return result;
      }
    );
  }
}
