import { randomUUID, createHash } from 'node:crypto';
import { and, eq, lte, or, isNull } from 'drizzle-orm';
import type {
  AttachmentDelivery,
  AttachmentPublication,
} from '../../capabilities/picture-attachments/index.js';
import {
  profiles,
  pictureAttachmentIntents,
  attachmentOutbox,
  attachmentQuarantine,
} from '../../db/schema.js';
import type { AttachmentDatabase, AttachmentQuery } from './types.js';
import { confirmationTarget, reconcileAttention, type ConfirmationTarget } from './attention.js';
type AttachmentTransaction = Parameters<Parameters<AttachmentDatabase['transaction']>[0]>[0];
/** Delivery writers use the same Profile -> intent -> outbox order as attachment transitions. */
async function lockIntent(
  tx: AttachmentTransaction,
  target: ConfirmationTarget,
  skipLocked = false
) {
  const [selected] = await tx
    .select({ id: pictureAttachmentIntents.id, profileId: pictureAttachmentIntents.profileId })
    .from(pictureAttachmentIntents)
    .where(
      target.kind === 'intent'
        ? eq(pictureAttachmentIntents.id, target.id)
        : eq(pictureAttachmentIntents.assetId, target.id)
    );
  if (!selected) return undefined;
  const [profile] = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, selected.profileId))
    .for('update', skipLocked ? { skipLocked: true } : {});
  if (!profile) return undefined;
  const [intent] = await tx
    .select()
    .from(pictureAttachmentIntents)
    .where(eq(pictureAttachmentIntents.id, selected.id))
    .for('update');
  return intent;
}
export function makeDelivery(
  query: AttachmentQuery,
  options: { readonly maxAttempts: number; readonly retryDelayMs: number; readonly leaseMs: number }
): AttachmentDelivery {
  const delivery: AttachmentDelivery = {
    alerts: () =>
      query('alerts', async (db) => {
        const outbox = await db
          .select({ id: attachmentOutbox.id, quarantineId: attachmentOutbox.quarantineId })
          .from(attachmentOutbox)
          .where(
            and(eq(attachmentOutbox.status, 'quarantined'), isNull(attachmentOutbox.notifiedAt))
          )
          .limit(10);
        const inbox = await db
          .select({ id: attachmentQuarantine.id, reason: attachmentQuarantine.reason })
          .from(attachmentQuarantine)
          .where(
            and(isNull(attachmentQuarantine.notifiedAt), isNull(attachmentQuarantine.recoveredAt))
          )
          .limit(10);
        return [
          ...outbox.map((row) => ({
            id: row.id,
            quarantineId: row.quarantineId,
            scope: 'outbox' as const,
            reason: 'exhausted' as const,
          })),
          ...inbox.map((row) => ({
            id: row.id,
            quarantineId: row.id,
            scope: 'confirmation' as const,
            reason: ['invalid-confirmation', 'rejected-confirmation'].includes(row.reason)
              ? ('invalid' as const)
              : ('exhausted' as const),
          })),
        ];
      }),
    alerted: (id, scope, quarantineId) =>
      query('alerted', async (db) => {
        if (scope === 'outbox')
          await db
            .update(attachmentOutbox)
            .set({ notifiedAt: new Date() })
            .where(
              and(
                eq(attachmentOutbox.id, id),
                eq(attachmentOutbox.quarantineId, quarantineId),
                eq(attachmentOutbox.status, 'quarantined'),
                isNull(attachmentOutbox.notifiedAt)
              )
            );
        else
          await db
            .update(attachmentQuarantine)
            .set({ notifiedAt: new Date() })
            .where(
              and(
                eq(attachmentQuarantine.id, id),
                eq(attachmentQuarantine.id, quarantineId),
                isNull(attachmentQuarantine.recoveredAt),
                isNull(attachmentQuarantine.notifiedAt)
              )
            );
      }),
    retainedConfirmation: (id) =>
      query('retained-confirmation', async (db) => {
        const rows = await db
          .select({ payload: attachmentQuarantine.payload })
          .from(attachmentQuarantine)
          .where(and(eq(attachmentQuarantine.id, id), isNull(attachmentQuarantine.recoveredAt)));
        return rows[0]?.payload ?? null;
      }),
    confirmationRecovered: (id) =>
      query('confirmation-recovered', (db) =>
        db.transaction(async (tx) => {
          const [confirmation] = await tx
            .select()
            .from(attachmentQuarantine)
            .where(eq(attachmentQuarantine.id, id));
          if (!confirmation) return;
          const target = confirmationTarget(confirmation.payload);
          const record = target ? await lockIntent(tx, target) : undefined;
          const recovered = await tx
            .update(attachmentQuarantine)
            .set({ recoveredAt: new Date() })
            .where(and(eq(attachmentQuarantine.id, id), isNull(attachmentQuarantine.recoveredAt)))
            .returning({ id: attachmentQuarantine.id });
          if (!record || recovered.length === 0) return;
          await reconcileAttention(tx, record.state);
        })
      ),

    claim: () =>
      query('claim', (db) =>
        db.transaction(async (tx) => {
          const now = new Date();
          const eligible = and(
            or(eq(attachmentOutbox.status, 'pending'), eq(attachmentOutbox.status, 'leased')),
            lte(attachmentOutbox.availableAt, now)
          );
          const candidates = await tx
            .select({ id: attachmentOutbox.id, attachmentId: attachmentOutbox.attachmentId })
            .from(attachmentOutbox)
            .where(eligible)
            .limit(10);
          const publications: AttachmentPublication[] = [];
          for (const candidate of candidates) {
            const intent = await lockIntent(
              tx,
              { kind: 'intent', id: candidate.attachmentId },
              true
            );
            if (!intent) continue;
            const [row] = await tx
              .select()
              .from(attachmentOutbox)
              .where(and(eq(attachmentOutbox.id, candidate.id), eligible))
              .for('update', { skipLocked: true });
            if (!row) continue;
            if (row.attempts >= options.maxAttempts) {
              await tx
                .update(attachmentOutbox)
                .set({ status: 'quarantined', leaseId: null })
                .where(eq(attachmentOutbox.id, row.id));
              await reconcileAttention(tx, intent.state);
              continue;
            }
            const leaseId = randomUUID();
            await tx
              .update(attachmentOutbox)
              .set({
                status: 'leased',
                attempts: row.attempts + 1,
                leaseId,
                availableAt: new Date(Date.now() + options.leaseMs),
              })
              .where(eq(attachmentOutbox.id, row.id));
            publications.push({
              id: row.id,
              attachmentId: row.attachmentId,
              destination: row.destination,
              event: row.event,
              leaseId,
              attempts: row.attempts,
            });
          }
          return publications;
        })
      ),
    complete: (p) =>
      query('complete', (db) =>
        db.transaction(async (tx) => {
          const [publication] = await tx
            .select({ attachmentId: attachmentOutbox.attachmentId })
            .from(attachmentOutbox)
            .where(and(eq(attachmentOutbox.id, p.id), eq(attachmentOutbox.leaseId, p.leaseId)));
          if (!publication) return;
          const intent = await lockIntent(tx, { kind: 'intent', id: publication.attachmentId });
          if (!intent) return;
          const completed = await tx
            .update(attachmentOutbox)
            .set({ status: 'published', leaseId: null })
            .where(and(eq(attachmentOutbox.id, p.id), eq(attachmentOutbox.leaseId, p.leaseId)))
            .returning({ id: attachmentOutbox.id });
          if (completed.length) await reconcileAttention(tx, intent.state);
        })
      ),
    failed: (p) =>
      query('failed', (db) =>
        db.transaction(async (tx) => {
          const [publication] = await tx
            .select({ attachmentId: attachmentOutbox.attachmentId })
            .from(attachmentOutbox)
            .where(and(eq(attachmentOutbox.id, p.id), eq(attachmentOutbox.leaseId, p.leaseId)));
          if (!publication) return;
          const intent = await lockIntent(tx, { kind: 'intent', id: publication.attachmentId });
          if (!intent) return;
          const exhausted = p.attempts + 1 >= options.maxAttempts;
          const changed = await tx
            .update(attachmentOutbox)
            .set({
              status: exhausted ? 'quarantined' : 'pending',
              attempts: p.attempts + 1,
              leaseId: null,
              availableAt: new Date(Date.now() + options.retryDelayMs),
            })
            .where(and(eq(attachmentOutbox.id, p.id), eq(attachmentOutbox.leaseId, p.leaseId)))
            .returning({ id: attachmentOutbox.id });
          if (exhausted && changed.length) await reconcileAttention(tx, intent.state);
        })
      ),
    quarantine: (id, payload, reason, target) =>
      query('quarantine', (db) =>
        db.transaction(async (tx) => {
          const record = target ? await lockIntent(tx, target) : undefined;
          await tx
            .insert(attachmentQuarantine)
            .values({
              id: createHash('sha256').update(id).digest('hex'),
              payload: payload.slice(0, 16384),
              reason,
            })
            .onConflictDoNothing();
          if (record) {
            const [confirmation] = await tx
              .select({ recoveredAt: attachmentQuarantine.recoveredAt })
              .from(attachmentQuarantine)
              .where(eq(attachmentQuarantine.id, createHash('sha256').update(id).digest('hex')));
            if (confirmation?.recoveredAt === null)
              await tx
                .update(pictureAttachmentIntents)
                .set({ state: { ...record.state, attentionRequired: true } })
                .where(eq(pictureAttachmentIntents.id, record.id));
          }
        })
      ),
    recover: (id) =>
      query('recover', (db) =>
        db.transaction(async (tx) => {
          const [publication] = await tx
            .select({ attachmentId: attachmentOutbox.attachmentId })
            .from(attachmentOutbox)
            .where(and(eq(attachmentOutbox.id, id), eq(attachmentOutbox.status, 'quarantined')));
          if (!publication) return false;
          const intent = await lockIntent(tx, { kind: 'intent', id: publication.attachmentId });
          if (!intent) return false;
          const rows = await tx
            .update(attachmentOutbox)
            .set({
              status: 'pending',
              attempts: 0,
              availableAt: new Date(),
              leaseId: null,
              notifiedAt: null,
              quarantineId: randomUUID(),
            })
            .where(and(eq(attachmentOutbox.id, id), eq(attachmentOutbox.status, 'quarantined')))
            .returning({ id: attachmentOutbox.id });
          if (!rows.length) return false;
          intent.state.attentionPublications = [
            ...new Set([...(intent.state.attentionPublications ?? []), id]),
          ];
          await reconcileAttention(tx, intent.state);
          return true;
        })
      ),
  };

  return delivery;
}
