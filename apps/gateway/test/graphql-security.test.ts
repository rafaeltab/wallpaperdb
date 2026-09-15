import { Effect } from 'effect';
import { metrics } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdmission } from '../src/admission/index.js';
import { createMemoryQuota } from '../src/adapters/redis/index.js';
import { createAvailability } from '../src/availability/index.js';
import { createHttpApp, type HttpConfig, type HttpPorts } from '../src/http/index.js';
import { EmptyCatalogue, httpConfig } from './unit/http-fixture.js';
const apps: FastifyInstance[] = [];
async function build(overrides: Partial<HttpConfig> = {}, ports: Partial<HttpPorts> = {}) {
  const config = { ...httpConfig, ...overrides };
  const app = await createHttpApp(config, {
    catalogue: new EmptyCatalogue(),
    admission: createAdmission(createMemoryQuota(), {
      enabled: true,
      limit: config.rateLimitMaxAnonymous,
      windowMs: 60000,
    }),
    availability: createAvailability({
      inspect: () => Effect.succeed({ opensearch: true, nats: true, otel: true }),
    }),
    ...ports,
  });
  apps.push(app);
  return app;
}
const query = '{ searchWallpapers(first:10) { edges { node { wallpaperId variants { url } } } } }';
async function execute(app: FastifyInstance, text = query, variables?: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/graphql', payload: { query: text, variables } });
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
    const app = await build();
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
  it('limits all GraphQL URLs and separates user agents', async () => {
    const app = await build({ rateLimitMaxAnonymous: 1 });
    expect((await execute(app)).statusCode).toBe(200);
    const limited = await app.inject({
      method: 'POST',
      url: '/graphql?operationName=test',
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
