import { Clock, Context, Effect, Layer, Schema, Semaphore } from 'effect';
import {
  Profiles,
  type ProfilePrincipal,
  type ProfileOutcome,
  type ProfileRejection,
  type ProfileUnavailable,
} from '../profile/index.js';

export class PictureUnavailable extends Schema.TaggedError<PictureUnavailable>()(
  'PictureUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}

export interface PictureLimits {
  readonly maxBytes: number;
  readonly maxPixels: number;
  readonly maxDecodedBytes: number;
}

export interface ProcessedPicture {
  readonly bytes: Buffer;
  readonly mimeType: 'image/webp';
  readonly width: number;
  readonly height: number;
}

export interface PictureRejection {
  readonly _tag: 'Rejected';
  readonly reason: 'invalid-picture' | 'picture-too-large' | 'picture-source-rejected';
  readonly message: string;
}

/** Decodes bounded still images, strips source metadata, and stops native work on interruption. */
export interface PictureCodec {
  process(
    bytes: Buffer
  ): Effect.Effect<
    { readonly _tag: 'Processed'; readonly picture: ProcessedPicture } | PictureRejection,
    PictureUnavailable
  >;
}
export const PictureCodec = Context.Service<PictureCodec>('wallpaperdb.user.pictures.PictureCodec');

/** Downloads only trusted HTTPS destinations with bounded redirects, bytes and total duration. */
export interface PictureSource {
  download(
    url: string
  ): Effect.Effect<
    { readonly _tag: 'Downloaded'; readonly bytes: Buffer } | PictureRejection,
    PictureUnavailable
  >;
}
export const PictureSource = Context.Service<PictureSource>(
  'wallpaperdb.user.pictures.PictureSource'
);

export interface StoredPicture {
  readonly id: string;
  readonly profileId: string;
  readonly mimeType: 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
  readonly expiresAt: Date | null;
}
export interface PictureCursor {
  readonly id: string;
  readonly expiresAt: Date | null;
}
export interface PictureImportCursor {
  readonly profileId: string;
  readonly nextAttemptAt: Date;
}
export interface PictureImport {
  readonly profileId: string;
  readonly sourceUrl: string;
  readonly leaseToken: string;
  /** Number of attempts preceding this claim, for first-retry backoff. */
  readonly attempts: number;
}
/** Candidates are durable before PUT. Upload claims serialize with adoption and
 * deletion, and become adoptable only after completion. Deletion claims mark an
 * unreferenced expired candidate permanently unavailable before external DELETE.
 * No transaction spans an external resource. Import completion/retry is fenced. */
export interface PictureStore {
  createCandidate(
    input: Omit<StoredPicture, 'id'> & { readonly createdAt: Date }
  ): Effect.Effect<StoredPicture, PictureUnavailable>;
  beginUpload(id: string, now: Date): Effect.Effect<boolean, PictureUnavailable>;
  finishUpload(id: string, now: Date): Effect.Effect<boolean, PictureUnavailable>;
  available(id: string): Effect.Effect<boolean, PictureUnavailable>;
  expired(
    now: Date,
    cursor?: PictureCursor
  ): Effect.Effect<readonly StoredPicture[], PictureUnavailable>;
  claimDeletion(id: string, now: Date): Effect.Effect<StoredPicture | null, PictureUnavailable>;
  finishDeletion(id: string): Effect.Effect<boolean, PictureUnavailable>;
  /** Returns at most 100 due jobs strictly after the cursor, ordered by
   * (nextAttemptAt, profileId). A short page terminates the current sweep. */
  dueImports(
    now: Date,
    cursor?: PictureImportCursor
  ): Effect.Effect<readonly PictureImportCursor[], PictureUnavailable>;
  claimImport(
    profileId: string,
    now: Date,
    leaseDurationMs: number
  ): Effect.Effect<PictureImport | null, PictureUnavailable>;
  settleImport(
    job: PictureImport,
    permanent: boolean,
    nextAttemptAt: Date
  ): Effect.Effect<void, PictureUnavailable>;
}
export const PictureStore = Context.Service<PictureStore>('wallpaperdb.user.pictures.PictureStore');

/** Logical IDs resolve to their persisted object address, independently of current configuration.
 * Object keys are immutable. Writes and deletes are abortable and bounded by
 * ten seconds; failures may be ambiguous and must preserve durable evidence. */
export interface PictureObjects {
  put(assetId: string, bytes: Buffer): Effect.Effect<void, PictureUnavailable>;
  delete(assetId: string): Effect.Effect<void, PictureUnavailable>;
}
export const PictureObjects = Context.Service<PictureObjects>(
  'wallpaperdb.user.pictures.PictureObjects'
);

export interface PicturesPolicy {
  readonly profileEvidenceRetentionDays: number;
  readonly profilePictureImportTimeoutMs: number;
}
export type StageOutcome =
  | { readonly _tag: 'Staged'; readonly assetId: string }
  | PictureRejection
  | ProfileRejection;
export interface Pictures {
  stage(
    principal: ProfilePrincipal,
    bytes: Buffer
  ): Effect.Effect<StageOutcome, PictureUnavailable>;
  upload(
    principal: ProfilePrincipal,
    bytes: Buffer,
    expectedVersion: number
  ): Effect.Effect<ProfileOutcome | PictureRejection, PictureUnavailable | ProfileUnavailable>;
  pictureAvailable(id: string): Effect.Effect<boolean, PictureUnavailable>;
  /** Each due job is isolated; failed counts technical failures even when a retry is persisted.
   * Discovery failures remain in the error channel because no batch could be inspected. */
  importPending(isStopping?: () => boolean): Effect.Effect<{ failed: number }, PictureUnavailable>;
  cleanupExpired(
    now: Date,
    isStopping?: () => boolean
  ): Effect.Effect<{ deleted: number; failed: number }, PictureUnavailable>;
}
export const Pictures = Context.Service<Pictures>('wallpaperdb.user.pictures.Pictures');

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
