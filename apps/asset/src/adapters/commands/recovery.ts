import { randomUUID } from 'node:crypto';
import type { NatsConnection } from 'nats';
import { z } from 'zod';
import type { Authority } from '../../authority.js';
import { decodeAssetCommand } from './transport.js';
import { noticeSchema } from './notifications.js';

/** This operation requires scoped operator credentials; no HTTP route exposes it. */
export async function recoverQuarantine(
  connection: NatsConnection,
  authority: Authority,
  applicationId: string,
  sequence: number
) {
  const application = Object.hasOwn(authority.applications, applicationId)
    ? authority.applications[applicationId]
    : undefined;
  if (!application || !Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error('A configured application and quarantine sequence are required');
  const manager = await connection.jetstreamManager();
  const record = await manager.streams.getMessage('ASSET_QUARANTINE', { seq: sequence });
  const parsed = z
    .object({
      source: z.literal('https://wallpaperdb/asset'),
      type: z.enum(['asset.command.quarantined', 'asset.notification.quarantined']),
      data: z.object({ subject: z.string(), encoded: z.string().max(32768) }),
    })
    .parse(JSON.parse(record.string()));
  const bytes = Buffer.from(parsed.data.encoded, 'base64');
  if (bytes.toString('base64') !== parsed.data.encoded)
    throw new Error('Invalid quarantine encoding');
  if (parsed.type === 'asset.notification.quarantined') {
    if (parsed.data.subject !== 'asset.operator.notifications')
      throw new Error('Invalid notification recovery target');
    noticeSchema.parse(JSON.parse(bytes.toString('utf8')));
  } else {
    const decoded = decodeAssetCommand(
      [
        { subject: application.createSubject, applicationId, operation: 'create' },
        { subject: application.deleteSubject, applicationId, operation: 'delete' },
      ],
      parsed.data.subject,
      bytes
    );
    if (decoded.kind !== 'command')
      throw new Error('Quarantined command needs correction before replay');
  }
  return connection.jetstream().publish(parsed.data.subject, bytes, {
    msgID: `operator-recovery:${randomUUID()}`,
    timeout: 5000,
  });
}
