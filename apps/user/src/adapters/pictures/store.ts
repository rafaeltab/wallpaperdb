import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { ulid } from 'ulid';
import { profilePictureAssets, profilePictureImports, profiles } from '../../db/schema.js';
import { PictureStore, PictureUnavailable, type StoredPicture } from '../../pictures/index.js';
import { Database } from '../database/index.js';

const due = (now: Date) =>
  and(
    inArray(profilePictureImports.status, ['pending', 'retrying']),
    lte(profilePictureImports.nextAttemptAt, now),
    or(isNull(profilePictureImports.leaseUntil), lte(profilePictureImports.leaseUntil, now))
  );

export const pictureStoreLayer = Layer.effect(
  PictureStore,
  Effect.gen(function* () {
    const database = yield* Database;
    // The generic stays attached to the callback so each operation preserves its result type.
    const query = <A>(
      operation: string,
      run: (db: Parameters<Parameters<Database['run']>[0]>[0]) => Promise<A>
    ) =>
      Effect.tryPromise({
        try: (signal) => database.run(run, signal),
        catch: (cause) => new PictureUnavailable({ operation, cause }),
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError('Picture persistence failed', { operation, cause: error.cause })
        ),
        Effect.withSpan(`pictures.persistence.${operation}`)
      );
    return PictureStore.of({
      createCandidate: (input) =>
        query('create-candidate', async (db) => {
          await db.insert(profilePictureAssets).values({ ...input, state: 'uploading' });
        }),
      beginUpload: (id, now) =>
        query('begin-upload', (db) =>
          db.transaction(async (tx) => {
            const candidate = await tx.query.profilePictureAssets.findFirst({
              where: eq(profilePictureAssets.id, id),
            });
            if (!candidate) return false;
            const [profile] = await tx
              .select()
              .from(profiles)
              .where(eq(profiles.id, candidate.profileId))
              .for('update');
            if (!profile) return false;
            const [asset] = await tx
              .select()
              .from(profilePictureAssets)
              .where(eq(profilePictureAssets.id, id))
              .for('update');
            // Recheck the current clock after lock acquisition; a queued candidate can expire.
            const startedAt = new Date(Math.max(now.getTime(), Date.now()));
            if (
              !asset ||
              asset.state !== 'uploading' ||
              asset.uploadLeaseUntil ||
              !asset.expiresAt ||
              asset.expiresAt <= startedAt
            )
              return false;
            await tx
              .update(profilePictureAssets)
              .set({ uploadLeaseUntil: new Date(startedAt.getTime() + 60_000) })
              .where(eq(profilePictureAssets.id, id));
            return true;
          })
        ),
      finishUpload: (id, now) =>
        query('finish-upload', async (db) => {
          const rows = await db
            .update(profilePictureAssets)
            .set({ state: 'staged', uploadLeaseUntil: null })
            .where(
              and(
                eq(profilePictureAssets.id, id),
                eq(profilePictureAssets.state, 'uploading'),
                gt(profilePictureAssets.uploadLeaseUntil, now)
              )
            )
            .returning({ id: profilePictureAssets.id });
          return rows.length === 1;
        }),
      available: (id) =>
        query('check-availability', async (db) => {
          const rows = await db
            .select({ id: profilePictureAssets.id })
            .from(profilePictureAssets)
            .innerJoin(
              profiles,
              and(
                eq(profiles.id, profilePictureAssets.profileId),
                eq(profiles.pictureAssetId, profilePictureAssets.id)
              )
            )
            .where(and(eq(profilePictureAssets.id, id), eq(profilePictureAssets.state, 'active')))
            .limit(1);
          return rows.length === 1;
        }),
      expired: (now, cursor) =>
        query('scan-expired', (db) =>
          db
            .select()
            .from(profilePictureAssets)
            .where(
              and(
                inArray(profilePictureAssets.state, ['uploading', 'staged', 'retired', 'deleting']),
                lte(profilePictureAssets.expiresAt, now),
                cursor?.expiresAt
                  ? sql`(${profilePictureAssets.expiresAt}, ${profilePictureAssets.id}) > (${cursor.expiresAt.toISOString()}, ${cursor.id})`
                  : undefined
              )
            )
            .orderBy(profilePictureAssets.expiresAt, profilePictureAssets.id)
            .limit(100)
        ),
      claimDeletion: (id, now) =>
        query<StoredPicture | null>('claim-deletion', (db) =>
          db.transaction(async (tx) => {
            const candidate = await tx.query.profilePictureAssets.findFirst({
              where: eq(profilePictureAssets.id, id),
            });
            if (!candidate) return null;
            const [profile] = await tx
              .select()
              .from(profiles)
              .where(eq(profiles.id, candidate.profileId))
              .for('update', { skipLocked: true });
            if (!profile || profile.pictureAssetId === id) return null;
            const [asset] = await tx
              .select()
              .from(profilePictureAssets)
              .where(eq(profilePictureAssets.id, id))
              .for('update', { skipLocked: true });
            if (!asset || asset.state === 'active' || !asset.expiresAt || asset.expiresAt > now)
              return null;
            // Sweep cutoff may be synthetic or in the future. Active PUT leases always
            // use wall time, independently of the requested retention cutoff.
            if (asset.uploadLeaseUntil && asset.uploadLeaseUntil.getTime() > Date.now())
              return null;
            await tx
              .update(profilePictureAssets)
              .set({ state: 'deleting', uploadLeaseUntil: null })
              .where(eq(profilePictureAssets.id, id));
            return asset;
          })
        ),
      finishDeletion: (id) =>
        query('finish-deletion', async (db) => {
          const rows = await db
            .delete(profilePictureAssets)
            .where(and(eq(profilePictureAssets.id, id), eq(profilePictureAssets.state, 'deleting')))
            .returning({ id: profilePictureAssets.id });
          return rows.length === 1;
        }),
      dueImports: (now) =>
        query('scan-imports', async (db) => {
          const jobs = await db
            .select({ profileId: profilePictureImports.profileId })
            .from(profilePictureImports)
            .where(due(now))
            .orderBy(profilePictureImports.nextAttemptAt, profilePictureImports.profileId)
            .limit(100);
          return jobs.map((job) => job.profileId);
        }),
      claimImport: (profileId, now, leaseDurationMs) =>
        query('claim-import', (db) =>
          db.transaction(async (tx) => {
            const [current] = await tx
              .select()
              .from(profilePictureImports)
              .where(and(eq(profilePictureImports.profileId, profileId), due(now)))
              .for('update', { skipLocked: true });
            if (!current?.sourceUrl) return null;
            const leaseToken = ulid();
            await tx
              .update(profilePictureImports)
              .set({
                attempts: current.attempts + 1,
                leaseToken,
                leaseUntil: new Date(now.getTime() + leaseDurationMs),
              })
              .where(eq(profilePictureImports.profileId, profileId));
            return {
              profileId,
              sourceUrl: current.sourceUrl,
              leaseToken,
              attempts: current.attempts,
            };
          })
        ),
      settleImport: (job, permanent, nextAttemptAt) =>
        query('settle-import', async (db) => {
          await db
            .update(profilePictureImports)
            .set({
              status: permanent ? 'complete' : 'retrying',
              sourceUrl: permanent ? null : job.sourceUrl,
              nextAttemptAt,
              leaseToken: null,
              leaseUntil: null,
            })
            .where(
              and(
                eq(profilePictureImports.profileId, job.profileId),
                eq(profilePictureImports.leaseToken, job.leaseToken)
              )
            );
        }),
    });
  })
);
