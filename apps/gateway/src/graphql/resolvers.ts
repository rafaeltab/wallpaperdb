import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { WallpaperRepository } from '../repositories/wallpaper.repository.js';
import { CursorService } from '../services/cursor.service.js';
import { GatewayAttributes } from '../telemetry/attributes.js';

/**
 * Validate wallpaper ID format
 * @throws Error if wallpaperId is invalid
 */
function validateWallpaperId(wallpaperId: string): void {
  if (!wallpaperId || wallpaperId.trim() === '') {
    throw new Error('wallpaperId cannot be empty');
  }
  if (!wallpaperId.startsWith('wlpr_')) {
    throw new Error('wallpaperId must start with "wlpr_"');
  }
}

interface WallpaperFilter {
  userId?: string;
  variants?: {
    width?: number;
    height?: number;
    aspectRatio?: number;
    format?: string;
  };
}

interface SearchArgs {
  filter?: WallpaperFilter;
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

interface GetWallpaperArgs {
  wallpaperId: string;
}

interface Variant {
  width: number;
  height: number;
  aspectRatio: number;
  format: string;
  fileSizeBytes: number;
  createdAt: string;
}

interface Wallpaper {
  wallpaperId: string;
  userId: string;
  variants: Variant[];
  uploadedAt: string;
  updatedAt: string;
}

/**
 * GraphQL resolvers for the Gateway service
 */
@singleton()
export class Resolvers {
  constructor(
    @inject(WallpaperRepository) private readonly repository: WallpaperRepository,
    @inject(CursorService) private readonly cursorService: CursorService,
    @inject('config') private readonly config: Config
  ) {}

  /**
   * Get resolvers object for Mercurius
   */
  getResolvers() {
    return {
      Query: {
        searchWallpapers: async (_parent: unknown, args: SearchArgs) => {
          return await this.searchWallpapers(args);
        },
        getWallpaper: async (_parent: unknown, args: GetWallpaperArgs) => {
          return await this.getWallpaper(args);
        },
      },
      Variant: {
        url: (parent: Variant & { __wallpaperId?: string }) => {
          return this.getVariantUrl(parent);
        },
      },
    };
  }

  /**
   * Search wallpapers with filters and pagination
   */
  private async searchWallpapers(args: SearchArgs) {
    const limit = args.first ?? args.last ?? 10;

    return await withSpan(
      'graphql.resolve.searchWallpapers',
      {
        [GatewayAttributes.GRAPHQL_OPERATION_NAME]: 'searchWallpapers',
        [GatewayAttributes.GRAPHQL_OPERATION_TYPE]: 'query',
        [GatewayAttributes.SEARCH_PAGE_SIZE]: limit,
        [GatewayAttributes.SEARCH_FILTER_USER_ID]: args.filter?.userId ?? 'none',
        [GatewayAttributes.SEARCH_FILTER_HAS_VARIANT]: args.filter?.variants ? 'true' : 'false',
      },
      async (span) => {
        const startTime = Date.now();

        // Decode cursor if provided
        let offset = 0;
        if (args.after) {
          offset = this.cursorService.decode(args.after);
        } else if (args.before) {
          offset = this.cursorService.decode(args.before);
        }

        // If using 'last', we need to adjust offset for backward pagination
        if (args.last && args.before) {
          offset = Math.max(0, offset - args.last);
        }

        span.setAttribute(GatewayAttributes.SEARCH_OFFSET, offset);

        // Search with offset and limit
        const result = await this.repository.search({
          userId: args.filter?.userId,
          variantFilters: args.filter?.variants,
          from: offset,
          size: limit + 1, // Fetch one extra to determine hasNextPage
        });

        // Check if there are more results
        const hasMore = result.documents.length > limit;
        const documents = hasMore ? result.documents.slice(0, limit) : result.documents;

        // Attach wallpaperId to variants for URL resolution
        const edges = documents.map((doc: Wallpaper) => ({
          node: {
            ...doc,
            variants: doc.variants.map((v) => ({
              ...v,
              __wallpaperId: doc.wallpaperId,
            })),
          },
        }));

        // Generate cursors
        const startCursor = edges.length > 0 ? this.cursorService.encode(offset) : null;
        const endCursor =
          edges.length > 0 ? this.cursorService.encode(offset + edges.length) : null;

        const hasNextPage = hasMore && !args.last;
        const hasPreviousPage = offset > 0;

        // Record span attributes and metrics
        span.setAttribute(GatewayAttributes.SEARCH_TOTAL_RESULTS, result.total);
        span.setAttribute(GatewayAttributes.GRAPHQL_RESULT_COUNT, edges.length);
        span.setAttribute(GatewayAttributes.SEARCH_HAS_NEXT_PAGE, hasNextPage);
        span.setAttribute(GatewayAttributes.SEARCH_HAS_PREV_PAGE, hasPreviousPage);

        const durationMs = Date.now() - startTime;
        recordCounter('graphql.query.total', 1, {
          operation: 'searchWallpapers',
        });
        recordHistogram('graphql.query.duration_ms', durationMs, {
          operation: 'searchWallpapers',
        });
        recordHistogram('graphql.query.result_count', edges.length, {
          operation: 'searchWallpapers',
        });

        return {
          edges,
          pageInfo: {
            hasNextPage,
            hasPreviousPage,
            startCursor,
            endCursor,
          },
        };
      }
    );
  }

  /**
   * Get a specific wallpaper by ID
   */
  private async getWallpaper(args: GetWallpaperArgs): Promise<Wallpaper | null> {
    // Validate wallpaper ID format
    validateWallpaperId(args.wallpaperId);

    return await withSpan(
      'graphql.resolve.getWallpaper',
      {
        [GatewayAttributes.GRAPHQL_OPERATION_NAME]: 'getWallpaper',
        [GatewayAttributes.GRAPHQL_OPERATION_TYPE]: 'query',
        [Attributes.WALLPAPER_ID]: args.wallpaperId,
      },
      async (span) => {
        const startTime = Date.now();

        // Query repository
        const wallpaper = await this.repository.findById(args.wallpaperId);

        // Record metrics
        const found = wallpaper !== null;
        span.setAttribute(GatewayAttributes.OPENSEARCH_DOC_EXISTS, found);

        const durationMs = Date.now() - startTime;
        recordCounter('graphql.query.total', 1, {
          operation: 'getWallpaper',
          found: found.toString(),
        });
        recordHistogram('graphql.query.duration_ms', durationMs, {
          operation: 'getWallpaper',
        });

        // If not found, return null
        if (!wallpaper) {
          return null;
        }

        // Attach wallpaperId to variants for URL resolution
        return {
          ...wallpaper,
          variants: wallpaper.variants.map((v) => ({
            ...v,
            __wallpaperId: wallpaper.wallpaperId,
          })),
        };
      }
    );
  }

  /**
   * Get URL for a variant (field resolver)
   */
  private getVariantUrl(variant: Variant & { __wallpaperId?: string }): string {
    const mediaServiceUrl = this.config.mediaServiceUrl;
    const wallpaperId = variant.__wallpaperId;

    return `${mediaServiceUrl}/wallpapers/${wallpaperId}?w=${variant.width}&h=${variant.height}&format=${variant.format}`;
  }
}
