import { Clock, Effect, Layer, Semaphore } from 'effect';
import { type ProfilePrincipal, Profiles } from '../profile/index.js';
import type {
  PictureCursor,
  PictureImport,
  PictureImportCursor,
  PicturesPolicy,
  StoredPicture,
} from './contract.js';
import { PictureCodec, PictureObjects, PictureSource, PictureStore, Pictures } from './contract.js';

export const picturesLayer = (policy: PicturesPolicy) =>
  Layer.effect(
    Pictures,
    Effect.gen(function* () {
      const store = yield* PictureStore;
      const codec = yield* PictureCodec;
      const objects = yield* PictureObjects;
      const source = yield* PictureSource;
      const profiles = yield* Profiles;
      const retention = yield* Semaphore.make(1);
      let cursor: PictureCursor | undefined;
      let importCursor: PictureImportCursor | undefined;
      const stage = Effect.fn('pictures.stage')(function* (
        principal: ProfilePrincipal,
        bytes: Buffer
      ) {
        if (!principal.profileId)
          return {
            _tag: 'Rejected',
            reason: 'unauthorized',
            message: 'Authentication is required',
          } as const;
        const decoded = yield* codec.process(bytes);
        if (decoded._tag === 'Rejected') return decoded;
        const { picture } = decoded;
        const now = new Date(yield* Clock.currentTimeMillis);
        const asset = yield* store.createCandidate({
          profileId: principal.profileId,
          mimeType: picture.mimeType,
          width: picture.width,
          height: picture.height,
          fileSizeBytes: picture.bytes.length,
          createdAt: now,
          expiresAt: new Date(now.getTime() + policy.profileEvidenceRetentionDays * 86_400_000),
        });
        const id = asset.id;
        if (!(yield* store.beginUpload(id, now)))
          return {
            _tag: 'Rejected',
            reason: 'picture-unavailable',
            message: 'Staged Profile picture expired before its upload could start',
          } as const;
        yield* objects.put(id, picture.bytes);
        const finishedAt = new Date(yield* Clock.currentTimeMillis);
        if (!(yield* store.finishUpload(id, finishedAt)))
          return {
            _tag: 'Rejected',
            reason: 'picture-unavailable',
            message: 'Staged Profile picture upload lease expired',
          } as const;
        return { _tag: 'Staged', assetId: id } as const;
      });
      const settle = (job: PictureImport, permanent: boolean) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const delay = Math.min(3_600_000, 1_000 * 2 ** Math.min(job.attempts, 12));
          yield* store.settleImport(job, permanent || job.attempts >= 11, new Date(now + delay));
        });
      const importPicture = (job: PictureImport) =>
        Effect.gen(function* () {
          const downloaded = yield* source.download(job.sourceUrl);
          if (downloaded._tag === 'Rejected') return yield* settle(job, true);
          const candidate = yield* stage({ profileId: job.profileId }, downloaded.bytes);
          if (candidate._tag === 'Rejected')
            return yield* settle(job, candidate.reason !== 'picture-unavailable');
          const result = yield* profiles.adoptImportedPicture(
            { profileId: job.profileId, leaseToken: job.leaseToken },
            candidate.assetId
          );
          if (result._tag === 'Rejected') yield* settle(job, false);
        });
      const deleteExpired = (candidate: StoredPicture, now: Date) =>
        Effect.gen(function* () {
          const asset = yield* store.claimDeletion(candidate.id, now);
          if (!asset) return false;
          yield* objects.delete(asset.id);
          return yield* store.finishDeletion(asset.id);
        });
      return Pictures.of({
        stage,
        upload: Effect.fn('pictures.upload')(function* (principal, bytes, expectedVersion) {
          const candidate = yield* stage(principal, bytes);
          if (candidate._tag === 'Rejected') return candidate;
          return yield* profiles.adoptPicture(principal, candidate.assetId, expectedVersion);
        }),
        pictureAvailable: (id) => store.available(id),
        importPending: Effect.fn('pictures.import-pending')(function* (isStopping = () => false) {
          const result = { failed: 0 };
          if (isStopping()) return result;
          const candidates = yield* store.dueImports(
            new Date(yield* Clock.currentTimeMillis),
            importCursor
          );
          for (const candidate of candidates) {
            if (isStopping()) break;
            importCursor = candidate;
            const id = candidate.profileId;
            const failed = yield* Effect.gen(function* () {
              const job = yield* store.claimImport(
                id,
                new Date(yield* Clock.currentTimeMillis),
                policy.profilePictureImportTimeoutMs + 60_000
              );
              if (!job) return false;
              if (job.attempts >= 12) {
                yield* settle(job, true);
                return false;
              }
              return yield* importPicture(job).pipe(
                Effect.as(false),
                Effect.catchTags({
                  PictureUnavailable: () => settle(job, false).pipe(Effect.as(true)),
                  ProfileUnavailable: () => settle(job, false).pipe(Effect.as(true)),
                })
              );
            }).pipe(
              Effect.catchTag('PictureUnavailable', () =>
                Effect.gen(function* () {
                  yield* Effect.logError('Initial picture import failed; will retry', {
                    profileId: id,
                  });
                  return true;
                })
              )
            );
            if (failed) result.failed++;
          }
          if (candidates.length < 100 && !isStopping()) importCursor = undefined;
          return result;
        }),
        cleanupExpired: (now, isStopping = () => false) =>
          retention.withPermit(
            Effect.gen(function* () {
              const result = { deleted: 0, failed: 0 };
              if (isStopping()) return result;
              const candidates = yield* store.expired(now, cursor);
              for (const candidate of candidates) {
                if (isStopping()) break;
                cursor = candidate;
                const deleted = yield* deleteExpired(candidate, now).pipe(
                  Effect.catchTag('PictureUnavailable', () =>
                    Effect.gen(function* () {
                      result.failed++;
                      yield* Effect.logError('Profile picture cleanup failed; will retry', {
                        category: 'profile-picture-retention',
                        assetId: candidate.id,
                      });
                      return false;
                    })
                  )
                );
                if (deleted) result.deleted++;
              }
              if (candidates.length < 100 && !isStopping()) cursor = undefined;
              return result;
            }).pipe(Effect.withSpan('pictures.cleanup-expired'))
          ),
      });
    })
  );
