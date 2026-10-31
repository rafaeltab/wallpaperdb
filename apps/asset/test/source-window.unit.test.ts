import { it } from 'vitest';
import type { SourceState } from '../src/capabilities/sources/index.js';
import { mergeSourceWindow, sourceWindow } from './fixtures/source-window.js';
import { sourceWindowContract } from './fixtures/source-window-contract.js';

it.each([32, 2048])(
  'qualifies controlled selection against the shared contract with %i candidates',
  async (size) => {
    const assetId = `asset_history_${size}`;
    let state: SourceState = {
      asset: {
        id: assetId,
        applicationId: 'wallpaper',
        assetType: 'wallpaper',
        owner: { namespace: 'clerk', subject: 'owner' },
      },
      sourceSetRevision: '0',
      deliveryRevision: '0',
      defaultSourceId: null,
      initialAnalysisSourceId: null,
      sources: [],
      nonterminalCandidateCount: 0,
      candidates: Array.from({ length: size }, (_, index) => ({
        candidateId: `${assetId}_${index}`,
        sourceId: `${assetId}_source_${index}`,
        idempotencyKey: `history-${index}`,
        operation: 'add',
        expectedSourceSetRevision: '0',
        status: 'cancelled',
        expiresAt: index === 2 ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
        orphanExpiresAt: '2099-01-01T00:00:00Z',
        layout: 'asset-layout-1',
      })),
    };
    await sourceWindowContract(
      async (selection, change) => {
        const window = sourceWindow(state, selection);
        change?.(window);
        state = mergeSourceWindow(state, window);
        return window;
      },
      assetId,
      size
    );
  }
);
