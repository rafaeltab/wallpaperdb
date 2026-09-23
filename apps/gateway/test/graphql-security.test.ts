import { Effect } from 'effect';
import { metrics } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { HttpConfig } from '../src/http/index.js';
import type { HttpTestServices } from './unit/http-fixture.js';
import { createTestHttpApp, EmptyCatalogue, httpConfig } from './unit/http-fixture.js';
const apps: FastifyInstance[] = [];
class ObservedCatalogue extends EmptyCatalogue {
  calls: string[] = [];
  override search() {
    this.calls.push('search');
    return super.search();
  }
  override profile() {
    this.calls.push('profile');
    return super.profile();
  }
}
async function build(overrides: Partial<HttpConfig> = {}, ports: Partial<HttpTestServices> = {}) {
  const config = { ...httpConfig, ...overrides };
  const app = await createTestHttpApp(config, ports);
  apps.push(app);
  return app;
}
const query = '{ searchWallpapers(first:10) { edges { node { wallpaperId variants { url } } } } }';
const nestedQueries = [
  `{
    searchWallpapers(first:10) {
      edges { node { profile { wallpapers(first:10) {
        edges { node { profile { wallpapers(first:10) {
          edges { node { wallpaperId } }
        } } } }
      } } } }
    }
  }`,
  `{
    searchWallpapers(first: 10) { ...P1 }
  }
  fragment P1 on WallpaperConnection {
    edges { node { profile { wallpapers(first: 10) { ...P2 } } } }
  }
  fragment P2 on WallpaperConnection {
    edges { node { profile { wallpapers(first: 10) { ...P3 } } } }
  }
  fragment P3 on WallpaperConnection {
    edges { node { wallpaperId } }
  }`,
];
async function execute(
  app: FastifyInstance,
  text = query,
  variables?: Record<string, unknown>,
  operationName?: string
) {
  return app.inject({
    method: 'POST',
    url: '/graphql',
    payload: { query: text, variables, operationName },
  });
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe('GraphQL security driving contract', () => {
  it('accepts depth-limit queries, returns rate headers and ignores spoofed forwarded IP', async () => {
    const app = await build();
    const result = await execute(app);
    expect(result.statusCode).toBe(200);
    expect(result.json().errors).toBeUndefined();
    expect(result.headers['x-ratelimit-remaining']).toBe('99');
    expect(result.headers['x-ratelimit-reset']).toBeDefined();
  });
  it('rejects queries over the depth limit', async () => {
    const app = await build({ graphqlMaxDepth: 4 });
    expect((await execute(app)).json().errors).toBeDefined();
  });
  it('admits the shipped 20-wallpaper browse query under the production default budget', async () => {
    const catalogue = new ObservedCatalogue();
    const config = loadConfig({
      NODE_ENV: 'production',
      OPENSEARCH_URL: 'http://127.0.0.1:9200',
      NATS_URL: 'nats://127.0.0.1:4222',
      MEDIA_SERVICE_URL: 'http://127.0.0.1:3003',
      CURSOR_SECRET: 'test-secret-000000000000000000000000',
    });
    const app = await build(config, { catalogue });
    const text = `
      query SearchWallpapers($filter:WallpaperFilter,$sort:WallpaperSort,$first:Int,$after:String) {
        searchWallpapers(filter:$filter,sort:$sort,first:$first,after:$after) {
          edges {
            node {
              wallpaperId profileId uploadedAt updatedAt
              variants {width height aspectRatio format fileSizeBytes createdAt url}
            }
          }
          pageInfo {hasNextPage hasPreviousPage startCursor endCursor}
        }
      }
    `;
    expect((await execute(app, text, { first: 20 })).json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['search']);
    catalogue.calls.length = 0;
    expect((await execute(app, nestedQueries[1])).json().errors).toBeDefined();
    expect(catalogue.calls).toEqual([]);
    const strict = await build({ ...config, graphqlMaxComplexity: 1505 }, { catalogue });
    expect((await execute(strict, text, { first: 20 })).json().errors?.[0].extensions).toEqual({
      code: 'COMPLEXITY_LIMIT_EXCEEDED',
      complexity: 1506,
      maxComplexity: 1505,
    });
    expect(catalogue.calls).toEqual([]);
  });
  it.each(
    nestedQueries
  )('rejects nested page expansion before catalogue work: %s', async (text) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({}, { catalogue });
    expect((await execute(app, text)).json().errors).toBeDefined();
    expect(catalogue.calls).toEqual([]);
  });
  it.each(nestedQueries)('applies depth limits through fragment boundaries: %s', async (text) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxComplexity: 100_000 }, { catalogue });
    expect((await execute(app, text)).json().errors?.[0].extensions.code).toBe(
      'DEPTH_LIMIT_EXCEEDED'
    );
    expect(catalogue.calls).toEqual([]);
  });
  it.each(nestedQueries)('multiplies descendant costs by each parent page: %s', async (text) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxDepth: 20 }, { catalogue });
    expect((await execute(app, text)).json().errors?.[0].extensions.code).toBe(
      'COMPLEXITY_LIMIT_EXCEEDED'
    );
    expect(catalogue.calls).toEqual([]);
  });
  it('charges a reused fragment at each different parent position', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxComplexity: 75 }, { catalogue });
    const response = await execute(
      app,
      `
      { a:profile(id:"profile_a"){...Page} b:profile(id:"profile_b"){...Page} }
      fragment Page on Profile {wallpapers(first:3){edges{node{wallpaperId}}}}
    `
    );
    expect(response.json().errors?.[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
    expect(catalogue.calls).toEqual([]);
  });
  it('counts reused aliases at each different parent position', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxAliases: 3 }, { catalogue });
    const response = await execute(
      app,
      `
      { a:profile(id:"profile_a"){...ProfileName} b:profile(id:"profile_b"){...ProfileName} }
      fragment ProfileName on Profile {name:handle}
    `
    );
    expect(response.json().errors?.[0].extensions).toMatchObject({
      code: 'BREADTH_LIMIT_EXCEEDED',
      aliases: 4,
    });
    expect(catalogue.calls).toEqual([]);
  });
  it.each([
    14, 15,
  ])('merges repeated response fields and unions their children at cost %i', async (limit) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxComplexity: limit, graphqlMaxAliases: 1 }, { catalogue });
    const response = await execute(
      app,
      `
      { profile(id:"profile_a"){...Page ...Page ...More} }
      fragment Page on Profile {page:wallpapers(first:1){edges{node{wallpaperId}}}}
      fragment More on Profile {page:wallpapers(first:1){edges{node{profileId}}}}
    `
    );
    if (limit === 15) {
      expect(response.json().errors).toBeUndefined();
      expect(catalogue.calls).toEqual(['profile']);
    } else {
      expect(response.json().errors?.[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
      expect(catalogue.calls).toEqual([]);
    }
  });
  it.each([
    {
      placement: 'field',
      selection: 'searchWallpapers(first:100) @include(if:$include){edges{node{wallpaperId}}}',
      fragment: '',
    },
    {
      placement: 'spread',
      selection: '...Expensive @include(if:$include)',
      fragment:
        'fragment Expensive on Query {searchWallpapers(first:100){edges{node{wallpaperId}}}}',
    },
    {
      placement: 'inline fragment',
      selection:
        '... on Query @include(if:$include){searchWallpapers(first:100){edges{node{wallpaperId}}}}',
      fragment: '',
    },
  ])('honors coerced directives on a $placement', async ({ selection, fragment }) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxComplexity: 10 }, { catalogue });
    const text = `query($include:Boolean=false){profile(id:"profile_a"){id} ${selection}} ${fragment}`;
    expect((await execute(app, text)).json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['profile']);
    catalogue.calls.length = 0;
    expect((await execute(app, text, { include: true })).json().errors?.[0].extensions.code).toBe(
      'COMPLEXITY_LIMIT_EXCEEDED'
    );
    expect(catalogue.calls).toEqual([]);
  });
  it('gives skip precedence over include and does not count skipped depth or aliases', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build(
      { graphqlMaxDepth: 2, graphqlMaxAliases: 1, graphqlMaxComplexity: 2 },
      { catalogue }
    );
    const response = await execute(
      app,
      `{
      profile(id:"profile_a"){id}
      ... on Query @skip(if:true) @include(if:true) {
        a:searchWallpapers{edges{node{wallpaperId}}}
        b:searchWallpapers{edges{node{wallpaperId}}}
      }
    }`
    );
    expect(response.json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['profile']);
  });
  it('limits depth only for the selected operation', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({}, { catalogue });
    const text = `query Small{profile(id:"profile_a"){id}} query Large${nestedQueries[0]}`;
    expect((await execute(app, text, undefined, 'Small')).json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['profile']);
    catalogue.calls.length = 0;
    expect((await execute(app, text, undefined, 'Large')).json().errors).toBeDefined();
    expect(catalogue.calls).toEqual([]);
  });
  it('collects a diamond fragment graph without expanding repeated selections', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxDepth: 2, graphqlMaxComplexity: 2 }, { catalogue });
    const fragments = Array.from(
      { length: 40 },
      (_, i) => `fragment F${i} on Profile {${i === 39 ? 'id' : `...F${i + 1} ...F${i + 1}`}}`
    ).join('\n');
    const response = await execute(app, `{profile(id:"profile_a"){...F0}} ${fragments}`);
    expect(response.json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['profile']);
  });
  it('stops costing a branching fragment graph as soon as its work budget is exceeded', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxDepth: 500, graphqlMaxAliases: 1000 }, { catalogue });
    const fragments = Array.from({ length: 40 }, (_, i) => {
      const child = i === 39 ? 'id' : `...F${i + 1}`;
      return `fragment F${i} on Profile {
        a:wallpapers(first:1){edges{node{profile{${child}}}}}
        b:wallpapers(first:1){edges{node{profile{${child}}}}}
      }`;
    }).join('\n');
    const response = await execute(app, `{profile(id:"profile_a"){...F0}} ${fragments}`);
    expect(response.json().errors?.[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
    expect(catalogue.calls).toEqual([]);
  });
  it('does not add depth for inline fragments or multiply connection metadata by page size', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxDepth: 3, graphqlMaxComplexity: 102 }, { catalogue });
    const response = await execute(
      app,
      `{
      ... { ... on Query {
        searchWallpapers(first:10) { ... on WallpaperConnection {pageInfo{hasNextPage}} }
      } }
    }`
    );
    expect(response.json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['search']);
  });
  it.each([1, 11])('rejects batch arrays of size %i in GraphQL format', async (size) => {
    const app = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/graphql',
      payload: Array.from({ length: size }, () => ({ query })),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].extensions.code).toBe(
      size > 10 ? 'BATCH_LIMIT_EXCEEDED' : 'BATCH_NOT_SUPPORTED'
    );
  });
  it('counts unique fields and aliases independently', async () => {
    const app = await build({ graphqlMaxAliases: 1 });
    const aliases = await execute(
      app,
      '{ a:getWallpaper(wallpaperId:"wlpr_a"){wallpaperId} b:getWallpaper(wallpaperId:"wlpr_b"){wallpaperId} }'
    );
    expect(aliases.json().errors[0].extensions.code).toBe('BREADTH_LIMIT_EXCEEDED');
    const narrow = await build({ graphqlMaxUniqueFields: 1 });
    expect((await execute(narrow)).json().errors[0].message).toContain('unique fields');
  });
  it('prices Profile wallpaper reads and literal/variable first and last arguments', async () => {
    const app = await build({ graphqlMaxComplexity: 1000 });
    const expensive = await execute(
      app,
      '{ profile(id:"user_a") { wallpapers(first:100) { edges { node { wallpaperId } } } } }'
    );
    expect(expensive.json().errors[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
    const variable = await execute(
      app,
      'query($size:Int){searchWallpapers(last:$size){edges{node{wallpaperId}}}}',
      { size: 100 }
    );
    expect(variable.json().errors[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
    expect(
      (await execute(app, '{getWallpaper(wallpaperId:"wlpr_a"){wallpaperId}}')).json().errors
    ).toBeUndefined();
  });
  describe.each([
    'searchWallpapers',
    'Profile.wallpapers',
  ])('effective pagination for %s', (field) => {
    it.each([
      { label: 'literal first', args: '(first:80)', size: 80 },
      { label: 'literal last', args: '(last:80)', size: 80 },
      {
        label: 'supplied first variable',
        definition: '($size:Int)',
        args: '(first:$size)',
        variables: { size: 80 },
        size: 80,
      },
      {
        label: 'default first variable',
        definition: '($size:Int=80)',
        args: '(first:$size)',
        size: 80,
      },
      {
        label: 'supplied last variable',
        definition: '($size:Int)',
        args: '(last:$size)',
        variables: { size: 80 },
        size: 80,
      },
      {
        label: 'default last variable',
        definition: '($size:Int=80)',
        args: '(last:$size)',
        size: 80,
      },
      { label: 'null first with last', args: '(first:null,last:80)', size: 80 },
      {
        label: 'omitted first variable with last',
        definition: '($first:Int)',
        args: '(first:$first,last:80)',
        size: 80,
      },
      { label: 'omitted pagination', args: '', size: 10 },
      { label: 'null pagination', args: '(first:null,last:null)', size: 10 },
      { label: 'first precedence', args: '(first:2,last:80)', size: 2 },
    ])('prices $label before allowing catalogue work', async ({
      definition = '',
      args,
      variables,
      size,
    }) => {
      const catalogue = new ObservedCatalogue();
      const complexity = size * 12 + (field === 'searchWallpapers' ? 1 : 2);
      const app = await build({ graphqlMaxComplexity: complexity - 1 }, { catalogue });
      const selection =
        field === 'searchWallpapers'
          ? `searchWallpapers${args}{edges{node{wallpaperId}}}`
          : `profile(id:"profile_a"){wallpapers${args}{edges{node{wallpaperId}}}}`;
      const response = await execute(app, `query${definition}{${selection}}`, variables);
      expect(response.json().errors?.[0].extensions).toMatchObject({
        code: 'COMPLEXITY_LIMIT_EXCEEDED',
        complexity,
      });
      expect(catalogue.calls).toEqual([]);
    });
  });
  it('prices only the selected named operation and its referenced fragments', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxComplexity: 500 }, { catalogue });
    const text = `
      query Small($size:Int=2){searchWallpapers(first:$size){...Page}}
      query Large($size:Int=80){profile(id:"profile_a"){...LargePage}}
      fragment Page on WallpaperConnection {edges{node{wallpaperId}}}
      fragment LargePage on Profile {wallpapers(first:$size){...Page}}
    `;
    const allowed = await execute(app, text, undefined, 'Small');
    expect(allowed.json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['search']);
    catalogue.calls.length = 0;
    const rejected = await execute(app, text, undefined, 'Large');
    expect(rejected.json().errors?.[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
    expect(catalogue.calls).toEqual([]);
  });
  it('uses the selected operation and its variable defaults for GraphQL GET', async () => {
    const catalogue = new ObservedCatalogue();
    const app = await build({ graphqlMaxComplexity: 500 }, { catalogue });
    const query =
      'query Small($size:Int=2){searchWallpapers(first:$size){edges{node{wallpaperId}}}} query Large($size:Int=80){searchWallpapers(first:$size){edges{node{wallpaperId}}}}';
    const allowed = await app.inject({
      url: `/graphql?${new URLSearchParams({ query, operationName: 'Small' })}`,
    });
    expect(allowed.json().errors).toBeUndefined();
    expect(catalogue.calls).toEqual(['search']);
    catalogue.calls.length = 0;
    const rejected = await app.inject({
      url: `/graphql?${new URLSearchParams({ query, operationName: 'Large' })}`,
    });
    expect(rejected.json().errors?.[0].extensions.code).toBe('COMPLEXITY_LIMIT_EXCEEDED');
    expect(catalogue.calls).toEqual([]);
  });
  it.each([
    undefined,
    { size: '80' },
    { size: 1.5 },
    { size: null },
  ])('preserves invalid variable errors without execution: %j', async (variables) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({}, { catalogue });
    const response = await execute(
      app,
      'query($size:Int!){searchWallpapers(first:$size){edges{node{wallpaperId}}}}',
      variables
    );
    expect(response.json().errors?.[0].message).toContain('Variable "$size"');
    expect(response.body).not.toContain('INTERNAL_SERVER_ERROR');
    expect(catalogue.calls).toEqual([]);
  });
  it.each([101, 50_000])('rejects an unsupported page size %i before execution', async (size) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({}, { catalogue });
    const response = await execute(
      app,
      'query($size:Int!){searchWallpapers(first:$size){edges{node{wallpaperId}}}}',
      { size }
    );
    expect(response.json().errors?.[0]).toMatchObject({
      message: 'Page size must be an integer between 1 and 100',
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(catalogue.calls).toEqual([]);
  });
  it.each([
    undefined,
    'Missing',
  ])('rejects ambiguous or unknown operation names without execution: %s', async (operationName) => {
    const catalogue = new ObservedCatalogue();
    const app = await build({}, { catalogue });
    const response = await execute(
      app,
      'query First{searchWallpapers{edges{node{wallpaperId}}}} query Second{profile(id:"profile_a"){id}}',
      undefined,
      operationName
    );
    expect(response.json().errors).toHaveLength(1);
    expect(response.body).not.toContain('INTERNAL_SERVER_ERROR');
    expect(catalogue.calls).toEqual([]);
  });
  it.each([
    '/graphql?operationName=test',
    '/%67raphql',
  ])('limits GraphQL URL %s and separates user agents', async (url) => {
    const app = await build({ rateLimitMaxAnonymous: 1 });
    expect((await execute(app)).statusCode).toBe(200);
    const limited = await app.inject({
      method: 'POST',
      url,
      payload: { query },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.json().errors[0].extensions.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/graphql',
          headers: { 'user-agent': 'other' },
          payload: { query },
        })
      ).statusCode
    ).toBe(200);
  });
  it.each([
    { nodeEnv: 'production' as const },
    { graphqlIntrospectionEnabled: false },
  ])('blocks introspection when configured %j', async (overrides) => {
    const app = await build(overrides);
    expect((await execute(app, '{__schema{queryType{name}}}')).json().errors).toBeDefined();
  });
  it('permits test introspection and developer GraphiQL', async () => {
    const app = await build({ nodeEnv: 'development' });
    expect(
      (await execute(app, '{__schema{queryType{name}}}')).json().data.__schema.queryType.name
    ).toBe('Query');
    expect((await app.inject({ url: '/graphiql' })).statusCode).toBe(200);
  });
  it('preserves syntax and validation error responses and masks defects', async () => {
    const app = await build();
    expect((await execute(app, '{broken')).json().errors).toBeDefined();
    expect((await execute(app, '{unknown}')).json().errors).toBeDefined();
    const defective = new EmptyCatalogue();
    defective.search = () => Effect.die(new Error('secret database password'));
    const broken = await build({}, { catalogue: defective });
    const response = await execute(broken);
    expect(response.body).not.toContain('secret');
    expect(response.json().errors[0].extensions.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.json()).toHaveProperty('data');
  });
  it('formats malformed GraphQL JSON without leaking parser details', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toBeDefined();
  });
  it('applies admission to GraphQL GET requests', async () => {
    const app = await build({ rateLimitMaxAnonymous: 1 });
    const url = `/graphql?query=${encodeURIComponent('{getWallpaper(wallpaperId:"wlpr_a"){wallpaperId}}')}`;
    expect((await app.inject({ url })).statusCode).toBe(200);
    expect((await app.inject({ url })).statusCode).toBe(429);
  });
  it('permits local development CORS and rejects lookalike hosts and production origins', async () => {
    const app = await build({ nodeEnv: 'development' });
    const allowed = await app.inject({
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const disallowed = await app.inject({
      url: '/health',
      headers: { origin: 'https://localhost:3000.attacker.example' },
    });
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
    const production = await build({ nodeEnv: 'production' });
    expect(
      (await production.inject({ url: '/health', headers: { origin: 'http://localhost:3000' } }))
        .headers['access-control-allow-origin']
    ).toBeUndefined();
  });
  it('preserves admission and complexity decisions when recording security metrics fails', async () => {
    metrics.setGlobalMeterProvider({
      getMeter() {
        throw new Error('metrics unavailable');
      },
    });
    try {
      const app = await build({ rateLimitMaxAnonymous: 2, graphqlMaxComplexity: 20 });
      expect(
        (await execute(app, '{getWallpaper(wallpaperId:"wlpr_a"){wallpaperId}}')).json().errors
      ).toBeUndefined();
      expect((await execute(app)).json().errors[0].extensions.code).toBe(
        'COMPLEXITY_LIMIT_EXCEEDED'
      );
      expect((await execute(app)).statusCode).toBe(429);
      const batch = await app.inject({
        method: 'POST',
        url: '/graphql',
        payload: Array(11).fill({ query }),
      });
      expect(batch.json().errors[0].extensions.code).toBe('BATCH_LIMIT_EXCEEDED');
    } finally {
      metrics.disable();
    }
  });
  it.each([
    { fault: new Error('private backend failure'), status: 500 },
    { fault: 'private string failure', status: 500 },
    { fault: Object.assign(new Error('private status'), { statusCode: 400 }), status: 400 },
    { fault: Object.assign(new Error('private status'), { statusCode: 499 }), status: 499 },
    { fault: Object.assign(new Error('private status'), { statusCode: 399 }), status: 500 },
    { fault: Object.assign(new Error('private status'), { statusCode: 600 }), status: 500 },
    { fault: Object.assign(new Error('private status'), { statusCode: '400' }), status: 500 },
  ])('maps HTTP exceptions safely to Problem Details ($status)', async ({ fault, status }) => {
    const app = await build();
    app.get('/fault', async () => {
      throw fault;
    });
    const response = await app.inject({ url: '/fault' });
    expect(response.statusCode).toBe(status);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      status,
      title: status === 500 ? 'Internal server error' : 'Invalid request',
      type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${status === 500 ? 'generic-server' : 'invalid-request'}.md`,
    });
    expect(response.body).not.toContain('private');
  });
  it.each([
    { fault: new Error('private admission failure'), status: 500 },
    {
      fault: Object.assign(new Error('private admission status'), { statusCode: 400 }),
      status: 400,
    },
    {
      fault: Object.assign(new Error('private admission status'), { statusCode: 499 }),
      status: 499,
    },
    {
      fault: Object.assign(new Error('private admission status'), { statusCode: 399 }),
      status: 500,
    },
    {
      fault: Object.assign(new Error('private admission status'), { statusCode: 600 }),
      status: 500,
    },
    {
      fault: Object.assign(new Error('private admission status'), { statusCode: '400' }),
      status: 500,
    },
  ])('maps pre-execution GraphQL transport defects to a safe GraphQL response ($status)', async ({
    fault,
    status,
  }) => {
    const app = await build(
      {},
      {
        admission: {
          admit() {
            throw fault;
          },
        },
      }
    );
    const response = await execute(app);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      data: null,
      errors: [
        {
          message: status === 500 ? 'Internal server error' : 'Invalid request',
          extensions: { code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST' },
        },
      ],
    });
  });
});
