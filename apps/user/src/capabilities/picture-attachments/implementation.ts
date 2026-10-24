import { Effect, Layer } from 'effect';
import {
  AttachmentStore,
  PictureAttachments,
  type AttachmentOutcome,
  type PictureAttachment,
} from './contract.js';
const terminal = (i: PictureAttachment) =>
  ['cancelled', 'conflicted', 'abandoned', 'failed'].includes(i.state);
const orphan = (i: PictureAttachment, state: 'cancelled' | 'conflicted' | 'abandoned') => {
  i.state = state;
  if (i.assetId && i.deletion !== 'complete') i.deletion = 'pending';
  return i;
};
const bounded = (s: string) =>
  new TextEncoder().encode(s).length > 0 && new TextEncoder().encode(s).length <= 256;
export const pictureAttachmentsLayer = Layer.effect(
  PictureAttachments,
  Effect.gen(function* () {
    const store = yield* AttachmentStore;
    const access = (profileId: string, i: PictureAttachment | null): i is PictureAttachment =>
      !!profileId && i?.profileId === profileId;
    return PictureAttachments.of({
      begin: (principal, key, expectedVersion, trace) => {
        if (!principal.profileId) return Effect.succeed({ kind: 'forbidden' });
        if (
          !/^[\x21-\x7e]{1,128}$/.test(key) ||
          !Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 1
        )
          return Effect.succeed({ kind: 'conflict' });
        return store
          .change<AttachmentOutcome>(
            {
              kind: 'begin',
              profileId: principal.profileId,
              key,
              expectedVersion,
              ...(trace ? { trace } : {}),
            },
            ({ intent, previous, profile, existing }) => {
              if (!intent || !profile) return { result: { kind: 'unavailable' } };
              if (existing)
                return {
                  result:
                    intent.expectedVersion === expectedVersion
                      ? { kind: 'attachment', attachment: intent }
                      : { kind: 'conflict' },
                };
              if (profile.version !== expectedVersion || profile.pictureAssetId !== null)
                return { result: { kind: 'conflict' } };
              return {
                intent,
                select: true,
                ...(previous &&
                previous.id !== intent.id &&
                !terminal(previous) &&
                previous.state !== 'attached'
                  ? { previous: orphan(previous, 'abandoned') }
                  : {}),
                result: { kind: 'attachment', attachment: intent },
              };
            }
          )
          .pipe(Effect.withSpan('pictures.attachment.begin'));
      },
      get: (p, id) =>
        store
          .change<AttachmentOutcome>({ kind: 'intent', id }, ({ intent, profile }) => {
            if (!access(p.profileId, intent)) return { result: { kind: 'unavailable' } };
            if (
              !terminal(intent) &&
              intent.state !== 'attached' &&
              (!profile ||
                profile.pictureIntentId !== intent.id ||
                profile.version !== intent.expectedVersion ||
                profile.pictureAssetId !== null)
            )
              orphan(intent, 'conflicted');
            return { intent, result: { kind: 'attachment', attachment: intent } };
          })
          .pipe(Effect.withSpan('pictures.attachment.get')),
      expectSource: (p, id, source) =>
        store
          .change<AttachmentOutcome>({ kind: 'intent', id }, ({ intent, profile }) => {
            if (!access(p.profileId, intent)) return { result: { kind: 'unavailable' } };
            if (
              !bounded(source.candidateId) ||
              !bounded(source.intentId) ||
              !['awaiting-source', 'accepting-source'].includes(intent.state)
            )
              return { result: { kind: 'conflict' } };
            if (
              !profile ||
              profile.pictureIntentId !== intent.id ||
              profile.version !== intent.expectedVersion ||
              profile.pictureAssetId !== null
            )
              return { intent: orphan(intent, 'conflicted'), result: { kind: 'conflict' } };
            intent.sourceIntent = source;
            intent.state = 'accepting-source';
            return {
              intent,
              registration: source,
              result: { kind: 'attachment', attachment: intent },
            };
          })
          .pipe(Effect.withSpan('pictures.attachment.expect-source')),
      cancel: (p, id) =>
        store
          .change<AttachmentOutcome>({ kind: 'intent', id }, ({ intent }) => {
            if (!access(p.profileId, intent)) return { result: { kind: 'unavailable' } };
            if (intent.state === 'attached') return { result: { kind: 'conflict' } };
            if (!terminal(intent)) orphan(intent, 'cancelled');
            return { intent, result: { kind: 'attachment', attachment: intent } };
          })
          .pipe(Effect.withSpan('pictures.attachment.cancel')),
      assetResult: (result) =>
        store
          .change<'applied' | 'ignored' | 'requires-attention'>(
            { kind: 'intent', id: result.attachmentId },
            ({ intent, profile }) => {
              if (!intent) return { result: 'ignored' };
              if (
                result.commandId === intent.deleteCommandId &&
                result.causationId === intent.deletionEventId
              ) {
                if (
                  intent.deletion === 'pending' &&
                  result.outcome === 'rejected' &&
                  (result.assetId === null || result.assetId === intent.assetId)
                ) {
                  intent.deletionRejected = true;
                  intent.attentionRequired = true;
                  return { intent, result: 'requires-attention' };
                }
                if (
                  intent.deletion !== 'pending' ||
                  result.assetId !== intent.assetId ||
                  !['deleted', 'already-deleted'].includes(result.outcome)
                )
                  return { result: 'ignored' };
                intent.deletion = 'complete';
                delete intent.deletionRejected;
                return { intent, result: 'applied' };
              }
              if (
                result.commandId !== intent.commandId ||
                result.causationId !== intent.creationEventId ||
                !['created', 'rejected'].includes(result.outcome)
              )
                return { result: 'ignored' };
              if (intent.assetId !== null || intent.state === 'attached')
                return { result: 'ignored' };
              if (result.outcome === 'created') {
                if (!result.assetId) return { result: 'ignored' };
                intent.assetId = result.assetId;
                if (terminal(intent)) intent.deletion = 'pending';
                else if (
                  !profile ||
                  profile.pictureIntentId !== intent.id ||
                  profile.version !== intent.expectedVersion ||
                  profile.pictureAssetId !== null
                )
                  orphan(intent, 'conflicted');
                else intent.state = 'awaiting-source';
              } else if (!terminal(intent)) intent.state = 'failed';
              return { intent, result: 'applied' };
            }
          )
          .pipe(Effect.withSpan('pictures.attachment.asset-result')),
      sourceAccepted: (c) =>
        store
          .change<'applied' | 'ignored'>(
            {
              kind: 'asset',
              id: c.assetId,
              sourceIntent: { candidateId: c.candidateId, intentId: c.intentId },
            },
            ({ intent, profile, registered }) => {
              if (
                !intent ||
                intent.state !== 'accepting-source' ||
                !registered ||
                c.sourceId !== c.defaultSourceId ||
                c.sourceId !== c.initialAnalysisSourceId
              )
                return { result: 'ignored' };
              if (
                intent.sourceIntent?.candidateId !== c.candidateId ||
                intent.sourceIntent?.intentId !== c.intentId ||
                !profile ||
                profile.pictureIntentId !== intent.id ||
                profile.version !== intent.expectedVersion ||
                profile.pictureAssetId !== null
              )
                return { intent: orphan(intent, 'conflicted'), result: 'ignored' };
              intent.state = 'attached';
              intent.sourceId = c.sourceId;
              return {
                intent,
                attach: {
                  assetId: c.assetId,
                  sourceId: c.sourceId,
                  causationId: c.occurrenceId,
                  ...(c.trace ? { trace: c.trace } : {}),
                },
                result: 'applied',
              };
            }
          )
          .pipe(Effect.withSpan('pictures.attachment.source-accepted')),
    });
  })
);
