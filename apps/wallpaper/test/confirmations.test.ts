import { expect, it } from 'vitest';
import { decodeConfirmation } from '../src/adapters/asset-workflow/index.js';
const event = {
  specversion: '1.0',
  id: 'result-1',
  source: 'https://wallpaperdb/asset',
  type: 'asset.command.result',
  time: '2026-10-22T00:00:00.000Z',
  datacontenttype: 'application/json',
  causationsource: 'https://wallpaperdb/wallpaper',
  causationid: 'creation-1',
  data: {
    commandId: 'command-1',
    applicationReference: 'wallpaper-1',
    outcome: 'created',
    assetId: 'asset-1',
  },
};
const encode = (input: unknown) => new TextEncoder().encode(JSON.stringify(input));
it('translates protected result confirmations without allowing envelope identity substitution', () => {
  expect(decodeConfirmation(encode(event))).toMatchObject({
    kind: 'created',
    result: {
      wallpaperId: 'wallpaper-1',
      commandId: 'command-1',
      creationEventId: 'creation-1',
      outcome: 'created',
      assetId: 'asset-1',
    },
  });
  expect(decodeConfirmation(encode({ ...event, source: 'https://attacker' }))).toEqual({
    kind: 'invalid',
  });
  expect(decodeConfirmation(encode({ ...event, causationsource: 'https://attacker' }))).toEqual({
    kind: 'invalid',
  });
  expect(
    decodeConfirmation(encode({ ...event, data: { ...event.data, ownerSubject: 'attacker' } }))
  ).toEqual({ kind: 'invalid' });
});
it('requires source confirmation to carry a bounded first-Source correlation', () => {
  const source = {
    ...event,
    type: 'asset.source.accepted',
    causationsource: 'https://wallpaperdb/asset/authors',
    correlationid: 'intent-1',
    data: {
      assetId: 'asset-1',
      assetType: 'wallpaper',
      candidateId: 'candidate-1',
      sourceId: 'source-1',
      defaultSourceId: 'source-1',
      sourceSetRevision: '1',
      deliveryRevision: '1',
      initialAnalysisSourceId: 'source-1',
    },
  };
  expect(decodeConfirmation(encode(source))).toMatchObject({
    kind: 'source',
    confirmation: {
      assetId: 'asset-1',
      candidateId: 'candidate-1',
      sourceId: 'source-1',
      defaultSourceId: 'source-1',
      initialAnalysisSourceId: 'source-1',
      intentId: 'intent-1',
      occurrenceId: 'result-1',
    },
  });
  expect(decodeConfirmation(encode({ ...source, correlationid: undefined }))).toEqual({
    kind: 'invalid',
  });
  expect(
    decodeConfirmation(encode({ ...source, data: { ...source.data, assetType: 'picture' } }))
  ).toEqual({ kind: 'invalid' });
  expect(decodeConfirmation(new Uint8Array(16385))).toEqual({ kind: 'invalid' });
});
it('retains creation confirmation identity and trace context for its asynchronous transition', () => {
  const traceparent = '00-11111111111111111111111111111111-2222222222222222-01';
  const decoded = decodeConfirmation(
    encode({ ...event, traceparent, tracestate: 'vendor=retained', correlationid: 'wallpaper-1' })
  );
  expect(decoded).toMatchObject({
    kind: 'created',
    context: {
      id: 'result-1',
      source: 'https://wallpaperdb/asset',
      type: 'asset.command.result',
      causationid: 'creation-1',
      causationsource: 'https://wallpaperdb/wallpaper',
      correlationid: 'wallpaper-1',
      traceparent,
      tracestate: 'vendor=retained',
    },
  });
});
