import { Effect, Layer } from 'effect';
import {
  Creation,
  WorkflowStore,
  type Creator,
  type Wallpaper,
  type WallpaperOutcome,
} from './contract.js';
const owns = (owner: Creator, wallpaper: Wallpaper | null) =>
  wallpaper !== null &&
  owner.namespace === wallpaper.owner.namespace &&
  owner.subject === wallpaper.owner.subject;
export function creationLayer(ownerNamespace: string) {
  return Layer.effect(
    Creation,
    Effect.gen(function* () {
      const store = yield* WorkflowStore;
      return Creation.of({
        begin: (owner, key) =>
          owner.namespace !== ownerNamespace
            ? Effect.succeed({ kind: 'forbidden' })
            : store.begin(owner, key).pipe(
                Effect.map((wallpaper) => ({ kind: 'wallpaper' as const, wallpaper })),
                Effect.withSpan('wallpaper.creation.begin')
              ),
        get: (owner, id) =>
          store.change<WallpaperOutcome>({ kind: 'wallpaper', id }, (wallpaper) => ({
            wallpaper,
            result:
              owns(owner, wallpaper) && wallpaper
                ? { kind: 'wallpaper', wallpaper }
                : { kind: 'unavailable' },
          })),
        expectSource: (owner, id, intent) =>
          store
            .change<WallpaperOutcome>({ kind: 'wallpaper', id }, (wallpaper) => {
              if (!owns(owner, wallpaper) || !wallpaper)
                return { wallpaper, result: { kind: 'unavailable' } };
              if (wallpaper.state !== 'awaiting-source' && wallpaper.state !== 'accepting-source')
                return { wallpaper, result: { kind: 'conflict' } };
              wallpaper.state = 'accepting-source';
              wallpaper.intent = intent;
              return { wallpaper, result: { kind: 'wallpaper', wallpaper } };
            })
            .pipe(Effect.withSpan('wallpaper.creation.expect-source')),
        assetResult: (result) =>
          store
            .change<'applied' | 'ignored'>(
              { kind: 'wallpaper', id: result.wallpaperId },
              (wallpaper) => {
                if (
                  !wallpaper ||
                  wallpaper.state !== 'creating-asset' ||
                  wallpaper.commandId !== result.commandId ||
                  wallpaper.creationEventId !== result.creationEventId ||
                  (result.outcome === 'created' && !result.assetId)
                )
                  return { wallpaper, result: 'ignored' };
                wallpaper.state = result.outcome === 'created' ? 'awaiting-source' : 'failed';
                wallpaper.assetId = result.outcome === 'created' ? result.assetId : null;
                return { wallpaper, result: 'applied' };
              }
            )
            .pipe(Effect.withSpan('wallpaper.creation.asset-result')),
        sourceAccepted: (confirmation) =>
          store
            .change<'applied' | 'ignored'>(
              { kind: 'asset', id: confirmation.assetId },
              (wallpaper) => {
                if (
                  !wallpaper ||
                  wallpaper.state !== 'accepting-source' ||
                  wallpaper.intent?.candidateId !== confirmation.candidateId ||
                  wallpaper.intent.intentId !== confirmation.intentId ||
                  confirmation.sourceId !== confirmation.defaultSourceId ||
                  confirmation.sourceId !== confirmation.initialAnalysisSourceId
                )
                  return { wallpaper, result: 'ignored' };
                wallpaper.state = 'published';
                wallpaper.sourceId = confirmation.sourceId;
                wallpaper.initialAnalysisSourceId = confirmation.initialAnalysisSourceId;
                return {
                  wallpaper,
                  result: 'applied',
                  publication: {
                    id: `published:${wallpaper.id}`,
                    wallpaperId: wallpaper.id,
                    contributorId: wallpaper.owner.subject,
                    assetId: confirmation.assetId,
                    sourceId: confirmation.sourceId,
                    initialAnalysisSourceId: confirmation.initialAnalysisSourceId,
                    causationId: confirmation.occurrenceId,
                  },
                };
              }
            )
            .pipe(Effect.withSpan('wallpaper.creation.source-accepted')),
      });
    })
  );
}
