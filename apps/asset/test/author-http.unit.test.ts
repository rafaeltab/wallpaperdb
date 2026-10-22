import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { createHttpApp } from '../src/http/index.js';
import {
  AuthorAuthentication,
  AuthorAuthenticationFailure,
} from '../src/adapters/authors/index.js';
import { Lifecycle, LifecycleFailure } from '../src/capabilities/lifecycle/index.js';
import { AssetDelivery } from '../src/capabilities/delivery/index.js';
import { Availability } from '../src/capabilities/availability/index.js';

it('authenticates Owner inspection and translates unavailable Assets without revealing ownership', async () => {
  const owners: unknown[] = [];
  const authorServices = Layer.merge(
    Layer.succeed(AuthorAuthentication, {
      verify: (header) =>
        Effect.succeed(
          header === 'Bearer verified-token' ? { namespace: 'clerk', subject: 'owner-1' } : null
        ),
    }),
    Layer.succeed(Lifecycle, {
      command: () => Effect.die('No HTTP creation route'),
      inspect: (owner, assetId) =>
        Effect.sync(() => {
          owners.push(owner);
          return assetId === 'asset_one'
            ? {
                kind: 'found' as const,
                asset: {
                  assetId,
                  assetType: 'picture',
                  sources: [],
                  defaultSourceId: null,
                  sourceSetRevision: '0' as const,
                },
              }
            : { kind: 'unavailable' as const };
        }),
    })
  );
  const services = Layer.merge(
    Layer.succeed(AssetDelivery, {
      wallpaper: () => Effect.succeed({ _tag: 'NotFound' }),
      picture: () => Effect.succeed({ _tag: 'NotFound' }),
    }),
    Layer.succeed(Availability, {
      health: () => Effect.die('unused'),
      ready: () => Effect.die('unused'),
    })
  );
  const app = await createHttpApp({ nodeEnv: 'test', port: 3003 }, services, { authorServices });
  try {
    expect((await app.inject('/assets/asset_one/sources')).statusCode).toBe(401);
    expect(owners).toEqual([]);
    const response = await app.inject({
      url: '/assets/asset_one/sources?ownerSubject=attacker',
      headers: { authorization: 'Bearer verified-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      assetId: 'asset_one',
      assetType: 'picture',
      sources: [],
      defaultSourceId: null,
      sourceSetRevision: '0',
    });
    expect(owners).toEqual([{ namespace: 'clerk', subject: 'owner-1' }]);
    const absent = await app.inject({
      url: '/assets/other/sources',
      headers: { authorization: 'Bearer verified-token' },
    });
    expect(absent.statusCode).toBe(404);
    expect(absent.headers['content-type']).toContain('application/problem+json');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/assets',
          headers: { authorization: 'Bearer verified-token' },
          payload: {},
        })
      ).statusCode
    ).toBe(404);
  } finally {
    await app.close();
  }
});

it.each([
  'authentication',
  'persistence',
] as const)('translates typed %s failure into safe503 Problem Details', async (failure) => {
  const cause = new Error('private provider endpoint and database credentials');
  const services = Layer.merge(
    Layer.succeed(AssetDelivery, {
      wallpaper: () => Effect.die('unused'),
      picture: () => Effect.die('unused'),
    }),
    Layer.succeed(Availability, {
      health: () => Effect.die('unused'),
      ready: () => Effect.die('unused'),
    })
  );
  const authorServices = Layer.merge(
    Layer.succeed(AuthorAuthentication, {
      verify: () =>
        failure === 'authentication'
          ? Effect.fail(new AuthorAuthenticationFailure({ cause }))
          : Effect.succeed({ namespace: 'clerk', subject: 'owner' }),
    }),
    Layer.succeed(Lifecycle, {
      command: () => Effect.die('unused'),
      inspect: () => Effect.fail(new LifecycleFailure({ operation: 'find', cause })),
    })
  );
  const app = await createHttpApp({ nodeEnv: 'test', port: 0 }, services, { authorServices });
  try {
    const response = await app.inject({
      url: '/assets/asset_one/sources',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
      title: 'Service unavailable',
      status: 503,
    });
    expect(response.body).not.toContain(cause.message);
  } finally {
    await app.close();
  }
});
