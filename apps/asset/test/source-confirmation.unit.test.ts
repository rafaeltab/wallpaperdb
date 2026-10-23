import { expect, it } from 'vitest';
import { encodeSourceConfirmation } from '../src/adapters/sources/index.js';
it('routes a committed logical confirmation only to its Creating application with stable event identity', () => {
  const confirmation = {
    context: {
      occurrence: { source: 'https://test/author', id: 'accept-request' },
      correlationId: 'intent-one',
    },
    id: 'source-accepted:source_one',
    applicationId: 'user',
    assetId: 'asset_one',
    assetType: 'picture',
    candidateId: 'candidate_one',
    sourceId: 'source_one',
    sourceSetRevision: '1',
    deliveryRevision: '1',
    defaultSourceId: 'source_one',
    initialAnalysisSourceId: 'source_one',
  };
  const encoded = encodeSourceConfirmation({
    id: confirmation.id,
    leaseId: 'lease_one',
    attempts: 1,
    occurredAt: '2026-10-22T18:00:00.000Z',
    confirmation,
  });
  expect(encoded).toEqual({
    subject: 'asset.results.user',
    event: {
      specversion: '1.0',
      id: confirmation.id,
      source: 'https://wallpaperdb/asset',
      type: 'asset.source.accepted',
      time: '2026-10-22T18:00:00.000Z',
      datacontenttype: 'application/json',
      causationid: 'accept-request',
      causationsource: 'https://test/author',
      correlationid: 'intent-one',
      data: {
        assetId: 'asset_one',
        assetType: 'picture',
        candidateId: 'candidate_one',
        sourceId: 'source_one',
        sourceSetRevision: '1',
        deliveryRevision: '1',
        defaultSourceId: 'source_one',
        initialAnalysisSourceId: 'source_one',
      },
    },
  });
  expect(JSON.stringify(encoded)).not.toMatch(/bucket|layout|key|lease|attempts|owner/i);
});
