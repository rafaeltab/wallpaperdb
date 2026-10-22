import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { createHttpApp } from '../src/http/index.js';
import { Sources } from '../src/capabilities/sources/index.js';
import { AuthorAuthentication } from '../src/adapters/authors/index.js';
import { AssetDelivery } from '../src/capabilities/delivery/index.js';
import { Availability } from '../src/capabilities/availability/index.js';
import { initialSourcePolicies } from '../src/capabilities/sources/policy.js';
it('authenticates byte-free discovery and preserves candidate intent/revision/idempotency on author routes', async () => {
  const calls: unknown[] = [];
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3003 },
    Layer.merge(
      Layer.succeed(Availability, {
        health: () => Effect.die('unused'),
        ready: () => Effect.die('unused'),
      }),
      Layer.succeed(AssetDelivery, {
        wallpaper: () => Effect.die('unused'),
        picture: () => Effect.die('unused'),
      })
    ),
    {
      sourceServices: Layer.merge(
        Layer.succeed(AuthorAuthentication, {
          verify: (header) =>
            Effect.succeed(
              header === 'Bearer owner' ? { namespace: 'clerk', subject: 'owner' } : null
            ),
        }),
        Layer.succeed(Sources, {
          policy: () =>
            Effect.succeed({
              kind: 'policy',
              policy: initialSourcePolicies.wallpaper,
              revision: 'revision-1',
            }),
          list: () => Effect.succeed({ kind: 'unavailable' }),
          create: (owner, assetId, intent) =>
            Effect.sync(() => {
              calls.push({ owner, assetId, intent });
              return {
                kind: 'candidate',
                candidate: {
                  ...intent,
                  candidateId: 'candidate_1',
                  sourceId: 'source_1',
                  status: 'awaiting-bytes',
                  layout: 'asset-layout-1',
                  expiresAt: '2026-10-23T00:00:00Z',
                  orphanExpiresAt: '2026-10-23T00:00:00Z',
                },
              };
            }),
          status: () => Effect.succeed({ kind: 'unavailable' }),
          cancel: () => Effect.succeed({ kind: 'unavailable' }),
          upload: () => Effect.succeed({ kind: 'rejected', reason: 'byte-digest-conflict' }),
          accept: () => Effect.succeed({ kind: 'rejected', reason: 'source-set-conflict' }),
          original: () => Effect.succeed({ kind: 'unavailable' }),
        })
      ),
    }
  );
  try {
    expect((await app.inject('/asset-types/wallpaper/policy')).statusCode).toBe(401);
    const policy = await app.inject({
      url: '/asset-types/wallpaper/policy',
      headers: { authorization: 'Bearer owner' },
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ revision: 'revision-1', policy: { maxCandidates: 2 } });
    const created = await app.inject({
      method: 'POST',
      url: '/assets/asset_1/source-candidates',
      headers: { authorization: 'Bearer owner', 'idempotency-key': 'edit-1' },
      payload: { operation: 'add', expectedSourceSetRevision: '0' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.location).toBe('/assets/asset_1/source-candidates/candidate_1');
    expect(created.json()).toMatchObject({ candidateId: 'candidate_1', status: 'awaiting-bytes' });
    expect(created.body).not.toContain('asset-layout');
    expect(calls).toMatchObject([
      {
        owner: { namespace: 'clerk', subject: 'owner' },
        assetId: 'asset_1',
        intent: { operation: 'add', expectedSourceSetRevision: '0', idempotencyKey: 'edit-1' },
      },
    ]);
    const conflict = await app.inject({
      method: 'POST',
      url: '/assets/asset_1/source-candidates/candidate_1/accept',
      headers: { authorization: 'Bearer owner' },
      payload: { operation: 'add', expectedSourceSetRevision: '0' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      status: 409,
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/source-set-conflict.md',
    });
    const malformed = await app.inject({
      method: 'POST',
      url: '/assets/asset_1/source-candidates',
      headers: { authorization: 'Bearer owner' },
      payload: { owner: 'attacker', operation: 'add', expectedSourceSetRevision: 0 },
    });
    expect(malformed.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
