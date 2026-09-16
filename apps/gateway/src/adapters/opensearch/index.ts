import { Client } from '@opensearch-project/opensearch';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Clock, Context, Effect, Exit, Layer, Schema } from 'effect';
import {
  CatalogueRead,
  CatalogueUnavailable,
  type ReadOutcome,
  type SearchSelection,
} from '../../catalogue/index.js';
import {
  type ProjectionMutation,
  ProjectionStore,
  ProjectionUnavailable,
  type ProjectionWrite,
} from '../../projection/index.js';
import {
  partialWallpaperResponse,
  profileBatchResponse,
  profileResponse,
  profileSearchResponse,
  storageError,
  toWallpaper,
  updateResponse,
  wallpaperResponse,
  wallpaperSearchResponse,
} from './documents.js';
import { profilesIndexMapping, wallpapersIndexMapping } from './mappings.js';
import { searchBody } from './query.js';
import { projectionUpdate } from './scripts.js';

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
  { cause: Schema.Defect() }
) {}
class SearchRequestError extends Schema.TaggedError<SearchRequestError>()('SearchRequestError', {
  cause: Schema.Defect(),
}) {}

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
        const result = yield* this.request(() =>
          this.client.search({
            index: this.profilesIndex,
            body: {
              query: { term: { handle: handle.toLowerCase() } },
              sort: [{ claimGeneration: 'desc' }],
              size: 1,
            },
          })
        );
        return (yield* profileSearchResponse(result.body)).hits.hits[0]?._source ?? null;
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
  readonly search = Effect.fn('catalogue.storage.search')((selection: SearchSelection) =>
    read(
      'search',
      Effect.gen({ self: this }, function* () {
        const result = yield* this.request(() =>
          this.client.search({ index: this.wallpapers, body: searchBody(selection) })
        );
        const { hits } = yield* wallpaperSearchResponse(result.body);
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
      PublishColors: 'add_color_data',
      PublishProfile: 'profile_project',
    }[mutation._tag];
    return measure(
      operation,
      Effect.gen({ self: this }, function* (): Effect.fn.Return<
        ProjectionWrite,
        SearchRequestError | Schema.SchemaError
      > {
        const result = yield* this.request(() =>
          this.client.update({
            index: mutation._tag === 'PublishProfile' ? this.profilesIndex : this.wallpapers,
            id: mutation._tag === 'PublishProfile' ? mutation.profile.id : mutation.wallpaperId,
            body: projectionUpdate(mutation),
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
): Effect.Effect<ReadOutcome<T>, CatalogueUnavailable> {
  return measure(operation, request).pipe(
    Effect.map((value): ReadOutcome<T> => ({ _tag: 'Found', value })),
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
          catch: (cause) => new OpenSearchStartupError({ cause }),
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
const ensureIndex = Effect.fn('catalogue.storage.ensure-index')(
  function* (
    adapter: SearchProjection,
    client: Client,
    name: string,
    mapping: { settings?: Record<string, unknown>; properties: Record<string, unknown> }
  ) {
    const exists = yield* adapter.request(() => client.indices.exists({ index: name }));
    if (exists.body) {
      yield* adapter.request(() =>
        client.indices.putMapping({ index: name, body: { properties: mapping.properties } })
      );
      return;
    }
    yield* adapter
      .request(() =>
        client.indices.create({
          index: name,
          body: { settings: mapping.settings, mappings: { properties: mapping.properties } },
        })
      )
      .pipe(
        Effect.catch((error) =>
          adapter
            .request(() => client.indices.exists({ index: name }))
            .pipe(Effect.flatMap((result) => (result.body ? Effect.void : Effect.fail(error))))
        )
      );
  },
  Effect.mapError((cause) => new OpenSearchStartupError({ cause }))
);
