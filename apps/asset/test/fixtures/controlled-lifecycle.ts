import { Effect } from 'effect';
import {
  LifecycleFailure,
  type LifecycleStorePort,
  type OwnedAsset,
  type CommandResult,
} from '../../src/capabilities/lifecycle/index.js';
export function controlledLifecycle() {
  let revision = 'revision-1';
  let sequence = 0;
  const assets = new Map<string, OwnedAsset>();
  const deleted = new Map<string, string>();
  const commands = new Map<string, { canonical: string; result: CommandResult }>();
  const port: LifecycleStorePort = {
    accept: (input) =>
      Effect.suspend(() => {
        if (input.revision !== revision)
          return Effect.fail(new LifecycleFailure({ operation: 'inactive-policy', cause: null }));
        return Effect.sync(() => {
          const key = JSON.stringify([input.applicationId, input.correlation.commandId]);
          const prior = commands.get(key);
          if (prior)
            return prior.canonical === input.canonical
              ? structuredClone(prior.result)
              : {
                  ...input.correlation,
                  outcome: 'rejected' as const,
                  assetId: null,
                  reason: 'idempotency-conflict' as const,
                };
          const decision = input.decision;
          let result: CommandResult;
          if (decision.kind === 'create') {
            const id = `asset_controlled_${++sequence}`;
            assets.set(
              id,
              structuredClone({
                id,
                applicationId: input.applicationId,
                assetType: decision.assetType,
                owner: decision.owner,
              })
            );
            result = { ...input.correlation, outcome: 'created', assetId: id };
          } else if (
            decision.kind === 'delete' &&
            (assets.get(decision.assetId)?.applicationId === input.applicationId ||
              deleted.get(decision.assetId) === input.applicationId)
          ) {
            const outcome = deleted.has(decision.assetId) ? 'already-deleted' : 'deleted';
            assets.delete(decision.assetId);
            deleted.set(decision.assetId, input.applicationId);
            result = { ...input.correlation, outcome, assetId: decision.assetId };
          } else
            result = {
              ...input.correlation,
              outcome: 'rejected',
              assetId: null,
              reason: decision.kind === 'reject' ? decision.reason : 'unavailable-asset',
            };
          commands.set(key, { canonical: input.canonical, result: structuredClone(result) });
          return result;
        });
      }),
    find: (id) => Effect.sync(() => structuredClone(assets.get(id) ?? null)),
  };
  return {
    port,
    activate: async (next: string) => {
      revision = next;
    },
  };
}
