import { eq } from 'drizzle-orm';
import type { PictureAttachment } from '../../capabilities/picture-attachments/index.js';
import {
  attachmentOutbox,
  pictureAttachmentIntents,
  pictureAttachmentSlots,
} from '../../db/schema.js';
import { reconcileAttention } from './attention.js';
import type { Database } from '../database/index.js';
type Db = Parameters<Parameters<Database['run']>[0]>[0];
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
/** The caller owns the Profile row lock. These writes share its local transaction. */
export async function persistAttachment(
  tx: Transaction,
  intent: PictureAttachment,
  creation = false
) {
  await tx
    .insert(pictureAttachmentIntents)
    .values({
      id: intent.id,
      profileId: intent.profileId,
      key: intent.key,
      assetId: intent.assetId,
      state: intent,
    })
    .onConflictDoUpdate({
      target: pictureAttachmentIntents.id,
      set: { assetId: intent.assetId, state: intent },
    });
  const deleting = intent.deletion === 'pending' && intent.assetId !== null;
  if (creation || deleting) {
    const eventId = creation ? intent.creationEventId : intent.deletionEventId;
    await tx
      .insert(attachmentOutbox)
      .values({
        id: eventId,
        attachmentId: intent.id,
        destination: creation ? 'asset-create' : 'asset-delete',
        event: {
          specversion: '1.0',
          id: eventId,
          source: 'https://wallpaperdb/user',
          type: creation ? 'asset.command.create' : 'asset.command.delete',
          time: creation ? intent.createdAt : new Date().toISOString(),
          datacontenttype: 'application/json',
          correlationid: intent.id,
          ...intent.trace,
          data: creation
            ? {
                commandId: intent.commandId,
                applicationReference: intent.id,
                assetType: 'picture',
                ownerSubject: intent.profileId,
              }
            : {
                commandId: intent.deleteCommandId,
                applicationReference: intent.id,
                assetId: intent.assetId,
              },
        },
      })
      .onConflictDoNothing();
  }
  await reconcileAttention(tx, intent);
}
/** Profile concurrency belongs to User. A winning Profile mutation permanently
 * fences an unfinished attachment and records its orphan-delete duty immediately,
 * even if the client never polls or supplies another Source confirmation. */
export async function fencePendingAttachment(tx: Transaction, profileId: string) {
  const [slot] = await tx
    .select()
    .from(pictureAttachmentSlots)
    .where(eq(pictureAttachmentSlots.profileId, profileId));
  if (!slot) return;
  const [record] = await tx
    .select()
    .from(pictureAttachmentIntents)
    .where(eq(pictureAttachmentIntents.id, slot.intentId))
    .for('update');
  if (
    !record ||
    !['creating-asset', 'awaiting-source', 'accepting-source'].includes(record.state.state)
  )
    return;
  const intent = record.state;
  intent.state = 'conflicted';
  if (intent.assetId) intent.deletion = 'pending';
  await persistAttachment(tx, intent);
}
