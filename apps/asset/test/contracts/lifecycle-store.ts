import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type { Acceptance, LifecycleStorePort } from '../../src/capabilities/lifecycle/index.js';
export const contractAcceptance: Acceptance = {
  context: { occurrence: { source: 'https://test/contracts', id: 'create' } },
  revision: 'revision-1',
  applicationId: 'user',
  canonical: 'create-contract',
  correlation: { commandId: 'contract-create', applicationReference: 'profile' },
  decision: {
    kind: 'create',
    assetType: 'picture',
    owner: { namespace: 'clerk', subject: 'owner' },
  },
};
export function lifecycleStoreContract(
  open: () => Promise<{
    port: LifecycleStorePort;
    activate: (revision: string) => Promise<unknown>;
    close: () => Promise<unknown>;
  }>
) {
  it('keys lookup, preserves command replay/conflict, never reuses terminal identity and fences stale writes', async () => {
    const f = await open();
    const accept = (input: Acceptance) => Effect.runPromise(f.port.accept(input));
    try {
      const created = await accept(contractAcceptance);
      if (created.outcome !== 'created') throw new Error('Expected creation');
      expect(await Effect.runPromise(f.port.find('asset_unknown'))).toBeNull();
      expect(await Effect.runPromise(f.port.find(created.assetId))).toEqual({
        id: created.assetId,
        applicationId: 'user',
        assetType: 'picture',
        owner: { namespace: 'clerk', subject: 'owner' },
      });
      expect(await accept(contractAcceptance)).toEqual(created);
      expect(await accept({ ...contractAcceptance, canonical: 'different' })).toMatchObject({
        outcome: 'rejected',
        reason: 'idempotency-conflict',
      });
      const deletion: Acceptance = {
        ...contractAcceptance,
        canonical: 'delete-contract',
        correlation: { commandId: 'contract-delete', applicationReference: 'profile' },
        decision: {
          kind: 'delete',
          assetId: created.assetId,
          evidenceRetentionMsByType: { picture: 1000 },
        },
      };
      expect(await accept(deletion)).toMatchObject({
        outcome: 'deleted',
        assetId: created.assetId,
      });
      expect(await Effect.runPromise(f.port.find(created.assetId))).toBeNull();
      expect(await accept(contractAcceptance)).toEqual(created);
      const fresh = await accept({
        ...contractAcceptance,
        canonical: 'fresh',
        correlation: { ...contractAcceptance.correlation, commandId: 'fresh' },
      });
      expect(fresh.outcome).toBe('created');
      expect(fresh.assetId).not.toBe(created.assetId);
      await f.activate('revision-2');
      await expect(accept(contractAcceptance)).rejects.toThrow();
      expect(await accept({ ...contractAcceptance, revision: 'revision-2' })).toEqual(created);
      expect(await Effect.runPromise(f.port.find(created.assetId))).toBeNull();
    } finally {
      await f.close();
    }
  });
}
