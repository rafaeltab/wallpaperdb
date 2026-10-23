import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  AttachmentStore,
  PictureAttachments,
  pictureAttachmentsLayer,
  type PictureAttachment,
  type AttachmentProfile,
  type AttachmentStore as Store,
} from '../src/capabilities/picture-attachments/index.js';
function controlled() {
  let sequence = 0;
  let profile: AttachmentProfile = {
    id: 'owner',
    version: 4,
    pictureAssetId: null,
    pictureIntentId: null,
  };
  const intents = new Map<string, PictureAttachment>();
  const registrations = new Set<string>();
  const obligations = new Map<string, { operation: string; assetId: string | null }>();
  const attachments: unknown[] = [];
  const store: Store = {
    change: (selector, decide) =>
      Effect.sync(() => {
        const existing =
          selector.kind === 'begin'
            ? [...intents.values()].find(
                (i) =>
                  i.profileId === selector.profileId &&
                  i.key === selector.key &&
                  i.expectedVersion === selector.expectedVersion
              )
            : selector.kind === 'intent'
              ? intents.get(selector.id)
              : [...intents.values()].find((i) => i.assetId === selector.id);
        const id = `intent-${++sequence}`;
        const draft: PictureAttachment | undefined =
          selector.kind === 'begin'
            ? {
                id,
                profileId: selector.profileId,
                key: selector.key,
                expectedVersion: selector.expectedVersion,
                commandId: `create-${id}`,
                creationEventId: `created-${id}`,
                deleteCommandId: `delete-${id}`,
                deletionEventId: `deleted-${id}`,
                createdAt: '2026-10-23T00:00:00Z',
                state: 'creating-asset',
                assetId: null,
                sourceIntent: null,
                sourceId: null,
                deletion: 'none',
              }
            : undefined;
        const intent = existing ?? draft ?? null;
        const previous = profile.pictureIntentId
          ? (intents.get(profile.pictureIntentId) ?? null)
          : null;
        const changed = decide(
          structuredClone({
            intent,
            previous,
            profile: intent?.profileId === profile.id ? profile : null,
            existing: !!existing,
            registered:
              !!intent &&
              selector.kind === 'asset' &&
              !!selector.sourceIntent &&
              registrations.has(
                JSON.stringify([
                  intent.id,
                  selector.sourceIntent.candidateId,
                  selector.sourceIntent.intentId,
                ])
              ),
          })
        );
        if (changed.registration && changed.intent)
          registrations.add(
            JSON.stringify([
              changed.intent.id,
              changed.registration.candidateId,
              changed.registration.intentId,
            ])
          );
        for (const next of [changed.intent, changed.previous])
          if (next) {
            intents.set(next.id, structuredClone(next));
            if (next.state === 'creating-asset')
              obligations.set(next.creationEventId, { operation: 'create', assetId: null });
            if (next.deletion === 'pending')
              obligations.set(next.deletionEventId, { operation: 'delete', assetId: next.assetId });
          }
        if (changed.select && changed.intent)
          profile = { ...profile, pictureIntentId: changed.intent.id };
        if (changed.attach) {
          profile = {
            ...profile,
            version: profile.version + 1,
            pictureAssetId: changed.attach.assetId,
          };
          attachments.push(changed.attach);
        }
        return structuredClone(changed.result);
      }),
  };
  const run = <A, E>(use: (s: PictureAttachments) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      PictureAttachments.use(use).pipe(
        Effect.provide(
          pictureAttachmentsLayer.pipe(Layer.provide(Layer.succeed(AttachmentStore, store)))
        )
      )
    );
  const begin = async (key = 'first', version = 4) => {
    const r = await run((s) => s.begin({ profileId: 'owner' }, key, version));
    if (r.kind !== 'attachment') throw new Error(r.kind);
    return r.attachment;
  };
  const created = (i: PictureAttachment, assetId = 'asset-A') =>
    run((s) =>
      s.assetResult({
        attachmentId: i.id,
        commandId: i.commandId,
        causationId: i.creationEventId,
        outcome: 'created',
        assetId,
      })
    );
  const source = (assetId = 'asset-A', candidateId = 'candidate-A', intentId = 'edit-A') =>
    run((s) =>
      s.sourceAccepted({
        assetId,
        candidateId,
        intentId,
        sourceId: 'source-A',
        defaultSourceId: 'source-A',
        initialAnalysisSourceId: 'source-A',
        occurrenceId: 'acceptance-A',
      })
    );
  return {
    run,
    begin,
    created,
    source,
    obligations,
    attachments,
    intents,
    profile: () => profile,
    editProfile: () => {
      profile = { ...profile, version: profile.version + 1 };
    },
  };
}
describe('Initial picture attachment', () => {
  it('requires the registered Source confirmation and commits User attachment separately from Asset acceptance', async () => {
    const c = controlled();
    const i = await c.begin();
    expect(c.obligations.size).toBe(1);
    await c.created(i);
    expect(c.profile().pictureAssetId).toBeNull();
    expect(c.attachments).toEqual([]);
    expect(await c.source()).toBe('ignored');
    await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, i.id, {
        candidateId: 'candidate-A',
        intentId: 'edit-A',
      })
    );
    expect(await c.source()).toBe('applied');
    expect(c.profile()).toMatchObject({ version: 5, pictureAssetId: 'asset-A' });
    expect(await c.source()).toBe('ignored');
    expect(c.attachments).toHaveLength(1);
  });
  it('allows another candidate for the same attachment after a rejected edit while retaining registered confirmations', async () => {
    const c = controlled();
    const i = await c.begin();
    await c.created(i);
    await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, i.id, {
        candidateId: 'rejected-candidate',
        intentId: 'rejected-edit',
      })
    );
    const retry = await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, i.id, {
        candidateId: 'candidate-A',
        intentId: 'edit-A',
      })
    );
    expect(retry.kind).toBe('attachment');
    expect(await c.source()).toBe('applied');
  });
  it('fences a late accepted candidate after a different edit becomes current', async () => {
    const c = controlled();
    const i = await c.begin();
    await c.created(i);
    await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, i.id, {
        candidateId: 'candidate-A',
        intentId: 'edit-A',
      })
    );
    await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, i.id, {
        candidateId: 'candidate-B',
        intentId: 'edit-B',
      })
    );
    expect(await c.source()).toBe('ignored');
    expect(c.profile().pictureAssetId).toBeNull();
    expect(c.intents.get(i.id)?.state).toBe('conflicted');
    expect(c.obligations.get(i.deletionEventId)).toEqual({
      operation: 'delete',
      assetId: 'asset-A',
    });
  });
  it('fences cancellation before a late create and durably deletes precisely that orphan', async () => {
    const c = controlled();
    const i = await c.begin();
    await c.run((s) => s.cancel({ profileId: 'owner' }, i.id));
    expect(await c.created(i)).toBe('applied');
    expect(c.obligations.get(i.deletionEventId)).toEqual({
      operation: 'delete',
      assetId: 'asset-A',
    });
    expect(await c.created(i)).toBe('ignored');
    expect(c.obligations.size).toBe(2);
    expect(await c.source()).toBe('ignored');
    expect(c.profile().pictureAssetId).toBeNull();
    expect(
      await c.run((s) =>
        s.assetResult({
          attachmentId: i.id,
          commandId: i.deleteCommandId,
          causationId: i.deletionEventId,
          outcome: 'deleted',
          assetId: 'another-asset',
        })
      )
    ).toBe('ignored');
    expect(
      await c.run((s) =>
        s.assetResult({
          attachmentId: i.id,
          commandId: i.deleteCommandId,
          causationId: i.deletionEventId,
          outcome: 'deleted',
          assetId: 'asset-A',
        })
      )
    ).toBe('applied');
    expect(c.intents.get(i.id)?.deletion).toBe('complete');
  });
  it('retains a rejected orphan deletion for operator attention rather than silently completing it', async () => {
    const c = controlled();
    const i = await c.begin();
    await c.created(i);
    await c.run((s) => s.cancel({ profileId: 'owner' }, i.id));
    expect(
      await c.run((s) =>
        s.assetResult({
          attachmentId: i.id,
          commandId: i.deleteCommandId,
          causationId: i.deletionEventId,
          outcome: 'rejected',
          assetId: 'asset-A',
        })
      )
    ).toBe('requires-attention');
    expect(c.intents.get(i.id)).toMatchObject({
      state: 'cancelled',
      deletion: 'pending',
      attentionRequired: true,
    });
    expect(c.profile().pictureAssetId).toBeNull();
  });
  it('abandons a superseded intent without letting its late result attach or delete the next picture', async () => {
    const c = controlled();
    const old = await c.begin('old');
    const current = await c.begin('new');
    await c.created(old, 'orphan');
    await c.created(current, 'asset-A');
    expect(c.intents.get(old.id)?.state).toBe('abandoned');
    expect(c.obligations.get(old.deletionEventId)).toEqual({
      operation: 'delete',
      assetId: 'orphan',
    });
    await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, current.id, {
        candidateId: 'candidate-A',
        intentId: 'edit-A',
      })
    );
    await c.source();
    await c.created(old, 'orphan');
    expect(c.profile().pictureAssetId).toBe('asset-A');
    expect(c.obligations.get(current.deletionEventId)).toBeUndefined();
  });
  it('detects Profile conflicts at confirmation without replacing the newer Profile', async () => {
    const c = controlled();
    const i = await c.begin();
    await c.created(i);
    await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, i.id, {
        candidateId: 'candidate-A',
        intentId: 'edit-A',
      })
    );
    c.editProfile();
    expect(await c.source()).toBe('ignored');
    expect(c.profile()).toMatchObject({ version: 5, pictureAssetId: null });
    expect(c.intents.get(i.id)?.state).toBe('conflicted');
    expect(c.obligations.get(i.deletionEventId)).toEqual({
      operation: 'delete',
      assetId: 'asset-A',
    });
  });
  it('replays the same intent and rejects different expected-version reuse or foreign access', async () => {
    const c = controlled();
    const i = await c.begin();
    expect(await c.begin()).toEqual(i);
    expect(c.obligations.size).toBe(1);
    expect(await c.run((s) => s.begin({ profileId: 'owner' }, 'first', 5))).toEqual({
      kind: 'conflict',
    });
    expect(await c.run((s) => s.begin({ profileId: 'owner' }, 'new', 3))).toEqual({
      kind: 'conflict',
    });
    expect(await c.run((s) => s.get({ profileId: 'stranger' }, i.id))).toEqual({
      kind: 'unavailable',
    });
    expect(await c.run((s) => s.cancel({ profileId: 'stranger' }, i.id))).toEqual({
      kind: 'unavailable',
    });
  });
  it('does not attach forged, mismatched or noninitial Source confirmations', async () => {
    const c = controlled();
    const i = await c.begin();
    expect(
      await c.run((s) =>
        s.assetResult({
          attachmentId: i.id,
          commandId: i.commandId,
          causationId: 'wrong-occurrence',
          outcome: 'created',
          assetId: 'asset-A',
        })
      )
    ).toBe('ignored');
    await c.created(i);
    await c.run((s) =>
      s.expectSource({ profileId: 'owner' }, i.id, {
        candidateId: 'candidate-A',
        intentId: 'edit-A',
      })
    );
    expect(await c.source('asset-A', 'wrong-candidate')).toBe('ignored');
    expect(await c.source('asset-A', 'candidate-A', 'wrong-edit')).toBe('ignored');
    expect(
      await c.run((s) =>
        s.sourceAccepted({
          assetId: 'asset-A',
          candidateId: 'candidate-A',
          intentId: 'edit-A',
          sourceId: 'source-A',
          defaultSourceId: 'source-A',
          initialAnalysisSourceId: 'another-source',
          occurrenceId: 'event',
        })
      )
    ).toBe('ignored');
    expect(c.profile().pictureAssetId).toBeNull();
  });
});
