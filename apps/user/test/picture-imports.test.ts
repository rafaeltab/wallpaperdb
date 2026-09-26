import { Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { Profiles } from '../src/profile/index.js';
import {
  PictureCodec,
  PictureObjects,
  PictureSource,
  PictureStore,
  PictureUnavailable,
  Pictures,
  picturesLayer,
  type PictureImport,
} from '../src/pictures/index.js';

const runtimes: Array<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});
const unavailable = (operation: string) =>
  Effect.fail(new PictureUnavailable({ operation, cause: { reason: 'temporary' } }));
const unexpected = () => Effect.die('Unexpected picture import operation');

function setup(ids = ['a_failed', 'b_healthy']) {
  const jobs = new Map(
    ids.map((profileId) => [
      profileId,
      {
        profileId,
        sourceUrl: `https://img.clerk.com/${profileId}?secret=captured`,
        attempts: 0,
        nextAttemptAt: new Date(0),
        leaseUntil: new Date(0),
        leaseToken: '',
        status: 'pending',
      },
    ])
  );
  const claimFailures = new Set<string>();
  const settlementFailures = new Set<string>();
  const downloads: string[] = [];
  const settlements: Array<{ job: PictureImport; permanent: boolean; nextAttemptAt: Date }> = [];
  let source: PictureSource['download'] = () =>
    Effect.succeed({
      _tag: 'Rejected',
      reason: 'picture-source-rejected',
      message: 'Source was removed',
    });
  const store: PictureStore = {
    createCandidate: unexpected,
    beginUpload: unexpected,
    finishUpload: unexpected,
    available: unexpected,
    expired: unexpected,
    claimDeletion: unexpected,
    finishDeletion: unexpected,
    dueImports: (now, cursor) =>
      Effect.sync(() =>
        [...jobs.values()]
          .filter(
            (job) =>
              job.status !== 'complete' &&
              job.nextAttemptAt <= now &&
              job.leaseUntil <= now &&
              (!cursor ||
                job.nextAttemptAt > cursor.nextAttemptAt ||
                (job.nextAttemptAt.getTime() === cursor.nextAttemptAt.getTime() &&
                  job.profileId > cursor.profileId))
          )
          .sort(
            (a, b) =>
              a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() ||
              a.profileId.localeCompare(b.profileId)
          )
          .slice(0, 100)
          .map(({ profileId, nextAttemptAt }) => ({ profileId, nextAttemptAt }))
      ),
    claimImport: (profileId, now, duration) =>
      Effect.gen(function* () {
        if (claimFailures.has(profileId)) return yield* unavailable('claim-import');
        const job = jobs.get(profileId);
        if (!job || job.leaseUntil > now || job.status === 'complete') return null;
        const claimed = {
          profileId,
          sourceUrl: job.sourceUrl,
          leaseToken: `${profileId}-${job.attempts}`,
          attempts: job.attempts,
        };
        job.attempts++;
        job.leaseToken = claimed.leaseToken;
        job.leaseUntil = new Date(now.getTime() + duration);
        return claimed;
      }),
    settleImport: (job, permanent, nextAttemptAt) =>
      Effect.gen(function* () {
        if (settlementFailures.has(job.profileId)) return yield* unavailable('settle-import');
        settlements.push({ job, permanent, nextAttemptAt });
        const current = jobs.get(job.profileId);
        if (!current || current.leaseToken !== job.leaseToken) return;
        current.status = permanent ? 'complete' : 'retrying';
        current.sourceUrl = permanent ? '' : job.sourceUrl;
        current.nextAttemptAt = nextAttemptAt;
        current.leaseUntil = new Date(0);
      }),
  };
  const runtime = ManagedRuntime.make(
    picturesLayer({ profileEvidenceRetentionDays: 7, profilePictureImportTimeoutMs: 1000 }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(PictureStore, store),
          Layer.succeed(PictureObjects, { put: unexpected, delete: unexpected }),
          Layer.succeed(PictureCodec, { process: unexpected }),
          Layer.succeed(PictureSource, {
            download: (url) =>
              Effect.suspend(() => {
                downloads.push(url);
                return source(url);
              }),
          }),
          Layer.succeed(Profiles, {
            ensure: unexpected,
            updateDetails: unexpected,
            changeHandle: unexpected,
            reactivateAlias: unexpected,
            scheduleAliasExpiry: unexpected,
            expireAliasImmediately: unexpected,
            expireDueAlias: unexpected,
            adoptPicture: unexpected,
            adoptImportedPicture: unexpected,
          })
        )
      ),
      Layer.provideMerge(TestClock.layer())
    )
  );
  runtimes.push(runtime);
  return {
    jobs,
    claimFailures,
    settlementFailures,
    downloads,
    settlements,
    source: (next: PictureSource['download']) => {
      source = next;
    },
    tick: (duration: number) => runtime.runPromise(TestClock.adjust(duration)),
    run: () => runtime.runPromise(Effect.flatMap(Pictures, (pictures) => pictures.importPending())),
  };
}

describe('Initial picture import decisions', () => {
  it('continues after a claim failure and reports the unhealthy batch', async () => {
    const test = setup();
    test.claimFailures.add('a_failed');
    expect(await test.run()).toEqual({ failed: 1 });
    expect(test.settlements.map((entry) => entry.job.profileId)).toEqual(['b_healthy']);
    expect(test.jobs.get('a_failed')?.attempts).toBe(0);
    expect(test.jobs.get('b_healthy')?.status).toBe('complete');
  });
  it.each([
    0, 12,
  ])('continues after settlement fails for a job with %i preceding attempts', async (attempts) => {
    const test = setup();
    const job = test.jobs.get('a_failed');
    if (!job) throw new Error('Expected the failing import');
    job.attempts = attempts;
    test.settlementFailures.add('a_failed');
    expect(await test.run()).toEqual({ failed: 1 });
    expect(test.jobs.get('b_healthy')?.status).toBe('complete');
    expect(job.status).toBe('pending');
    expect(job.leaseUntil.getTime()).toBe(61_000);
  });

  it('visits work beyond a full batch of permanently failing claims and revisits failures on wrap', async () => {
    const poisoned = Array.from({ length: 100 }, (_, i) => `a_${String(i).padStart(3, '0')}`);
    const test = setup([...poisoned, 'b_healthy']);
    for (const id of poisoned) test.claimFailures.add(id);
    expect(await test.run()).toEqual({ failed: 100 });
    expect(await test.run()).toEqual({ failed: 0 });
    expect(test.jobs.get('b_healthy')?.status).toBe('complete');
    test.claimFailures.delete('a_000');
    expect(await test.run()).toEqual({ failed: 99 });
    expect(test.jobs.get('a_000')?.status).toBe('complete');
  });
});
