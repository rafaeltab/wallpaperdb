import { describe, expect, it } from 'vitest';
import { decodeConfirmation } from '../src/adapters/picture-attachments/index.js';
import { parseAttachmentConfig } from '../src/attachment-config.js';
const base = {
  specversion: '1.0',
  id: 'result-event',
  source: 'https://wallpaperdb/asset',
  type: 'asset.command.result',
  time: '2026-10-23T00:00:00.000Z',
  datacontenttype: 'application/json',
  causationsource: 'https://wallpaperdb/user',
  causationid: 'creation-event',
  correlationid: 'attachment-A',
};
const result = {
  commandId: 'create-A',
  applicationReference: 'attachment-A',
  outcome: 'created',
  assetId: 'asset-A',
};
const source = {
  ...base,
  type: 'asset.source.accepted',
  causationsource: 'https://wallpaperdb/asset/authors',
  causationid: 'accepted-event',
  correlationid: 'edit-A',
  data: {
    assetId: 'asset-A',
    assetType: 'picture',
    candidateId: 'candidate-A',
    sourceId: 'source-A',
    defaultSourceId: 'source-A',
    initialAnalysisSourceId: 'source-A',
    sourceSetRevision: '1',
    deliveryRevision: '1',
  },
};
const decode = (input: unknown) => decodeConfirmation(Buffer.from(JSON.stringify(input)));
describe('Protected User Asset confirmation translation', () => {
  it('preserves command, application, occurrence and causation identities for create and delete results', () => {
    expect(decode({ ...base, data: result })).toMatchObject({
      kind: 'result',
      result: {
        attachmentId: 'attachment-A',
        commandId: 'create-A',
        causationId: 'creation-event',
        outcome: 'created',
        assetId: 'asset-A',
      },
      context: { id: 'result-event', correlationid: 'attachment-A' },
    });
    expect(
      decode({
        ...base,
        causationid: 'deletion-event',
        data: { ...result, commandId: 'delete-A', outcome: 'already-deleted' },
      })
    ).toMatchObject({
      kind: 'result',
      result: {
        commandId: 'delete-A',
        causationId: 'deletion-event',
        outcome: 'already-deleted',
        assetId: 'asset-A',
      },
    });
    expect(
      decode({
        ...base,
        data: { ...result, outcome: 'rejected', assetId: null, reason: 'unsupported-type' },
      })
    ).toMatchObject({ kind: 'result', result: { outcome: 'rejected', assetId: null } });
  });
  it('requires a picture Source confirmation and preserves its exact edit and trace context', () => {
    expect(
      decode({
        ...source,
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        tracestate: 'test=1',
      })
    ).toMatchObject({
      kind: 'source',
      confirmation: {
        assetId: 'asset-A',
        candidateId: 'candidate-A',
        intentId: 'edit-A',
        sourceId: 'source-A',
        defaultSourceId: 'source-A',
        initialAnalysisSourceId: 'source-A',
        occurrenceId: 'result-event',
        trace: {
          traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
          tracestate: 'test=1',
        },
      },
    });
  });
  it.each([
    { ...base, source: 'https://forged.example/asset', data: result },
    { ...base, causationsource: 'https://wallpaperdb/wallpaper', data: result },
    { ...base, specversion: '0.3', data: result },
    { ...base, data: { ...result, assetId: null } },
    { ...base, data: { ...result, ownerSubject: 'forged' } },
    { ...source, causationsource: 'https://wallpaperdb/user' },
    { ...source, correlationid: undefined },
    { ...source, data: { ...source.data, assetType: 'wallpaper' } },
    { ...source, data: { ...source.data, storageBucket: 'private-bucket' } },
    { ...source, data: { ...source.data, sourceSetRevision: 1 } },
  ])('rejects malformed, misrouted or private external fields before any capability call', (input) =>
    expect(decode(input)).toEqual({ kind: 'invalid' }));
  it.each([
    Buffer.from('{'),
    Buffer.from([0xff]),
    Buffer.alloc(16385),
  ])('rejects invalid or oversized encoded confirmation input', (input) =>
    expect(decodeConfirmation(input)).toEqual({ kind: 'invalid' }));
});
it('parses the private workflow configuration with finite transport bounds and rejects missing or unknown controls', () => {
  const valid = {
    credential: { user: 'user-1', password: 'private' },
    operatorNotification: { url: 'http://operator.test/events', token: 'private' },
    maxAttempts: 3,
    retryDelayMs: 100,
    pollMs: 20,
    shutdownTimeoutMs: 1000,
  };
  expect(parseAttachmentConfig(valid)).toEqual(valid);
  expect(() => parseAttachmentConfig({ ...valid, maxAttempts: 0 })).toThrow();
  expect(() => parseAttachmentConfig({ ...valid, pollMs: 30001 })).toThrow();
  expect(() => parseAttachmentConfig({ ...valid, credential: { user: 'user-1' } })).toThrow();
  expect(() => parseAttachmentConfig({ ...valid, attachmentDeadlineMs: 86400000 })).toThrow();
});
