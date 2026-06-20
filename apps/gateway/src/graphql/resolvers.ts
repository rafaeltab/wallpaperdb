import type { IncomingHttpHeaders } from 'node:http';
import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { WallpaperRepository } from '../repositories/wallpaper.repository.js';
import {
  ColorSortService,
  type ColorInput as ColorSortColorInput,
} from '../services/color-sort.service.js';
import { CursorService, type CursorValue } from '../services/cursor.service.js';
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
  sort?: {
    color?: {
      colors: ColorSortColorInput[];
    };
  };
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

interface GetWallpaperArgs {
  wallpaperId: string;
}

interface GraphQLContext {
  reply?: {
    request?: {
      headers: IncomingHttpHeaders;
      hostname?: string;
      protocol?: string;
    };
  };
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
  private readonly colorSortService = new ColorSortService();

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
        url: (
          parent: Variant & { __wallpaperId?: string },
          _args: unknown,
          context: GraphQLContext
        ) => {
          return this.getVariantUrl(parent, context);
        },
      },
    };
  }

  /**
   * Search wallpapers with filters and pagination
   */
  private async searchWallpapers(args: SearchArgs) {
    const limit = args.first ?? args.last ?? 10;
    const isBackwardPagination = args.last !== undefined && args.before !== undefined;
    const colorSort = args.sort?.color;
    const colorVector = colorSort
      ? this.colorSortService.buildQueryVector({ colors: colorSort.colors })
      : undefined;
    const sortOrder = colorVector
      ? isBackwardPagination
        ? 'asc'
        : 'desc'
      : isBackwardPagination
        ? 'desc'
        : 'asc';

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
        let searchAfter: CursorValue[] | undefined;
        if (args.after) {
          searchAfter = this.cursorService.decode(args.after);
        } else if (args.before) {
          searchAfter = this.cursorService.decode(args.before);
        }

        span.setAttribute('search.cursor.present', searchAfter ? 'true' : 'false');

        // Backward pagination walks the same cursor values in reverse order.
        const result = await this.repository.search({
          userId: args.filter?.userId,
          variantFilters: args.filter?.variants,
          colorVector,
          searchAfter,
          size: limit + 1, // Fetch one extra to determine hasNextPage
          sortOrder,
        });

        // Check if there are more results
        const hasMore = result.documents.length > limit;
        let documents = hasMore ? result.documents.slice(0, limit) : result.documents;
        let cursorValues = hasMore ? result.cursorValues.slice(0, limit) : result.cursorValues;

        if (isBackwardPagination) {
          documents = [...documents].reverse();
          cursorValues = [...cursorValues].reverse();
        }

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
        const startCursor = cursorValues[0] ? this.cursorService.encode(cursorValues[0]) : null;
        const lastCursorValues = cursorValues.at(-1);
        const endCursor = lastCursorValues ? this.cursorService.encode(lastCursorValues) : null;

        const hasNextPage = isBackwardPagination
          ? Boolean(args.before && edges.length > 0)
          : hasMore;
        const hasPreviousPage = isBackwardPagination ? hasMore : Boolean(args.after);

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
  private getVariantUrl(
    variant: Variant & { __wallpaperId?: string },
    context?: GraphQLContext
  ): string {
    const mediaServiceUrl = this.getPublicMediaBaseUrl(context);
    const wallpaperId = variant.__wallpaperId;

    return `${mediaServiceUrl}/wallpapers/${wallpaperId}?w=${variant.width}&h=${variant.height}&format=${variant.format}`;
  }

  private getPublicMediaBaseUrl(context?: GraphQLContext): string {
    if (this.config.mediaPublicBaseUrl) {
      return trimTrailingSlash(this.config.mediaPublicBaseUrl);
    }

    const requestOrigin = getRequestOrigin(context);
    if (!requestOrigin) {
      return trimTrailingSlash(this.config.mediaServiceUrl);
    }

    const mediaPath = this.config.mediaPublicPath.startsWith('/')
      ? this.config.mediaPublicPath
      : `/${this.config.mediaPublicPath}`;

    return `${requestOrigin}${trimTrailingSlash(mediaPath)}`;
  }
}

function getRequestOrigin(context?: GraphQLContext): string | undefined {
  const request = context?.reply?.request;
  if (!request) {
    return undefined;
  }

  const origin = firstHeaderValue(request.headers.origin);
  if (origin && isHttpOrigin(origin)) {
    return trimTrailingSlash(origin);
  }

  const forwardedProto = firstHeaderValue(request.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(request.headers['x-forwarded-host']);

  if (!forwardedProto || !forwardedHost) {
    return undefined;
  }

  const normalizedProtocol = forwardedProto.split(',')[0]?.trim();
  const normalizedHost = forwardedHost.split(',')[0]?.trim();

  if (!normalizedHost || !normalizedProtocol) {
    return undefined;
  }

  const forwardedOrigin = `${normalizedProtocol}://${normalizedHost}`;
  return isHttpOrigin(forwardedOrigin) ? forwardedOrigin : undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/';
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
