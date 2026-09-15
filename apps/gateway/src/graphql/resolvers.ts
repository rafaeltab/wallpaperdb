import type { IncomingHttpHeaders } from 'node:http';
import { Effect, Either, Exit, Schema } from 'effect';
import { GraphQLError } from 'graphql';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { traceGatewayEffect } from '../runtime.js';
import type {
  Catalogue,
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
  reply?: { request?: { headers: IncomingHttpHeaders } };
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
const nullableOptional = <A, I>(schema: Schema.Schema<A, I>) =>
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
function parse<A, I>(schema: Schema.Schema<A, I>, input: unknown): A {
  const result = Schema.decodeUnknownEither(schema)(input);
  if (Either.isLeft(result))
    throw new GraphQLError('Invalid query arguments', { extensions: { code: 'BAD_USER_INPUT' } });
  return result.right;
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
async function run<A>(effect: Effect.Effect<A>): Promise<A> {
  const exit = await Effect.runPromiseExit(traceGatewayEffect(effect));
  if (Exit.isFailure(exit))
    throw new GraphQLError('An unexpected error occurred', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  return exit.value;
}
function readValue<A>(result: ReadOutcome<A>): A {
  switch (result._tag) {
    case 'Found':
      return result.value;
    case 'Unavailable':
      throw new GraphQLError('The catalogue is temporarily unavailable', {
        extensions: { code: 'SERVICE_UNAVAILABLE' },
      });
  }
}
function searchValue(result: SearchOutcome) {
  switch (result._tag) {
    case 'Found':
      return {
        edges: result.value.wallpapers.map((wallpaper) => ({ node: wallpaperView(wallpaper) })),
        pageInfo: { ...result.value.pageInfo },
      };
    case 'Unavailable':
      throw new GraphQLError('The catalogue is temporarily unavailable', {
        extensions: { code: 'SERVICE_UNAVAILABLE' },
      });
    case 'InvalidCursor':
      throw new GraphQLError('Invalid or expired cursor', {
        extensions: { code: 'INVALID_CURSOR' },
      });
    case 'InvalidSearch':
      throw new GraphQLError(result.reason, { extensions: { code: 'BAD_USER_INPUT' } });
  }
}
export class GraphqlAdapter {
  constructor(
    private readonly catalogue: Catalogue,
    private readonly media: MediaUrls
  ) {}
  resolvers() {
    return {
      Query: {
        searchWallpapers: async (_parent: unknown, args: unknown) => this.search(searchInput(args)),
        getWallpaper: async (_parent: unknown, args: unknown) => {
          const { wallpaperId } = parse(Schema.Struct({ wallpaperId: Schema.String }), args);
          if (!wallpaperId.trim())
            throw new GraphQLError('wallpaperId cannot be empty', {
              extensions: { code: 'BAD_USER_INPUT' },
            });
          if (!wallpaperId.startsWith('wlpr_'))
            throw new GraphQLError('wallpaperId must start with "wlpr_"', {
              extensions: { code: 'BAD_USER_INPUT' },
            });
          const started = Date.now();
          const value = readValue(await run(this.catalogue.wallpaper(wallpaperId)));
          recordQuery('getWallpaper', started, value ? 1 : 0, Boolean(value));
          return value ? wallpaperView(value) : null;
        },
        profile: async (_parent: unknown, args: unknown) => {
          const { id } = parse(Schema.Struct({ id: Schema.NonEmptyString }), args);
          const value = readValue(await run(this.catalogue.profile(id)));
          return value ? profileView(value) : null;
        },
        profileByHandle: async (_parent: unknown, args: unknown) => {
          const { handle } = parse(Schema.Struct({ handle: Schema.NonEmptyString }), args);
          const value = readValue(await run(this.catalogue.profileByHandle(handle)));
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
        wallpapers: async (profile: ProfileView, args: unknown) =>
          this.search({ ...searchInput(args), profileId: profile.id }),
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
        profile: async (queries: Array<{ obj: WallpaperView }>) =>
          readValue(
            await run(this.catalogue.profiles(queries.map(({ obj }) => obj.profileId)))
          ).map((profile) => (profile ? profileView(profile) : null)),
      },
    };
  }
  private async search(input: SearchWallpapers) {
    const started = Date.now();
    const result = searchValue(await run(this.catalogue.search(input)));
    recordQuery('searchWallpapers', started, result.edges.length);
    return result;
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

/** Metrics remain at the GraphQL operation boundary and cannot change query results. */
function recordQuery(operation: string, started: number, count: number, found?: boolean): void {
  try {
    recordCounter('graphql.query.total', 1, {
      operation,
      ...(found === undefined ? {} : { found: String(found) }),
    });
    recordHistogram('graphql.query.duration_ms', Date.now() - started, { operation });
    recordHistogram('graphql.query.result_count', count, { operation });
  } catch {
    // Telemetry is best effort; the catalogue outcome remains authoritative.
  }
}
