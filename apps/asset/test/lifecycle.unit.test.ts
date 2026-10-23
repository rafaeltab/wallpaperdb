import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Lifecycle,
  LifecycleStore,
  lifecycleLayer,
  type LifecycleStorePort,
} from '../src/capabilities/lifecycle/index.js';

it('creates a stable empty Asset whose inspection requires both Owner parts', async () => {
  let stored: {
    id: string;
    applicationId: string;
    assetType: string;
    owner: { namespace: string; subject: string };
  } | null = null;
  const port: LifecycleStorePort = {
    accept: (input) =>
      Effect.sync(() => {
        if (input.decision.kind !== 'create')
          return {
            ...input.correlation,
            outcome: 'rejected',
            assetId: null,
            reason: input.decision.kind === 'reject' ? input.decision.reason : 'unavailable-asset',
          };
        stored = {
          id: 'asset_assigned',
          applicationId: input.applicationId,
          assetType: input.decision.assetType,
          owner: input.decision.owner,
        };
        return { ...input.correlation, outcome: 'created', assetId: stored.id };
      }),
    find: () => Effect.succeed(stored),
  };
  const runtime = ManagedRuntime.make(
    lifecycleLayer({
      assetTypes: {},
      revision: 'policy-1',
      applications: {
        user: { ownerNamespace: 'clerk', allowedOperations: ['create'], allowedTypes: ['picture'] },
      },
    }).pipe(Layer.provide(Layer.succeed(LifecycleStore, port)))
  );
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Lifecycle;
        const send = (
          app: string,
          command: import('../src/capabilities/lifecycle/index.js').Command
        ) =>
          service.command(app, command, {
            occurrence: { source: 'https://test/app', id: 'occurrence-1' },
          });
        const command = {
          operation: 'create' as const,
          commandId: 'create-1',
          applicationReference: 'profile-1',
          assetType: 'picture',
          ownerSubject: 'owner-1',
        };
        expect(yield* send('user', command)).toEqual({
          commandId: 'create-1',
          applicationReference: 'profile-1',
          outcome: 'created',
          assetId: 'asset_assigned',
        });
        expect(
          yield* service.inspect({ namespace: 'clerk', subject: 'owner-1' }, 'asset_assigned')
        ).toEqual({
          kind: 'found',
          asset: {
            assetId: 'asset_assigned',
            assetType: 'picture',
            sources: [],
            defaultSourceId: null,
            sourceSetRevision: '0',
          },
        });
        expect(
          yield* service.inspect({ namespace: 'clerk', subject: 'other' }, 'asset_assigned')
        ).toEqual({ kind: 'unavailable' });
        expect(
          yield* service.inspect({ namespace: 'other', subject: 'owner-1' }, 'asset_assigned')
        ).toEqual({ kind: 'unavailable' });
        expect(
          yield* send('user', {
            ...command,
            commandId: 'create-2',
            assetType: 'wallpaper',
          })
        ).toMatchObject({ outcome: 'rejected', reason: 'unsupported-type' });
        expect(yield* send('constructor', command)).toMatchObject({
          outcome: 'rejected',
          reason: 'forbidden-operation',
        });
        expect(
          yield* send('user', {
            operation: 'delete',
            commandId: 'delete-1',
            applicationReference: 'profile-1',
            assetId: 'asset_assigned',
          })
        ).toMatchObject({ outcome: 'rejected', reason: 'forbidden-operation' });
      })
    );
  } finally {
    await runtime.dispose();
  }
});
