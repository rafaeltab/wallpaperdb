import type { IncomingHttpHeaders } from 'node:http';
import { Clock, Effect, Exit, Result, Schema } from 'effect';
import { GraphQLError } from 'graphql';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import type { HttpExecution } from '../runtime.js';
import { Catalogue, type CatalogueUnavailable } from '../catalogue/index.js';
import type {
  Profile,
  ReadOutcome,
  SearchOutcome,
  SearchWallpapers,
  Wallpaper,
} from '../catalogue/index.js';

export interface MediaUrls {
  mediaServiceUrl: string;
  mediaPublicBaseUrl?: string;
  mediaPublicPath: string;
}
interface GraphqlContext {
  reply?: { request?: { headers: IncomingHttpHeaders; gatewaySignal?: AbortSignal } };
}
interface VariantView {
  width: number;
  height: number;
  aspectRatio: number;
  format: string;
  fileSizeBytes: number;
  createdAt: string;
  wallpaperId: string;
}
interface WallpaperView {
  wallpaperId: string;
  profileId: string;
  variants: VariantView[];
  uploadedAt: string;
  updatedAt: string;
}
interface ProfileView {
  id: string;
  handle: string;
  displayName: string;
  biographyMarkdown: string;
  pictureAssetId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
const nullableOptional = <S extends Schema.Constraint>(schema: S) =>
  Schema.optional(Schema.NullOr(schema));
const searchArguments = Schema.Struct({
  first: nullableOptional(Schema.Number),
  last: nullableOptional(Schema.Number),
  after: nullableOptional(Schema.String),
  before: nullableOptional(Schema.String),
  filter: nullableOptional(
    Schema.Struct({
      profileId: nullableOptional(Schema.String),
      userId: nullableOptional(Schema.String),
      variants: nullableOptional(
        Schema.Struct({
          width: nullableOptional(Schema.Number),
          height: nullableOptional(Schema.Number),
          aspectRatio: nullableOptional(Schema.Number),
          format: nullableOptional(Schema.String),
        })
      ),
    })
  ),
  sort: nullableOptional(
    Schema.Struct({
      color: nullableOptional(
        Schema.Struct({
          colors: Schema.Array(
            Schema.Struct({
              color: Schema.String,
              amount: Schema.Finite,
              spread: nullableOptional(Schema.Finite),
            })
          ),
        })
      ),
    })
  ),
});
function parse<A>(schema: Schema.ConstraintDecoder<A>, input: unknown): A {
  const result = Schema.decodeUnknownExit(schema)(input);
  if (Exit.isFailure(result))
    throw new GraphQLError('Invalid query arguments', { extensions: { code: 'BAD_USER_INPUT' } });
  return result.value;
}
function searchInput(input: unknown): SearchWallpapers {
  const args = parse(searchArguments, input);
  const variants = args.filter?.variants;
  return {
    first: args.first ?? undefined,
    last: args.last ?? undefined,
    after: args.after ?? undefined,
    before: args.before ?? undefined,
    profileId: args.filter?.profileId ?? args.filter?.userId ?? undefined,
    variants: variants
      ? {
          width: variants.width ?? undefined,
          height: variants.height ?? undefined,
          aspectRatio: variants.aspectRatio ?? undefined,
          format: variants.format ?? undefined,
        }
      : undefined,
    colors: args.sort?.color?.colors.map((color) => ({
      color: color.color,
      amount: color.amount,
      spread: color.spread ?? undefined,
    })),
  };
}
function wallpaperView(wallpaper: Wallpaper): WallpaperView {
  return {
    wallpaperId: wallpaper.wallpaperId,
    profileId: wallpaper.profileId,
    uploadedAt: wallpaper.uploadedAt,
    updatedAt: wallpaper.updatedAt,
    variants: wallpaper.variants.map((variant) => ({
      width: variant.width,
      height: variant.height,
      aspectRatio: variant.aspectRatio,
      format: variant.format,
      fileSizeBytes: variant.fileSizeBytes,
      createdAt: variant.createdAt,
      wallpaperId: wallpaper.wallpaperId,
    })),
  };
}
function profileView(profile: Profile): ProfileView {
  return {
    id: profile.id,
    handle: profile.handle,
    displayName: profile.displayName,
    biographyMarkdown: profile.biographyMarkdown,
    pictureAssetId: profile.pictureAssetId,
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
function readValue<A>(result: ReadOutcome<A>): A {
  return result.value;
}
function searchValue(result: SearchOutcome) {
  switch (result._tag) {
    case 'Found':
      return {
        edges: result.value.wallpapers.map((wallpaper) => ({ node: wallpaperView(wallpaper) })),
        pageInfo: { ...result.value.pageInfo },
      };
    case 'InvalidCursor':
      throw new GraphQLError('Invalid or expired cursor', {
        extensions: { code: 'INVALID_CURSOR' },
      });
    case 'InvalidSearch':
      throw new GraphQLError(result.reason, { extensions: { code: 'BAD_USER_INPUT' } });
  }
}
const wallpaperQuery = Effect.fn('graphql.getWallpaper')(function* (id: string) {
  const started = yield* Clock.currentTimeMillis;
  const catalogue = yield* Catalogue;
  const value = readValue(yield* catalogue.wallpaper(id));
  const finished = yield* Clock.currentTimeMillis;
  recordQuery('getWallpaper', finished - started, value ? 1 : 0, Boolean(value));
  return value ? wallpaperView(value) : null;
});
const searchQuery = Effect.fn('graphql.searchWallpapers')(function* (input: SearchWallpapers) {
  const started = yield* Clock.currentTimeMillis;
  const catalogue = yield* Catalogue;
  const outcome = yield* catalogue.search(input);
  const finished = yield* Clock.currentTimeMillis;
  if (outcome._tag === 'Found')
    recordQuery('searchWallpapers', finished - started, outcome.value.wallpapers.length);
  return outcome;
});
export class GraphqlAdapter {
  constructor(
    private readonly execution: HttpExecution['Service'],
    private readonly media: MediaUrls
  ) {}
  resolvers() {
    return {
      Query: {
        searchWallpapers: async (_parent: unknown, args: unknown, context?: GraphqlContext) =>
          this.search(searchInput(args), context),
        getWallpaper: async (_parent: unknown, args: unknown, context: GraphqlContext) => {
          const { wallpaperId } = parse(Schema.Struct({ wallpaperId: Schema.String }), args);
          if (!wallpaperId.trim())
            throw new GraphQLError('wallpaperId cannot be empty', {
              extensions: { code: 'BAD_USER_INPUT' },
            });
          if (!wallpaperId.startsWith('wlpr_'))
            throw new GraphQLError('wallpaperId must start with "wlpr_"', {
              extensions: { code: 'BAD_USER_INPUT' },
            });
          return this.run(wallpaperQuery(wallpaperId), context);
        },
        profile: async (_parent: unknown, args: unknown, context: GraphqlContext) => {
          const { id } = parse(Schema.Struct({ id: Schema.NonEmptyString }), args);
          const value = readValue(
            await this.run(
              Catalogue.use((catalogue) => catalogue.profile(id)),
              context
            )
          );
          return value ? profileView(value) : null;
        },
        profileByHandle: async (_parent: unknown, args: unknown, context: GraphqlContext) => {
          const { handle } = parse(Schema.Struct({ handle: Schema.NonEmptyString }), args);
          const value = readValue(
            await this.run(
              Catalogue.use((catalogue) => catalogue.profileByHandle(handle)),
              context
            )
          );
          return value ? profileView(value) : null;
        },
      },
      Profile: {
        canonicalPath: (profile: ProfileView) => `/profiles/@${profile.handle}`,
        picture: (profile: ProfileView, _args: unknown, context: GraphqlContext) =>
          profile.pictureAssetId
            ? {
                id: profile.pictureAssetId,
                url: `${this.mediaBase(context)}/profile-pictures/${profile.pictureAssetId}`,
              }
            : null,
        wallpapers: async (profile: ProfileView, args: unknown, context: GraphqlContext) =>
          this.search({ ...searchInput(args), profileId: profile.id }, context),
      },
      Wallpaper: { userId: (wallpaper: WallpaperView) => wallpaper.profileId },
      Variant: {
        url: (variant: VariantView, _args: unknown, context: GraphqlContext) =>
          `${this.mediaBase(context)}/wallpapers/${variant.wallpaperId}?w=${variant.width}&h=${variant.height}&format=${variant.format}`,
      },
    };
  }
  loaders() {
    return {
      Wallpaper: {
        profile: async (queries: Array<{ obj: WallpaperView }>, context: GraphqlContext) =>
          readValue(
            await this.run(
              Catalogue.use((catalogue) =>
                catalogue.profiles(queries.map(({ obj }) => obj.profileId))
              ),
              context
            )
          ).map((profile) => (profile ? profileView(profile) : null)),
      },
    };
  }
  private async run<A>(
    effect: Effect.Effect<A, CatalogueUnavailable, Catalogue>,
    context?: GraphqlContext
  ): Promise<A> {
    const result = await this.execution
      .run(Effect.result(effect), {
        signal: context?.reply?.request?.gatewaySignal,
      })
      .catch(() => {
        throw new GraphQLError('An unexpected error occurred', {
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        });
      });
    if (Result.isFailure(result)) {
      throw new GraphQLError('The catalogue is temporarily unavailable', {
        extensions: { code: 'SERVICE_UNAVAILABLE' },
      });
    }
    return result.success;
  }
  private search(input: SearchWallpapers, context?: GraphqlContext) {
    return this.run(searchQuery(input), context).then(searchValue);
  }
  private mediaBase(context?: GraphqlContext): string {
    if (this.media.mediaPublicBaseUrl) return trimTrailingSlash(this.media.mediaPublicBaseUrl);
    const origin = requestOrigin(context);
    if (!origin) return trimTrailingSlash(this.media.mediaServiceUrl);
    const path = this.media.mediaPublicPath.startsWith('/')
      ? this.media.mediaPublicPath
      : `/${this.media.mediaPublicPath}`;
    return `${origin}${trimTrailingSlash(path)}`;
  }
}
function requestOrigin(context?: GraphqlContext): string | undefined {
  const request = context?.reply?.request;
  if (!request) return undefined;
  const origin = firstHeader(request.headers.origin);
  if (origin && isHttpOrigin(origin)) return trimTrailingSlash(origin);
  const protocol = firstHeader(request.headers['x-forwarded-proto'])?.split(',')[0]?.trim();
  const host = firstHeader(request.headers['x-forwarded-host'])?.split(',')[0]?.trim();
  if (!protocol || !host) return undefined;
  const forwardedOrigin = `${protocol}://${host}`;
  return isHttpOrigin(forwardedOrigin) ? forwardedOrigin : undefined;
}
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function isHttpOrigin(value: string): boolean {
  const decoded = Schema.decodeUnknownExit(Schema.URLFromString)(value);
  if (Exit.isFailure(decoded)) return false;
  const url = decoded.value;
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/';
}
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Metrics remain at the GraphQL operation boundary and cannot change query results. */
function recordQuery(operation: string, durationMs: number, count: number, found?: boolean): void {
  try {
    recordCounter('graphql.query.total', 1, {
      operation,
      ...(found === undefined ? {} : { found: String(found) }),
    });
    recordHistogram('graphql.query.duration_ms', durationMs, { operation });
    recordHistogram('graphql.query.result_count', count, { operation });
  } catch {
    // Telemetry is best effort; the catalogue outcome remains authoritative.
  }
}
