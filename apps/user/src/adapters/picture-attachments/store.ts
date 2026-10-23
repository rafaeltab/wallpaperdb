import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import {
  AttachmentStore,
  AttachmentDelivery,
  AttachmentFailure,
  type PictureAttachment,
  type AttachmentStore as Store,
  type AttachmentSnapshot,
  type AttachmentTransition,
} from '../../capabilities/picture-attachments/index.js';
import {
  profiles,
  profilePictureImports,
  pictureAttachmentIntents,
  pictureAttachmentSlots,
  attachmentSourceIntents,
} from '../../db/schema.js';
import { Database, databaseDiagnostic } from '../database/index.js';
import { appendProfileEvent } from '../profiles/index.js';
import { persistAttachment } from './transaction.js';
import { makeDelivery } from './delivery.js';
import type { AttachmentQuery } from './types.js';
class AttachmentDecisionDefect {
  constructor(readonly cause: unknown) {}
}
class AttachmentInvariant extends Error {}
function decideAttachment<A>(
  decide: (snapshot: AttachmentSnapshot) => AttachmentTransition<A>,
  snapshot: AttachmentSnapshot
): AttachmentTransition<A> {
  try {
    return decide(snapshot);
  } catch (cause) {
    throw new AttachmentDecisionDefect(cause);
  }
}
export function attachmentPostgresLayer(options: {
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly leaseMs: number;
}) {
  return Layer.effectContext(
    Effect.gen(function* () {
      const database = yield* Database;
      const query: AttachmentQuery = (operation, run) =>
        Effect.tryPromise({
          try: (signal) => database.run(run, signal),
          catch: (cause) =>
            new AttachmentFailure({
              operation,
              cause:
                cause instanceof AttachmentDecisionDefect || cause instanceof AttachmentInvariant
                  ? cause
                  : databaseDiagnostic(cause),
            }),
        }).pipe(
          Effect.catchTag('AttachmentFailure', (failure) =>
            failure.cause instanceof AttachmentDecisionDefect
              ? Effect.die(failure.cause.cause)
              : failure.cause instanceof AttachmentInvariant
                ? Effect.die(failure.cause)
                : Effect.fail(failure)
          ),
          Effect.tapError((error) =>
            Effect.logError('Picture attachment persistence unavailable', {
              operation,
              cause: error.cause,
            })
          ),
          Effect.withSpan(`pictures.attachment.store.${operation}`)
        );
      const store: Store = {
        change: (selector, decide) =>
          query('transition', (db) =>
            db.transaction(async (tx) => {
              const selected =
                selector.kind === 'begin'
                  ? null
                  : (
                      await tx
                        .select()
                        .from(pictureAttachmentIntents)
                        .where(
                          selector.kind === 'intent'
                            ? eq(pictureAttachmentIntents.id, selector.id)
                            : eq(pictureAttachmentIntents.assetId, selector.id)
                        )
                    )[0];
              const profileId =
                selector.kind === 'begin' ? selector.profileId : selected?.profileId;
              if (!profileId)
                return decideAttachment(decide, {
                  intent: null,
                  previous: null,
                  profile: null,
                  existing: false,
                  registered: false,
                }).result;
              const [profile] = await tx
                .select()
                .from(profiles)
                .where(eq(profiles.id, profileId))
                .for('update');
              if (!profile)
                return decideAttachment(decide, {
                  intent: null,
                  previous: null,
                  profile: null,
                  existing: false,
                  registered: false,
                }).result;
              const [slot] = await tx
                .select()
                .from(pictureAttachmentSlots)
                .where(eq(pictureAttachmentSlots.profileId, profileId));
              const [record] = await tx
                .select()
                .from(pictureAttachmentIntents)
                .where(
                  selector.kind === 'begin'
                    ? and(
                        eq(pictureAttachmentIntents.profileId, profileId),
                        eq(pictureAttachmentIntents.key, selector.key)
                      )
                    : eq(pictureAttachmentIntents.id, selected?.id ?? '')
                )
                .for('update');
              const [previous] = slot
                ? await tx
                    .select()
                    .from(pictureAttachmentIntents)
                    .where(eq(pictureAttachmentIntents.id, slot.intentId))
                    .for('update')
                : [];
              const id = `pic_${randomUUID()}`;
              const draft: PictureAttachment | null =
                selector.kind === 'begin'
                  ? {
                      id,
                      profileId,
                      key: selector.key,
                      expectedVersion: selector.expectedVersion,
                      commandId: randomUUID(),
                      creationEventId: randomUUID(),
                      deleteCommandId: randomUUID(),
                      deletionEventId: randomUUID(),
                      createdAt: new Date().toISOString(),
                      state: 'creating-asset',
                      assetId: null,
                      sourceIntent: null,
                      sourceId: null,
                      deletion: 'none',
                      ...(selector.trace ? { trace: selector.trace } : {}),
                    }
                  : null;
              const before = record?.state ?? null;
              const source = selector.kind === 'asset' ? selector.sourceIntent : undefined;
              const registration =
                before && source
                  ? await tx
                      .select()
                      .from(attachmentSourceIntents)
                      .where(
                        and(
                          eq(attachmentSourceIntents.attachmentId, before.id),
                          eq(attachmentSourceIntents.candidateId, source.candidateId),
                          eq(attachmentSourceIntents.intentId, source.intentId)
                        )
                      )
                      .limit(1)
                  : [];
              const changed = decideAttachment(
                decide,
                structuredClone({
                  intent: before ?? draft,
                  previous: previous?.state ?? null,
                  profile: {
                    id: profile.id,
                    version: profile.version,
                    pictureAssetId: profile.pictureAssetId,
                    pictureIntentId: slot?.intentId ?? null,
                  },
                  existing: !!before,
                  registered: registration.length === 1,
                })
              );
              for (const intent of [changed.intent, changed.previous]) {
                if (intent)
                  await persistAttachment(
                    tx,
                    intent,
                    selector.kind === 'begin' && !before && intent.id === draft?.id
                  );
              }
              if (changed.registration && changed.intent)
                await tx
                  .insert(attachmentSourceIntents)
                  .values({ attachmentId: changed.intent.id, ...changed.registration })
                  .onConflictDoNothing();
              if (changed.select && changed.intent)
                await tx
                  .insert(pictureAttachmentSlots)
                  .values({ profileId, intentId: changed.intent.id })
                  .onConflictDoUpdate({
                    target: pictureAttachmentSlots.profileId,
                    set: { intentId: changed.intent.id },
                  });
              if (changed.attach) {
                const intent = changed.intent;
                if (
                  !intent ||
                  slot?.intentId !== intent.id ||
                  profile.version !== intent.expectedVersion ||
                  profile.pictureAssetId !== null ||
                  intent.assetId !== changed.attach.assetId
                )
                  throw new AttachmentInvariant(
                    'Attachment decision violated locked Profile identity'
                  );
                const now = new Date();
                const [updated] = await tx
                  .update(profiles)
                  .set({
                    pictureAssetId: changed.attach.assetId,
                    version: profile.version + 1,
                    updatedAt: now,
                  })
                  .where(eq(profiles.id, profileId))
                  .returning();
                if (!updated) throw new AttachmentInvariant('Locked Profile disappeared');
                await tx
                  .update(profilePictureImports)
                  .set({ status: 'complete', sourceUrl: null, leaseToken: null, leaseUntil: null })
                  .where(eq(profilePictureImports.profileId, profileId));
                await appendProfileEvent(
                  tx,
                  updated,
                  {
                    type: 'picture-changed',
                    before: null,
                    after: changed.attach.assetId,
                    source: 'upload',
                    asset: null,
                  },
                  now,
                  {
                    traceParent: changed.attach.trace?.traceparent ?? null,
                    traceState: changed.attach.trace?.tracestate ?? null,
                  }
                );
              }
              return changed.result;
            })
          ),
      };
      return Context.make(AttachmentStore, store).pipe(
        Context.add(AttachmentDelivery, makeDelivery(query, options))
      );
    })
  );
}
