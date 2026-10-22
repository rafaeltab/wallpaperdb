import { expect, it } from 'vitest';
import { decodeAssetCommand, encodeAssetResult } from '../src/adapters/commands/index.js';
const route = {
  subject: 'asset.commands.user.create',
  applicationId: 'user',
  operation: 'create' as const,
};
const envelope = {
  specversion: '1.0',
  id: 'occurrence-1',
  source: 'https://untrusted.example/claims/wallpaper',
  type: 'asset.command.create',
  time: '2026-10-22T00:00:00.000Z',
  datacontenttype: 'application/json',
  correlationid: 'workflow-1',
  data: {
    commandId: 'command-1',
    applicationReference: 'reference-1',
    assetType: 'picture',
    ownerSubject: 'owner-1',
  },
};
it('derives application authority only from the protected route and keeps command, occurrence and workflow identities separate', () => {
  expect(decodeAssetCommand([route], route.subject, Buffer.from(JSON.stringify(envelope)))).toEqual(
    {
      kind: 'command',
      applicationId: 'user',
      command: { operation: 'create', ...envelope.data },
      context: {
        occurrence: { id: 'occurrence-1', source: envelope.source },
        correlationId: 'workflow-1',
      },
    }
  );
  expect(
    decodeAssetCommand(
      [route],
      'asset.commands.wallpaper.create',
      Buffer.from(JSON.stringify(envelope))
    )
  ).toEqual({ kind: 'unroutable' });
  expect(
    decodeAssetCommand(
      [route],
      route.subject,
      Buffer.from(
        JSON.stringify({ ...envelope, data: { ...envelope.data, ownerNamespace: 'attacker' } })
      )
    )
  ).toMatchObject({
    kind: 'command',
    applicationId: 'user',
    command: { invalid: true, operation: 'create' },
  });
  expect(decodeAssetCommand([route], route.subject, Buffer.from('not-json'))).toEqual({
    kind: 'invalid',
  });
  expect(
    decodeAssetCommand(
      [route],
      route.subject,
      Buffer.from(JSON.stringify({ ...envelope, type: 'asset.command.delete' }))
    )
  ).toEqual({ kind: 'invalid' });
  const result = encodeAssetResult({
    id: 'result-occurrence',
    leaseId: 'lease',
    occurredAt: '2026-10-22T00:00:01.000Z',
    attempts: 1,
    applicationId: 'user',
    context: {
      occurrence: { id: envelope.id, source: envelope.source },
      correlationId: 'workflow-1',
    },
    result: {
      commandId: 'command-1',
      applicationReference: 'reference-1',
      outcome: 'created',
      assetId: 'asset_1',
    },
  });
  expect(result).toMatchObject({
    subject: 'asset.results.user',
    event: {
      id: 'result-occurrence',
      source: 'https://wallpaperdb/asset',
      type: 'asset.command.result',
      causationid: 'occurrence-1',
      causationsource: envelope.source,
      correlationid: 'workflow-1',
      data: {
        commandId: 'command-1',
        applicationReference: 'reference-1',
        assetId: 'asset_1',
        outcome: 'created',
      },
    },
  });
});
