import { Client } from '@opensearch-project/opensearch';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Effect } from 'effect';
import type {
  CatalogueRead,
  Profile,
  ReadOutcome,
  SearchBatch,
  SearchSelection,
  Wallpaper,
} from '../../catalogue/index.js';
import type {
  ProjectionMutation,
  ProjectionStore,
  ProjectionWrite,
} from '../../projection/index.js';
import {
  partialWallpaperResponse,
  profileBatchResponse,
  profileResponse,
  profileSearchResponse,
  storageError,
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
  start(): Promise<void>;
  stop(): Promise<void>;
  check(): Promise<boolean>;
}

class SearchProjection implements CatalogueRead, ProjectionStore {
  constructor(
    private readonly client: Client,
    private readonly wallpapers: string,
    private readonly profilesIndex: string
  ) {}

  wallpaper(id: string): Effect.Effect<ReadOutcome<Wallpaper | null>> {
    return read('wallpaper', async () => {
      const result = await this.get(this.wallpapers, id);
      if (result === null) return null;
      const partial = partialWallpaperResponse.parse(result);
      if (partial._source.userId === undefined) return null;
      return wallpaperResponse.parse(result)._source;
    });
  }

  profile(id: string): Effect.Effect<ReadOutcome<Profile | null>> {
    return read('profile', async () => {
      const result = await this.get(this.profilesIndex, id);
      return result === null ? null : profileResponse.parse(result)._source;
    });
  }

  profileByHandle(handle: string): Effect.Effect<ReadOutcome<Profile | null>> {
    return read('profile-by-handle', async () => {
      const result = await this.client.search({
        index: this.profilesIndex,
        body: {
          query: { term: { handle: handle.toLowerCase() } },
          sort: [{ claimGeneration: 'desc' }],
          size: 1,
        },
      });
      return profileSearchResponse.parse(result.body).hits.hits[0]?._source ?? null;
    });
  }

  profiles(ids: string[]): Effect.Effect<ReadOutcome<Array<Profile | null>>> {
    return read('profiles', async () => {
      if (ids.length === 0) return [];
      const result = await this.client.mget({ index: this.profilesIndex, body: { ids } });
      const documents = profileBatchResponse.parse(result.body).docs;
      if (documents.length !== ids.length) throw new Error('Invalid profile batch response');
      return documents;
    });
  }

  search(selection: SearchSelection): Effect.Effect<ReadOutcome<SearchBatch>> {
    return read('search', async () => {
      const result = await this.client.search({
        index: this.wallpapers,
        body: searchBody(selection),
      });
      const { hits } = wallpaperSearchResponse.parse(result.body);
      recordTelemetry(() =>
        recordHistogram('opensearch.search.results', hits.total.value, {
          'opensearch.index': this.wallpapers,
        })
      );
      return {
        entries: hits.hits.map((hit) => ({ wallpaper: hit._source, cursor: hit.sort })),
        total: hits.total.value,
      };
    });
  }

  apply(mutation: ProjectionMutation): Effect.Effect<ProjectionWrite> {
    return Effect.tryPromise({
      try: (): Promise<ProjectionWrite> =>
        measure(
          {
            PublishWallpaper: 'upsert',
            PublishVariant: 'add_variant',
            PublishColors: 'add_color_data',
            PublishProfile: 'profile_project',
          }[mutation._tag],
          async () => {
            const result = await this.client.update({
              index: mutation._tag === 'PublishProfile' ? this.profilesIndex : this.wallpapers,
              id: mutation._tag === 'PublishProfile' ? mutation.profile.id : mutation.wallpaperId,
              body: projectionUpdate(mutation),
              refresh: true,
              retry_on_conflict: 5,
            });
            return updateResponse.parse(result.body).result === 'noop'
              ? { _tag: 'Unchanged' }
              : { _tag: 'Applied' };
          }
        ),
      catch: (error): ProjectionWrite => {
        const parsed = storageError.safeParse(error);
        const type = parsed.success ? parsed.data.meta.body?.error?.type : undefined;
        return type === 'mapper_parsing_exception' || type === 'strict_dynamic_mapping_exception'
          ? { _tag: 'Rejected' }
          : { _tag: 'Unavailable' };
      },
    }).pipe(Effect.catchAll(Effect.succeed), Effect.withSpan('catalogue.storage.project'));
  }

  private async get(index: string, id: string): Promise<unknown> {
    try {
      const result = await this.client.get({ index, id });
      return result.body;
    } catch (error) {
      const parsed = storageError.safeParse(error);
      if (
        parsed.success &&
        parsed.data.meta.statusCode === 404 &&
        parsed.data.meta.body?.error === undefined
      )
        return null;
      throw error;
    }
  }
}

function read<T>(
  operation: 'wallpaper' | 'profile' | 'profile-by-handle' | 'profiles' | 'search',
  request: () => Promise<T>
): Effect.Effect<ReadOutcome<T>> {
  const metricOperation = {
    wallpaper: 'get',
    profile: 'get',
    'profile-by-handle': 'search',
    profiles: 'mget',
    search: 'search',
  }[operation];
  return Effect.tryPromise({
    try: async (): Promise<ReadOutcome<T>> => ({
      _tag: 'Found',
      value: await measure(metricOperation, request),
    }),
    catch: (): ReadOutcome<T> => ({ _tag: 'Unavailable' }),
  }).pipe(Effect.catchAll(Effect.succeed), Effect.withSpan(`catalogue.storage.${operation}`));
}

async function measure<T>(operation: string, request: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let success = false;
  try {
    const result = await request();
    success = true;
    return result;
  } finally {
    const attributes = { 'opensearch.operation': operation, 'operation.success': success };
    recordTelemetry(() => {
      recordCounter('opensearch.operation.total', 1, attributes);
      recordHistogram('opensearch.operation.duration_ms', performance.now() - start, attributes);
    });
  }
}

function recordTelemetry(record: () => void): void {
  try {
    record();
  } catch {
    /* Observability cannot change a committed projection or a read outcome. */
  }
}

export function createOpenSearchGateway(options: OpenSearchGatewayOptions): OpenSearchGateway {
  const client = new Client({
    node: options.url,
    requestTimeout: 10_000,
    ...(options.username && options.password
      ? { auth: { username: options.username, password: options.password } }
      : {}),
  });
  const wallpapers = options.wallpaperIndex ?? 'wallpapers';
  const profiles = options.profileIndex ?? 'profiles';
  const adapter = new SearchProjection(client, wallpapers, profiles);
  return {
    read: adapter,
    projectionStore: adapter,
    async start() {
      await ensureIndex(client, wallpapers, wallpapersIndexMapping);
      await ensureIndex(client, profiles, profilesIndexMapping);
    },
    async stop() {
      await client.close();
    },
    async check() {
      try {
        await client.ping();
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function ensureIndex(
  client: Client,
  name: string,
  mapping: { settings?: Record<string, unknown>; properties: Record<string, unknown> }
): Promise<void> {
  const exists = await client.indices.exists({ index: name });
  if (exists.body) {
    await client.indices.putMapping({ index: name, body: { properties: mapping.properties } });
    return;
  }
  try {
    await client.indices.create({
      index: name,
      body: { settings: mapping.settings, mappings: { properties: mapping.properties } },
    });
  } catch (error) {
    // Concurrent gateway instances may create the same index during startup.
    if (!(await client.indices.exists({ index: name })).body) throw error;
  }
}
