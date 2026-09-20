import { Effect, Layer, ManagedRuntime } from 'effect';
import { CatalogueUnavailable } from '../src/catalogue/index.js';
import { HttpExecution, httpExecutionLayer } from '../src/runtime.js';
import { httpTestLayer } from './unit/http-fixture.js';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import Fastify from 'fastify';
import mercurius from 'mercurius';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  Catalogue,
  Profile,
  SearchOutcome,
  SearchWallpapers,
  Wallpaper,
} from '../src/catalogue/index.js';
import { createGraphql, type MediaUrls } from '../src/graphql/index.js';

const timestamp = '2026-01-01T00:00:00.000Z';
const wallpaper: Wallpaper = {
  wallpaperId: 'wlpr_a',
  profileId: 'profile_a',
  variants: [
    {
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      format: 'image/webp',
      fileSizeBytes: 1234,
      createdAt: timestamp,
    },
  ],
  uploadedAt: timestamp,
  updatedAt: timestamp,
};
const profile: Profile = {
  id: 'profile_a',
  handle: 'artist',
  displayName: 'Artist',
  biographyMarkdown: 'A biography',
  pictureAssetId: 'picture_a',
  claimGeneration: 1,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const page = {
  wallpapers: [wallpaper],
  pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'start', endCursor: 'end' },
};
class Inbound implements Catalogue {
  calls: Array<{ operation: string; input: unknown }> = [];
  searchOutcome: SearchOutcome | CatalogueUnavailable = { _tag: 'Found', value: page };
  wallpaperOutcome: Wallpaper | null | CatalogueUnavailable = wallpaper;
  profileOutcome: Profile | null | CatalogueUnavailable = profile;
  batchOutcome: Array<Profile | null> | CatalogueUnavailable = [profile];
  defect = false;
  search(input: SearchWallpapers) {
    return this.respond('search', input, this.searchOutcome);
  }
  wallpaper(input: string) {
    return this.respond('wallpaper', input, this.wallpaperOutcome);
  }
  profile(input: string) {
    return this.respond('profile', input, this.profileOutcome);
  }
  profileByHandle(input: string) {
    return this.respond('profileByHandle', input, this.profileOutcome);
  }
  profiles(input: string[]) {
    return this.respond('profiles', input, this.batchOutcome);
  }
  private respond<T>(operation: string, input: unknown, value: T | CatalogueUnavailable) {
    this.calls.push({ operation, input });
    return this.defect
      ? Effect.die(new Error('vendor secret: do not disclose'))
      : value instanceof CatalogueUnavailable
        ? Effect.fail(value)
        : Effect.succeed(value);
  }
}
const applications: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});
async function setup(media: Partial<MediaUrls> = {}) {
  const inbound = new Inbound();
  const app = Fastify();
  applications.push(app);
  const runtime = ManagedRuntime.make(
    httpExecutionLayer.pipe(Layer.provide(httpTestLayer(undefined, { catalogue: inbound })))
  );
  app.addHook('onClose', () => runtime.dispose());
  const execution = await runtime.runPromise(HttpExecution);
  const graphql = createGraphql(execution, {
    mediaServiceUrl: 'http://media:3000/',
    mediaPublicPath: '/media',
    ...media,
  });
  await app.register(mercurius, { ...graphql });
  await app.ready();
  return {
    app,
    inbound,
    graphql,
    query: async (query: string, headers: Record<string, string> = {}) => {
      const response = await app.inject({
        method: 'POST',
        url: '/graphql',
        headers,
        payload: { query },
      });
      return { status: response.statusCode, body: response.json() };
    },
  };
}
describe('GraphQL driving adapter contract', () => {
  it('translates filters, legacy identity, pagination and color preferences into the inbound query', async () => {
    const { query, inbound } = await setup();
    const response = await query(
      `{ searchWallpapers(filter:{profileId:"profile_a",userId:"ignored",variants:{width:1920,height:1080,aspectRatio:1.77,format:"image/webp"}},sort:{color:{colors:[{color:"#FF0000",amount:2,spread:0.3}]}},first:2,after:"cursor") {edges{node{wallpaperId}}pageInfo{hasNextPage hasPreviousPage startCursor endCursor}} }`
    );
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(inbound.calls).toEqual([
      {
        operation: 'search',
        input: {
          profileId: 'profile_a',
          variants: { width: 1920, height: 1080, aspectRatio: 1.77, format: 'image/webp' },
          colors: [{ color: '#FF0000', amount: 2, spread: 0.3 }],
          first: 2,
          after: 'cursor',
        },
      },
    ]);
    expect(response.body.data.searchWallpapers).toEqual({
      edges: [{ node: { wallpaperId: 'wlpr_a' } }],
      pageInfo: page.pageInfo,
    });
  });
  it('translates omitted and null color spread into the capability default', async () => {
    const { query, inbound } = await setup();
    const response = await query(
      '{searchWallpapers(sort:{color:{colors:[{color:"#FF0000",amount:1},{color:"#0000FF",amount:2,spread:null}]}}){edges{node{wallpaperId}}}}'
    );
    expect(response.body.errors).toBeUndefined();
    expect(inbound.calls[0]).toMatchObject({
      input: {
        colors: [
          { color: '#FF0000', amount: 1, spread: undefined },
          { color: '#0000FF', amount: 2, spread: undefined },
        ],
      },
    });
  });
  it('maps deprecated userId to the local Profile identifier and translates nullable inputs', async () => {
    const { query, inbound } = await setup();
    const response = await query(
      `{searchWallpapers(filter:{userId:"legacy",variants:{width:null}},sort:null,first:null,last:3,before:"before",after:null){edges{node{userId profileId}}}}`
    );
    expect(response.body.data.searchWallpapers.edges).toEqual([
      { node: { userId: 'profile_a', profileId: 'profile_a' } },
    ]);
    expect(inbound.calls[0]).toMatchObject({
      input: { profileId: 'legacy', last: 3, before: 'before', variants: { width: undefined } },
    });
  });
  it('returns every public wallpaper and variant field and builds the fallback media URL', async () => {
    const { query, inbound } = await setup();
    const response = await query(
      `{getWallpaper(wallpaperId:"wlpr_a"){wallpaperId profileId userId uploadedAt updatedAt variants{width height aspectRatio format fileSizeBytes createdAt url}}}`
    );
    expect(response.body.data.getWallpaper).toEqual({
      ...wallpaper,
      userId: 'profile_a',
      variants: [
        {
          ...wallpaper.variants[0],
          url: 'http://media:3000/wallpapers/wlpr_a?w=1920&h=1080&format=image/webp',
        },
      ],
    });
    expect(inbound.calls).toEqual([{ operation: 'wallpaper', input: 'wlpr_a' }]);
  });
  it.each([
    [{ origin: 'https://public.example' }, 'https://public.example/media'],
    [
      { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'proxy.example, internal' },
      'https://proxy.example/media',
    ],
    [{ origin: 'invalid' }, 'http://media:3000'],
    [{ origin: 'ftp://public.example' }, 'http://media:3000'],
    [{ origin: 'https://public.example/path' }, 'http://media:3000'],
    [{ 'x-forwarded-proto': 'https' }, 'http://media:3000'],
    [{ 'x-forwarded-proto': 'ftp', 'x-forwarded-host': 'proxy.example' }, 'http://media:3000'],
    [{ 'x-forwarded-proto': ',', 'x-forwarded-host': ',' }, 'http://media:3000'],
  ])('resolves media URLs from parsed request headers %j', async (headers, base) => {
    const { query } = await setup();
    const response = await query('{getWallpaper(wallpaperId:"wlpr_a"){variants{url}}}', headers);
    expect(response.body.data.getWallpaper.variants[0].url).toBe(
      `${base}/wallpapers/wlpr_a?w=1920&h=1080&format=image/webp`
    );
  });
  it('prioritizes configured public media URL and normalizes its trailing slash', async () => {
    const { query } = await setup({ mediaPublicBaseUrl: 'https://cdn.example/assets///' });
    const response = await query('{getWallpaper(wallpaperId:"wlpr_a"){variants{url}}}', {
      origin: 'https://ignored.example',
    });
    expect(response.body.data.getWallpaper.variants[0].url).toContain(
      'https://cdn.example/assets/wallpapers/'
    );
  });
  it('normalizes a relative public media path', async () => {
    const { query } = await setup({ mediaPublicPath: 'images/' });
    const response = await query('{getWallpaper(wallpaperId:"wlpr_a"){variants{url}}}', {
      origin: 'https://public.example',
    });
    expect(response.body.data.getWallpaper.variants[0].url).toContain(
      'https://public.example/images/wallpapers/'
    );
  });
  it('supports resolver execution without a request context and array header values', async () => {
    const { graphql } = await setup();
    const parent = {
      ...wallpaper.variants[0],
      wallpaperId: 'wlpr_a',
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      format: 'image/webp',
      fileSizeBytes: 1234,
      createdAt: timestamp,
    };
    expect(graphql.resolvers.Variant.url(parent, {}, {})).toContain(
      'http://media:3000/wallpapers/'
    );
    expect(
      graphql.resolvers.Variant.url(
        parent,
        {},
        {
          reply: {
            request: {
              headers: {
                'x-forwarded-proto': 'https',
                'x-forwarded-host': ['first.example', 'second.example'],
              },
            },
          },
        }
      )
    ).toContain('https://first.example/media/wallpapers/');
  });
  it('returns Profiles by ID and Handle, public picture and canonical path', async () => {
    const { query, inbound } = await setup();
    const response = await query(
      '{profile(id:"profile_a"){id handle displayName biographyMarkdown version createdAt updatedAt canonicalPath picture{id url}} profileByHandle(handle:"ARTIST"){id}}'
    );
    expect(response.body.data.profile).toEqual({
      id: 'profile_a',
      handle: 'artist',
      displayName: 'Artist',
      biographyMarkdown: 'A biography',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      canonicalPath: '/profiles/@artist',
      picture: { id: 'picture_a', url: 'http://media:3000/profile-pictures/picture_a' },
    });
    expect(response.body.data.profileByHandle).toEqual({ id: 'profile_a' });
    expect(inbound.calls).toContainEqual({ operation: 'profile', input: 'profile_a' });
    expect(inbound.calls).toContainEqual({ operation: 'profileByHandle', input: 'ARTIST' });
  });
  it('preserves null missing records and absent Profile pictures', async () => {
    const { query, inbound } = await setup();
    inbound.wallpaperOutcome = null;
    inbound.profileOutcome = null;
    expect(
      (
        await query(
          '{getWallpaper(wallpaperId:"wlpr_missing"){wallpaperId} profile(id:"missing"){id} profileByHandle(handle:"missing"){id}}'
        )
      ).body.data
    ).toEqual({ getWallpaper: null, profile: null, profileByHandle: null });
    inbound.profileOutcome = { ...profile, pictureAssetId: null };
    expect(
      (await query('{profile(id:"profile_a"){picture{id}}}')).body.data.profile.picture
    ).toBeNull();
  });
  it('scopes nested wallpaper reads to the resolved Profile', async () => {
    const { query, inbound } = await setup();
    const response = await query(
      '{profile(id:"profile_a"){wallpapers(first:2,after:"next"){edges{node{wallpaperId}}}}}'
    );
    expect(response.body.errors).toBeUndefined();
    expect(inbound.calls).toContainEqual({
      operation: 'search',
      input: { profileId: 'profile_a', first: 2, after: 'next' },
    });
  });
  it('batches contributor reads and preserves missing slots and duplicates', async () => {
    const { query, inbound } = await setup();
    inbound.searchOutcome = {
      _tag: 'Found',
      value: {
        ...page,
        wallpapers: [
          wallpaper,
          { ...wallpaper, wallpaperId: 'wlpr_b', profileId: 'missing' },
          { ...wallpaper, wallpaperId: 'wlpr_c' },
        ],
      },
    };
    inbound.batchOutcome = [profile, null, profile];
    const response = await query('{searchWallpapers{edges{node{wallpaperId profile{id}}}}}');
    expect(response.body.errors).toBeUndefined();
    expect(
      response.body.data.searchWallpapers.edges.map(
        (edge: { node: { profile: unknown } }) => edge.node.profile
      )
    ).toEqual([{ id: 'profile_a' }, null, { id: 'profile_a' }]);
    expect(inbound.calls.filter((call) => call.operation === 'profiles')).toEqual([
      { operation: 'profiles', input: ['profile_a', 'missing', 'profile_a'] },
    ]);
  });
  it.each([
    [
      new CatalogueUnavailable({ cause: new Error('private storage failure') }),
      'SERVICE_UNAVAILABLE',
      'The catalogue is temporarily unavailable',
    ],
    [{ _tag: 'InvalidCursor' }, 'INVALID_CURSOR', 'Invalid or expired cursor'],
    [
      { _tag: 'InvalidSearch', reason: 'Page size must be a positive integer' },
      'BAD_USER_INPUT',
      'Page size must be a positive integer',
    ],
  ] as const)('translates search outcome %j into GraphQL extensions', async (outcome, code, message) => {
    const { query, inbound } = await setup();
    inbound.searchOutcome = outcome;
    const response = await query('{searchWallpapers{edges{node{wallpaperId}}}}');
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
    expect(response.body.errors).toEqual([
      expect.objectContaining({ message, extensions: { code } }),
    ]);
  });
  it.each([
    'getWallpaper(wallpaperId:"wlpr_a"){wallpaperId}',
    'profile(id:"profile_a"){id}',
    'profileByHandle(handle:"artist"){id}',
    'searchWallpapers{edges{node{profile{id}}}}',
  ])('translates read unavailability for %s', async (field) => {
    const { query, inbound } = await setup();
    inbound.wallpaperOutcome = new CatalogueUnavailable({
      cause: new Error('private storage failure'),
    });
    inbound.profileOutcome = new CatalogueUnavailable({
      cause: new Error('private storage failure'),
    });
    inbound.batchOutcome = new CatalogueUnavailable({
      cause: new Error('private storage failure'),
    });
    const response = await query(`{${field}}`);
    expect(response.body.errors[0]).toMatchObject({
      message: 'The catalogue is temporarily unavailable',
      extensions: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
  it('hides unexpected Effect defects', async () => {
    const { query, inbound } = await setup();
    inbound.defect = true;
    const response = await query('{getWallpaper(wallpaperId:"wlpr_a"){wallpaperId}}');
    expect(response.body.errors[0]).toMatchObject({
      message: 'An unexpected error occurred',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
    expect(JSON.stringify(response)).not.toContain('vendor secret');
  });
  it.each([
    'getWallpaper(wallpaperId:""){wallpaperId}',
    'getWallpaper(wallpaperId:"invalid"){wallpaperId}',
    'profile(id:""){id}',
    'profileByHandle(handle:""){id}',
  ])('rejects invalid external identity before invoking the capability: %s', async (field) => {
    const { query, inbound } = await setup();
    const response = await query(`{${field}}`);
    expect(response.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    expect(inbound.calls).toEqual([]);
  });
  it.each([
    '{getWallpaper{wallpaperId}}',
    '{unknownField}',
    '{',
  ])('retains GraphQL syntax/validation errors: %s', async (queryText) => {
    const { query, inbound } = await setup();
    const response = await query(queryText);
    expect(response.status).toBe(400);
    expect(response.body.errors.length).toBeGreaterThan(0);
    expect(inbound.calls).toEqual([]);
  });
  it('rejects structurally invalid resolver arguments without leaking library details', async () => {
    const { graphql, inbound } = await setup();
    await expect(
      graphql.resolvers.Query.searchWallpapers(
        {},
        { sort: { color: { colors: [{ color: '#FF0000', amount: 'secret' }] } } }
      )
    ).rejects.toMatchObject({
      message: 'Invalid query arguments',
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(inbound.calls).toEqual([]);
  });
  it('preserves the query throughput, duration and result count dashboard metrics', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    try {
      const { query } = await setup();
      await query(
        '{searchWallpapers{edges{node{wallpaperId}}} getWallpaper(wallpaperId:"wlpr_a"){wallpaperId}}'
      );
      await provider.forceFlush();
      const observed = exporter
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
      expect(observed.map((metric) => metric.descriptor.name).sort()).toEqual([
        'graphql.query.duration_ms',
        'graphql.query.result_count',
        'graphql.query.total',
      ]);
      const counter = observed.find((metric) => metric.descriptor.name === 'graphql.query.total');
      expect(
        counter?.dataPoints.map((point) => ({ attributes: point.attributes, value: point.value }))
      ).toEqual(
        expect.arrayContaining([
          { attributes: { operation: 'searchWallpapers' }, value: 1 },
          { attributes: { operation: 'getWallpaper', found: 'true' }, value: 1 },
        ])
      );
    } finally {
      metrics.disable();
      await provider.shutdown();
    }
  });
  it('preserves query success when metric recording fails', async () => {
    metrics.setGlobalMeterProvider({
      getMeter() {
        throw new Error('metric exporter failed');
      },
    });
    try {
      const { query } = await setup();
      const response = await query('{searchWallpapers{edges{node{wallpaperId}}}}');
      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.searchWallpapers.edges).toHaveLength(1);
    } finally {
      metrics.disable();
    }
  });
});
