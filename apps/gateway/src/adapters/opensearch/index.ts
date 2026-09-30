import { Client } from '@opensearch-project/opensearch';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Clock, Context, DateTime, Effect, Exit, Layer, Schema } from 'effect';
import {
  colorUtilityFields,
  CatalogueRead,
  CatalogueUnavailable,
  type ProfileSearchSelection,
  type SearchSelection,
} from '../../capabilities/catalogue/index.js';
import {
  type ProjectionMutation,
  ProjectionStore,
  ProjectionUnavailable,
  type ProjectionWrite,
} from '../../capabilities/projection/index.js';
import { StartupDiagnostic } from '../../startup-diagnostics.js';
import {
  followsSearchCursor,
  partialWallpaperResponse,
  profileBatchResponse,
  profileDiscoveryResponse,
  profileResponse,
  profileSearchResponse,
  storageError,
  toWallpaper,
  updateResponse,
  wallpaperResponse,
  wallpaperSearchResponse,
} from './documents.js';
import { profilesIndexMapping, wallpapersIndexMapping } from './mappings.js';
import { aliasClaimSearch, profileSearchBody } from './profiles.js';
import { searchBody } from './query.js';
import { profileUpdate } from './scripts.js';
import {
  completeWallpaper,
  indexResponse,
  nextWallpaper,
  storedWallpaperResponse,
} from './wallpaper-projection.js';

export interface OpenSearchGatewayOptions {
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
  readonly wallpaperIndex?: string;
  readonly profileIndex?: string;
}
export interface OpenSearchGateway {
  readonly read: CatalogueRead;
  readonly projectionStore: ProjectionStore;
  check(): Effect.Effect<boolean>;
}
export const OpenSearchGateway = Context.Service<OpenSearchGateway>(
  'wallpaperdb/gateway/adapters/OpenSearchGateway'
);
export class OpenSearchStartupError extends Schema.TaggedError<OpenSearchStartupError>()(
  'OpenSearchStartupError',
  { diagnostic: StartupDiagnostic, cause: Schema.Defect() }
) {}
class SearchRequestError extends Schema.TaggedError<SearchRequestError>()('SearchRequestError', {
  cause: Schema.Defect(),
}) {}

const startupErrorCode = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.Literals([
      'OpenSearchClientError',
      'TimeoutError',
      'ConnectionError',
      'NoLivingConnectionsError',
      'SerializationError',
      'DeserializationError',
      'ConfigurationError',
      'ResponseError',
      'RequestAbortedError',
      'NotCompatibleError',
    ]),
  })
);
const startupStatusCode = Schema.decodeUnknownOption(
  Schema.Struct({
    meta: Schema.Struct({
      statusCode: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
    }),
  })
);

function startupFailure(
  operation:
    | 'initialize-client'
    | 'inspect-index'
    | 'create-index'
    | 'recheck-index'
    | 'update-index-mapping',
  cause: unknown,
  index?: string
): OpenSearchStartupError {
  const underlying = cause instanceof SearchRequestError ? cause.cause : cause;
  const code = startupErrorCode(underlying);
  const statusCode = startupStatusCode(underlying);
  return new OpenSearchStartupError({
    diagnostic: {
      dependency: 'opensearch',
      operation,
      code: code._tag === 'Some' ? code.value.name : 'UnknownError',
      ...(index === undefined ? {} : { index }),
      ...(statusCode._tag === 'Some' ? { statusCode: statusCode.value.meta.statusCode } : {}),
    },
    cause,
  });
}

class SearchProjection implements CatalogueRead, ProjectionStore {
  constructor(
    private readonly client: Client,
    private readonly active: Set<{ abort(): void }>,
    private readonly wallpapers: string,
    private readonly profilesIndex: string
  ) {}

  readonly request = <T>(send: () => Promise<T> & { abort(): void }) =>
    Effect.tryPromise({
      try: (signal) => {
        const request = send();
        this.active.add(request);
        const abort = () => {
          request.abort();
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        return request.finally(() => {
          signal.removeEventListener('abort', abort);
          this.active.delete(request);
        });
      },
      catch: (cause) => new SearchRequestError({ cause }),
    });

  readonly wallpaper = Effect.fn('catalogue.storage.wallpaper')((id: string) =>
    read(
      'get',
      Effect.gen({ self: this }, function* () {
        const result = yield* this.get(this.wallpapers, id);
        if (result === null) return null;
        const partial = yield* partialWallpaperResponse(result);
        if (partial._source.userId === undefined) return null;
        return toWallpaper((yield* wallpaperResponse(result))._source);
      })
    )
  );
  readonly profile = Effect.fn('catalogue.storage.profile')((id: string) =>
    read(
      'get',
      Effect.gen({ self: this }, function* () {
        const result = yield* this.get(this.profilesIndex, id);
        return result === null ? null : (yield* profileResponse(result))._source;
      })
    )
  );
  readonly profileByHandle = Effect.fn('catalogue.storage.profile-by-handle')((handle: string) =>
    read(
      'search',
      Effect.gen({ self: this }, function* () {
        const normalized = handle.toLowerCase();
        const now = DateTime.formatIso(yield* DateTime.now);
        const [currentResult, aliasResult] = yield* Effect.all(
          [
            this.request(() =>
              this.client.search({
                index: this.profilesIndex,
                body: {
                  query: { term: { handle: normalized } },
                  sort: [{ claimGeneration: 'desc' }],
                  size: 1,
                },
              })
            ),
            this.request(() =>
              this.client.search({
                index: this.profilesIndex,
                body: aliasClaimSearch(normalized, now),
              })
            ),
          ],
          { concurrency: 2 }
        );
        const current = (yield* profileSearchResponse(currentResult.body)).hits.hits[0];
        const alias = (yield* profileSearchResponse(aliasResult.body)).hits.hits[0];
        return alias && (!current || alias.sort[0] > current.sort[0])
          ? alias._source
          : (current?._source ?? null);
      })
    )
  );
  readonly searchProfiles = Effect.fn('catalogue.storage.search-profiles')(
    (selection: ProfileSearchSelection) =>
      read(
        'search',
        Effect.gen({ self: this }, function* () {
          const now = DateTime.formatIso(yield* DateTime.now);
          const result = yield* this.request(() =>
            this.client.search({
              index: this.profilesIndex,
              body: profileSearchBody(selection, now),
            })
          );
          const { hits } = yield* profileDiscoveryResponse(result.body);
          yield* recordTelemetry(() =>
            recordHistogram('opensearch.search.results', hits.hits.length, {
              'opensearch.index': this.profilesIndex,
            })
          );
          return {
            entries: hits.hits.map((hit) => ({ profile: hit._source, cursor: [...hit.sort] })),
          };
        })
      )
  );
  readonly profiles = Effect.fn('catalogue.storage.profiles')((ids: string[]) =>
    read(
      'mget',
      Effect.gen({ self: this }, function* () {
        if (ids.length === 0) return [];
        const result = yield* this.request(() =>
          this.client.mget({ index: this.profilesIndex, body: { ids } })
        );
        const { docs } = yield* profileBatchResponse(result.body);
        if (docs.length !== ids.length)
          return yield* new SearchRequestError({
            cause: new Error('Invalid profile batch response'),
          });
        return docs.map((document) => (document.found ? document._source : null));
      })
    )
  );
  private readonly searchPage = Effect.fn('catalogue.storage.search-page')(
    (selection: SearchSelection) =>
      Effect.gen({ self: this }, function* () {
        const result = yield* this.request(() =>
          this.client.search({ index: this.wallpapers, body: searchBody(selection) })
        );
        return (yield* wallpaperSearchResponse(selection, this.wallpapers)(result.body)).hits;
      })
  );
  readonly search = Effect.fn('catalogue.storage.search')((selection: SearchSelection) =>
    read(
      'search',
      Effect.gen({ self: this }, function* () {
        const hits = yield* this.searchPage(selection);
        const after = selection.searchAfter;
        const fullPage = hits.hits.length === selection.size;
        if (after || (selection.color && fullPage)) {
          const anchor = fullPage ? hits.hits.at(-1) : undefined;
          if (fullPage && !anchor)
            return yield* new SearchRequestError({
              cause: new Error('Empty full search page'),
            });
          const inverse = yield* this.searchPage({
            ...selection,
            searchAfter: anchor ? [...anchor.sort] : undefined,
            sortOrder: selection.sortOrder === 'asc' ? 'desc' : 'asc',
          });
          const expected = [...inverse.hits]
            .reverse()
            .filter((hit) => !after || followsSearchCursor(hit.sort, after, selection));
          const observed = fullPage ? hits.hits.slice(0, -1) : hits.hits;
          const complete =
            expected.length === observed.length &&
            expected.every((hit, position) =>
              hit.sort.every((value, component) => value === observed[position]?.sort[component])
            );
          if (!complete)
            return yield* new SearchRequestError({
              cause: new Error('Incomplete or concurrently changed search page'),
            });
        }
        yield* recordTelemetry(() =>
          recordHistogram('opensearch.search.results', hits.total.value, {
            'opensearch.index': this.wallpapers,
          })
        );
        return {
          entries: hits.hits.map((hit) => ({
            wallpaper: toWallpaper(hit._source),
            cursor: [...hit.sort],
          })),
          total: hits.total.value,
        };
      })
    )
  );
  readonly apply = Effect.fn('catalogue.storage.project')((mutation: ProjectionMutation) => {
    const operation = {
      PublishWallpaper: 'upsert',
      PublishVariant: 'add_variant',
      PublishMeasurements: 'add_color_utilities',
      PublishProfile: 'profile_project',
    }[mutation._tag];
    return measure(
      operation,
      Effect.gen({ self: this }, function* (): Effect.fn.Return<
        ProjectionWrite,
        SearchRequestError | Schema.SchemaError
      > {
        if (mutation._tag !== 'PublishProfile') return yield* this.applyWallpaper(mutation);
        const result = yield* this.request(() =>
          this.client.update({
            index: this.profilesIndex,
            id: mutation.profile.id,
            body: profileUpdate(mutation.profile),
            refresh: true,
            retry_on_conflict: 5,
          })
        );
        return (yield* updateResponse(result.body)).result === 'noop'
          ? { _tag: 'Unchanged' }
          : { _tag: 'Applied' };
      })
    ).pipe(
      Effect.catch((error) => {
        const parsed = storageError(error._tag === 'SearchRequestError' ? error.cause : error);
        const type = parsed._tag === 'Some' ? parsed.value.meta.body?.error?.type : undefined;
        return type === 'mapper_parsing_exception' || type === 'strict_dynamic_mapping_exception'
          ? Effect.succeed<ProjectionWrite>({ _tag: 'Rejected' })
          : Effect.fail(new ProjectionUnavailable({ cause: error }));
      })
    );
  });
  private readonly applyWallpaper = Effect.fnUntraced(function* (
    this: SearchProjection,
    mutation: Exclude<ProjectionMutation, { _tag: 'PublishProfile' }>
  ): Effect.fn.Return<ProjectionWrite, SearchRequestError | Schema.SchemaError> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const existing = yield* this.get(this.wallpapers, mutation.wallpaperId);
      const stored = existing === null ? null : yield* storedWallpaperResponse(existing);
      if (
        stored !== null &&
        (stored._id !== mutation.wallpaperId ||
          stored._index !== this.wallpapers ||
          stored._source.wallpaperId !== mutation.wallpaperId)
      )
        return yield* new SearchRequestError({
          cause: new Error('Wallpaper source identity differs'),
        });
      const next = nextWallpaper(stored?._source ?? null, mutation);
      if (next === null) return { _tag: 'Unchanged' };
      const body = completeWallpaper(next);
      if (Buffer.byteLength(JSON.stringify(body)) > 5 * 1024 * 1024)
        return yield* new SearchRequestError({
          cause: new Error('Wallpaper indexing payload exceeds byte limit'),
        });
      const written = yield* this.request(() =>
        this.client.index({
          index: this.wallpapers,
          id: mutation.wallpaperId,
          body,
          refresh: true,
          ...(stored === null
            ? { op_type: 'create' as const }
            : { if_seq_no: stored._seq_no, if_primary_term: stored._primary_term }),
        })
      ).pipe(
        Effect.map((response) => ({ _tag: 'Written' as const, body: response.body })),
        Effect.catch((error) => {
          const status = storageError(error.cause);
          return status._tag === 'Some' &&
            status.value.meta.statusCode === 409 &&
            status.value.meta.body?.error?.type === 'version_conflict_engine_exception'
            ? Effect.succeed({ _tag: 'Conflict' as const })
            : Effect.fail(error);
        })
      );
      if (written._tag === 'Conflict') continue;
      const acknowledged = yield* indexResponse(written.body);
      if (acknowledged._id !== mutation.wallpaperId || acknowledged._index !== this.wallpapers)
        return yield* new SearchRequestError({
          cause: new Error('Wallpaper indexing acknowledgement differs'),
        });
      return { _tag: 'Applied' };
    }
    return yield* new SearchRequestError({
      cause: new Error('Concurrent wallpaper projection retry limit reached'),
    });
  });
  private readonly get = Effect.fnUntraced(function* (
    this: SearchProjection,
    index: string,
    id: string
  ) {
    return yield* this.request(() => this.client.get({ index, id })).pipe(
      Effect.map((result): unknown => result.body),
      Effect.catch((error) => {
        const parsed = storageError(error.cause);
        return parsed._tag === 'Some' &&
          parsed.value.meta.statusCode === 404 &&
          parsed.value.meta.body?.error === undefined
          ? Effect.succeed(null)
          : Effect.fail(error);
      })
    );
  });
}
function read<T, E>(
  operation: string,
  request: Effect.Effect<T, E>
): Effect.Effect<T, CatalogueUnavailable> {
  return measure(operation, request).pipe(
    Effect.mapError((cause) => new CatalogueUnavailable({ cause }))
  );
}
const measure = Effect.fnUntraced(function* <T, E>(
  operation: string,
  request: Effect.Effect<T, E>
) {
  const start = yield* Clock.currentTimeMillis;
  return yield* request.pipe(
    Effect.onExit((exit) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((end) =>
          recordTelemetry(() => {
            const attributes = {
              'opensearch.operation': operation,
              'operation.success': Exit.isSuccess(exit),
            };
            recordCounter('opensearch.operation.total', 1, attributes);
            recordHistogram('opensearch.operation.duration_ms', end - start, attributes);
          })
        )
      )
    )
  );
});
function recordTelemetry(record: () => void): Effect.Effect<void> {
  return Effect.try(record).pipe(Effect.ignore);
}
export function openSearchLayer(
  options: OpenSearchGatewayOptions
): Layer.Layer<OpenSearchGateway | CatalogueRead | ProjectionStore, OpenSearchStartupError> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const active = new Set<{ abort(): void }>();
      const client = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            new Client({
              node: options.url,
              requestTimeout: 10_000,
              maxRetries: 0,
              ...(options.username && options.password
                ? { auth: { username: options.username, password: options.password } }
                : {}),
            }),
          catch: (cause) => startupFailure('initialize-client', cause),
        }),
        (client) =>
          Effect.gen(function* () {
            for (const request of active) request.abort();
            yield* Effect.tryPromise(() => client.close()).pipe(
              Effect.catch((error) => Effect.logError('OpenSearch shutdown failed', error))
            );
          })
      );
      const wallpapers = options.wallpaperIndex ?? 'wallpapers';
      const profiles = options.profileIndex ?? 'profiles';
      const adapter = new SearchProjection(client, active, wallpapers, profiles);
      yield* ensureIndex(adapter, client, wallpapers, wallpapersIndexMapping);
      yield* ensureIndex(adapter, client, profiles, profilesIndexMapping);
      const gateway: OpenSearchGateway = {
        read: adapter,
        projectionStore: adapter,
        check: Effect.fn('catalogue.storage.check')(() =>
          adapter
            .request(() => client.ping())
            .pipe(
              Effect.as(true),
              Effect.catch(() => Effect.succeed(false))
            )
        ),
      };
      return Context.make(OpenSearchGateway, gateway).pipe(
        Context.add(CatalogueRead, adapter),
        Context.add(ProjectionStore, adapter)
      );
    })
  );
}
type IndexMapping = {
  settings?: Record<string, unknown>;
  source?: { excludes: string[] };
  properties: Record<string, unknown>;
};
const indexedMappingField = (type: 'keyword' | 'float' | 'integer' | 'long') =>
  Schema.Struct({
    type: Schema.Literal(type),
    index: Schema.optionalKey(Schema.Boolean),
    doc_values: Schema.optionalKey(Schema.Boolean),
  }).check(Schema.makeFilter((field) => field.index !== false && field.doc_values !== false));
// Projection writes ISO timestamps, including timestamps supplied by upstream events.
const isoDateMappingField = Schema.Struct({
  type: Schema.Literal('date'),
  index: Schema.optionalKey(Schema.Boolean),
  doc_values: Schema.optionalKey(Schema.Boolean),
  format: Schema.optionalKey(Schema.String),
}).check(
  Schema.makeFilter(
    (field) =>
      field.index !== false &&
      field.doc_values !== false &&
      (field.format === undefined ||
        field.format
          .split('||')
          .some(
            (format) =>
              format === 'strict_date_optional_time' ||
              format === 'strict_date_optional_time_nanos' ||
              format === 'date_optional_time'
          ))
  )
);
const disabledMappingObject = Schema.Struct({
  type: Schema.Literal('object'),
  enabled: Schema.Literal(false),
});
const verifyWallpaperMapping = Effect.fnUntraced(function* (
  adapter: SearchProjection,
  client: Client,
  name: string,
  mapping: IndexMapping
) {
  if (mapping.source === undefined) return;

  const actual = yield* adapter
    .request(() => client.indices.getMapping({ index: name }))
    .pipe(Effect.mapError((cause) => startupFailure('inspect-index', cause, name)));
  const observed = Schema.decodeUnknownOption(
    Schema.Struct({
      [name]: Schema.Struct({
        mappings: Schema.Struct({
          _source: Schema.Struct({
            excludes: Schema.Array(Schema.String),
            includes: Schema.optionalKey(Schema.Array(Schema.String)),
            enabled: Schema.optionalKey(Schema.Boolean),
          }),
          properties: Schema.Struct({
            wallpaperId: indexedMappingField('keyword'),
            userId: indexedMappingField('keyword'),
            variants: Schema.Struct({
              type: Schema.Literal('nested'),
              properties: Schema.Struct({
                width: indexedMappingField('integer'),
                height: indexedMappingField('integer'),
                aspectRatio: indexedMappingField('float'),
                format: indexedMappingField('keyword'),
                fileSizeBytes: indexedMappingField('long'),
                createdAt: isoDateMappingField,
              }),
            }),
            colorReady: indexedMappingField('keyword'),
            colorSnapshot: disabledMappingObject,
            colorOrder: Schema.Struct({
              type: Schema.Literal('keyword'),
              index: Schema.Literal(false),
            }),
            variantOrder: disabledMappingObject,
            uploadedAt: isoDateMappingField,
            updatedAt: isoDateMappingField,
            utilities: Schema.Struct({
              type: Schema.optionalKey(Schema.Literal('object')),
              enabled: Schema.optionalKey(Schema.Literal(true)),
              dynamic: Schema.Literal('strict'),
              properties: Schema.Record(Schema.String, indexedMappingField('float')),
            }),
          }),
        }),
      }),
    })
  )(actual.body);
  if (
    observed._tag === 'None' ||
    observed.value[name].mappings._source.enabled === false ||
    (observed.value[name].mappings._source.includes?.length ?? 0) !== 0 ||
    observed.value[name].mappings._source.excludes.length !== 1 ||
    observed.value[name].mappings._source.excludes[0] !== 'utilities' ||
    Object.keys(observed.value[name].mappings.properties.utilities.properties).length !==
      colorUtilityFields.length ||
    !colorUtilityFields.every(
      (key) => observed.value[name].mappings.properties.utilities.properties[key] !== undefined
    )
  )
    return yield* startupFailure(
      'inspect-index',
      new Error('Catalogue wallpaper mapping differs from the required fresh index'),
      name
    );
});
const ensureIndex = Effect.fn('catalogue.storage.ensure-index')(function* (
  adapter: SearchProjection,
  client: Client,
  name: string,
  mapping: IndexMapping
) {
  const exists = yield* adapter
    .request(() => client.indices.exists({ index: name }))
    .pipe(Effect.mapError((cause) => startupFailure('inspect-index', cause, name)));
  if (exists.body) {
    if (mapping.source !== undefined) yield* verifyWallpaperMapping(adapter, client, name, mapping);
    else
      yield* adapter
        .request(() =>
          client.indices.putMapping({ index: name, body: { properties: mapping.properties } })
        )
        .pipe(Effect.mapError((cause) => startupFailure('update-index-mapping', cause, name)));
    return;
  }
  yield* adapter
    .request(() =>
      client.indices.create({
        index: name,
        body: {
          settings: mapping.settings,
          mappings: {
            properties: mapping.properties,
            ...(mapping.source === undefined ? {} : { _source: mapping.source }),
          },
        },
      })
    )
    .pipe(
      Effect.mapError((cause) => startupFailure('create-index', cause, name)),
      Effect.catch((error) =>
        adapter
          .request(() => client.indices.exists({ index: name }))
          .pipe(
            Effect.mapError((cause) => startupFailure('recheck-index', cause, name)),
            Effect.flatMap((result) => (result.body ? Effect.void : Effect.fail(error)))
          )
      )
    );
  yield* verifyWallpaperMapping(adapter, client, name, mapping);
});
