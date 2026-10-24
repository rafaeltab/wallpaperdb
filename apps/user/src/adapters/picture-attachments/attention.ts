import { eq, isNull } from 'drizzle-orm';
import type {
  AttachmentDelivery,
  PictureAttachment,
} from '../../capabilities/picture-attachments/index.js';
import {
  pictureAttachmentIntents,
  attachmentOutbox,
  attachmentQuarantine,
} from '../../db/schema.js';
import type { AttachmentDatabase } from './types.js';
import { decodeConfirmation } from './translation.js';
export type ConfirmationTarget = NonNullable<Parameters<AttachmentDelivery['quarantine']>[3]>;
export function confirmationTarget(payload: string): ConfirmationTarget | undefined {
  const decoded = decodeConfirmation(new TextEncoder().encode(payload));
  if (decoded.kind === 'result') return { kind: 'intent', id: decoded.result.attachmentId };
  if (decoded.kind === 'source') return { kind: 'asset', id: decoded.confirmation.assetId };
  return undefined;
}
type AttachmentTransaction = Parameters<Parameters<AttachmentDatabase['transaction']>[0]>[0];
/** Caller holds Profile then intent locks. Reconcile durable duties in the same transaction
 * as the ordinary transition or delivery closure; the summary boolean is never its own cause. */
export async function reconcileAttention(tx: AttachmentTransaction, intent: PictureAttachment) {
  const pending = await tx
    .select({ payload: attachmentQuarantine.payload })
    .from(attachmentQuarantine)
    .where(isNull(attachmentQuarantine.recoveredAt));
  const otherConfirmation = pending.some(({ payload }) => {
    const other = confirmationTarget(payload);
    return other?.kind === 'intent'
      ? other.id === intent.id
      : other?.kind === 'asset' && other.id === intent.assetId;
  });
  const outbox = await tx
    .select({ id: attachmentOutbox.id, status: attachmentOutbox.status })
    .from(attachmentOutbox)
    .where(eq(attachmentOutbox.attachmentId, intent.id));
  const publications = outbox
    .filter(
      (row) =>
        row.status === 'quarantined' ||
        (row.status !== 'published' && intent.attentionPublications?.includes(row.id))
    )
    .map((row) => row.id);
  if (publications.length) intent.attentionPublications = publications;
  else delete intent.attentionPublications;
  intent.attentionRequired =
    otherConfirmation ||
    publications.length > 0 ||
    (intent.deletion === 'pending' && intent.deletionRejected === true);
  await tx
    .update(pictureAttachmentIntents)
    .set({ state: intent })
    .where(eq(pictureAttachmentIntents.id, intent.id));
}
