import { randomUUID, createHash } from 'node:crypto';
import { and, eq, lte, or, isNull } from 'drizzle-orm';
import type {
  AttachmentDelivery,
  AttachmentPublication,
} from '../../capabilities/picture-attachments/index.js';
import {
  pictureAttachmentIntents,
  attachmentOutbox,
  attachmentQuarantine,
} from '../../db/schema.js';
import type { AttachmentQuery } from './store.js';
export function makeDelivery(
  query: AttachmentQuery,
  options: { readonly maxAttempts: number; readonly retryDelayMs: number; readonly leaseMs: number }
): AttachmentDelivery {
  const delivery: AttachmentDelivery = {
    alerts: () =>
      query('alerts', async (db) => {
        const outbox = await db
          .select({ id: attachmentOutbox.id })
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
            scope: 'outbox' as const,
            reason: 'exhausted' as const,
          })),
          ...inbox.map((row) => ({
            id: row.id,
            scope: 'confirmation' as const,
            reason:
              row.reason === 'invalid-confirmation' ? ('invalid' as const) : ('exhausted' as const),
          })),
        ];
      }),
    alerted: (id, scope) =>
      query('alerted', async (db) => {
        if (scope === 'outbox')
          await db
            .update(attachmentOutbox)
            .set({ notifiedAt: new Date() })
            .where(eq(attachmentOutbox.id, id));
        else
          await db
            .update(attachmentQuarantine)
            .set({ notifiedAt: new Date() })
            .where(eq(attachmentQuarantine.id, id));
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
      query('confirmation-recovered', async (db) => {
        await db
          .update(attachmentQuarantine)
          .set({ recoveredAt: new Date() })
          .where(eq(attachmentQuarantine.id, id));
      }),

    claim: () =>
      query('claim', (db) =>
        db.transaction(async (tx) => {
          const now = new Date();
          const rows = await tx
            .select()
            .from(attachmentOutbox)
            .where(
              and(
                or(eq(attachmentOutbox.status, 'pending'), eq(attachmentOutbox.status, 'leased')),
                lte(attachmentOutbox.availableAt, now)
              )
            )
            .limit(10)
            .for('update', { skipLocked: true });
          const publications: AttachmentPublication[] = [];
          for (const row of rows) {
            if (row.attempts >= options.maxAttempts) {
              await tx
                .update(attachmentOutbox)
                .set({ status: 'quarantined', leaseId: null })
                .where(eq(attachmentOutbox.id, row.id));
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
      query('complete', async (db) => {
        await db
          .update(attachmentOutbox)
          .set({ status: 'published', leaseId: null })
          .where(and(eq(attachmentOutbox.id, p.id), eq(attachmentOutbox.leaseId, p.leaseId)));
      }),
    failed: (p) =>
      query('failed', (db) =>
        db.transaction(async (tx) => {
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
            .returning();
          if (exhausted && changed.length) {
            const rows = await tx
              .select()
              .from(pictureAttachmentIntents)
              .where(eq(pictureAttachmentIntents.id, p.attachmentId))
              .for('update');
            const w = rows[0]?.state;
            if (w)
              await tx
                .update(pictureAttachmentIntents)
                .set({ state: { ...w, attentionRequired: true } })
                .where(eq(pictureAttachmentIntents.id, w.id));
          }
        })
      ),
    quarantine: (id, payload, reason, target) =>
      query('quarantine', (db) =>
        db.transaction(async (tx) => {
          await tx
            .insert(attachmentQuarantine)
            .values({
              id: createHash('sha256').update(id).digest('hex'),
              payload: payload.slice(0, 16384),
              reason,
            })
            .onConflictDoNothing();
          if (target) {
            const rows = await tx
              .select()
              .from(pictureAttachmentIntents)
              .where(
                target.kind === 'intent'
                  ? eq(pictureAttachmentIntents.id, target.id)
                  : eq(pictureAttachmentIntents.assetId, target.id)
              )
              .for('update');
            const w = rows[0]?.state;
            if (w)
              await tx
                .update(pictureAttachmentIntents)
                .set({ state: { ...w, attentionRequired: true } })
                .where(eq(pictureAttachmentIntents.id, w.id));
          }
        })
      ),
    recover: (id) =>
      query('recover', async (db) => {
        const rows = await db
          .update(attachmentOutbox)
          .set({
            status: 'pending',
            attempts: 0,
            availableAt: new Date(),
            leaseId: null,
            notifiedAt: null,
          })
          .where(and(eq(attachmentOutbox.id, id), eq(attachmentOutbox.status, 'quarantined')))
          .returning({ id: attachmentOutbox.id });
        return rows.length === 1;
      }),
  };

  return delivery;
}
