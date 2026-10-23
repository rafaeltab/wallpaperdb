import { Clock, Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import {
  Sources,
  SourceStore,
  SourceBytes,
  MandatoryInspection,
  SourceFailure,
  sourcesLayer,
  type SourceState,
  type SourceStorePort,
  type SourceConfirmation,
  type SourceFacts,
  type SourcesPort,
} from '../src/capabilities/sources/index.js';
import { initialSourcePolicies, type SourcePolicy } from '../src/capabilities/sources/index.js';
const owner = { namespace: 'clerk', subject: 'owner' };
const intent = { operation: 'add' as const, expectedSourceSetRevision: '0' };
function fixture(policy: SourcePolicy = initialSourcePolicies.wallpaper, clock?: Clock.Clock) {
  let state: SourceState = {
    asset: { id: 'asset_one', applicationId: 'wallpaper', assetType: 'wallpaper', owner },
    sourceSetRevision: '0',
    deliveryRevision: '0',
    sources: [],
    candidates: [],
    nonterminalCandidateCount: 0,
    defaultSourceId: null,
    initialAnalysisSourceId: null,
  };
  let activeRevision = 'one';
  const confirmations: SourceConfirmation[] = [];
  const retirements: { sourceId: string; evidenceExpiresAt: string }[] = [];
  const stored = new Map<string, Uint8Array>();
  let prepare: () => Effect.Effect<void, SourceFailure> = () => Effect.void;
  let inspect: () => Effect.Effect<
    { kind: 'verified'; facts: SourceFacts } | { kind: 'rejected'; reason: string },
    SourceFailure
  > = () =>
    Effect.succeed({
      kind: 'verified',
      facts: {
        width: 100,
        height: 100,
        model: 'sdr-png',
        mimeType: 'image/png',
        byteLength: 4,
        digest: 'ignored',
      },
    });
  let ambiguousCommit = false;
  const store: SourceStorePort = {
    transact: (assetId, revision, change) =>
      Effect.suspend(() => {
        if (revision !== null && revision !== activeRevision)
          return Effect.fail(new SourceFailure({ operation: 'inactive-policy', cause: null }));
        const changed = change(assetId === state.asset.id ? structuredClone(state) : null);
        if (changed.state) state = structuredClone(changed.state);
        if (changed.retirement) retirements.push(changed.retirement);
        if (changed.confirmation && !confirmations.some((c) => c.id === changed.confirmation?.id))
          confirmations.push(changed.confirmation);
        if (changed.confirmation && ambiguousCommit) {
          ambiguousCommit = false;
          return Effect.fail(new SourceFailure({ operation: 'lost-commit-response', cause: null }));
        }
        return Effect.succeed(changed.result);
      }),
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(SourceStore, store),
    Layer.succeed(SourceBytes, {
      put: (id, bytes) =>
        Effect.sync(() => {
          stored.set(id, bytes);
        }),
      prepare: (candidateId, sourceId) =>
        prepare().pipe(
          Effect.andThen(
            Effect.sync(() => {
              const bytes = stored.get(candidateId);
              if (!bytes) throw new Error('Missing candidate');
              stored.set(sourceId, bytes);
            })
          )
        ),
      read: (sourceId) =>
        Effect.succeed({
          bytes: (async function* () {
            const bytes = stored.get(sourceId);
            if (!bytes) throw new Error('Missing Source');
            yield bytes;
          })(),
          close: () => Effect.void,
        }),
    }),
    Layer.succeed(MandatoryInspection, { inspect: () => inspect() })
  );
  const runtimes = [
    ManagedRuntime.make(
      sourcesLayer({ revision: 'one', types: { wallpaper: policy } }).pipe(
        Layer.provide(dependencies)
      )
    ),
  ];
  const initialRuntime = runtimes[0];
  if (!initialRuntime) throw new Error('Missing runtime');
  let current = initialRuntime;
  return {
    call: <A, E>(f: (s: SourcesPort) => Effect.Effect<A, E>, signal?: AbortSignal) =>
      current.runPromise(
        clock ? Sources.use(f).pipe(Effect.provideService(Clock.Clock, clock)) : Sources.use(f),
        { signal }
      ),
    get state() {
      return state;
    },
    confirmations,
    retirements,
    setPrepare: (value: typeof prepare) => {
      prepare = value;
    },
    setInspect: (value: typeof inspect) => {
      inspect = value;
    },
    loseCommit: () => {
      ambiguousCommit = true;
    },
    activate: (next: SourcePolicy) => {
      activeRevision = 'two';
      const newer = ManagedRuntime.make(
        sourcesLayer({ revision: 'two', types: { wallpaper: next } }).pipe(
          Layer.provide(dependencies)
        )
      );
      runtimes.push(newer);
      return () => {
        current = newer;
      };
    },
    close: () => Promise.all(runtimes.map((r) => r.dispose())),
  };
}
async function create(f: ReturnType<typeof fixture>, key: string, revision = '0') {
  const result = await f.call((s) =>
    s.create(owner, 'asset_one', {
      ...intent,
      expectedSourceSetRevision: revision,
      idempotencyKey: key,
    })
  );
  if (result.kind !== 'candidate') throw new Error(JSON.stringify(result));
  return result.candidate.candidateId;
}
const upload = (f: ReturnType<typeof fixture>, id: string, bytes = [1, 2, 3, 4]) =>
  f.call((s) =>
    s.upload(
      owner,
      'asset_one',
      id,
      Object.assign(
        (async function* () {
          yield new Uint8Array(bytes);
        })(),
        { cancel: () => {} }
      )
    )
  );

describe('first Source admission decisions', () => {
  it('binds private identity, replay, intent and every protected operation to the exact Owner and Asset', async () => {
    const f = fixture();
    try {
      const id = await create(f, 'same');
      expect(await create(f, 'same')).toBe(id);
      expect(
        await f.call((s) =>
          s.create(owner, 'asset_one', {
            ...intent,
            idempotencyKey: 'same',
            expectedSourceSetRevision: '1',
          })
        )
      ).toEqual({ kind: 'rejected', reason: 'idempotency-conflict' });
      for (const intruder of [
        { namespace: 'other', subject: 'owner' },
        { namespace: 'clerk', subject: 'other' },
      ]) {
        expect(await f.call((s) => s.status(intruder, 'asset_one', id))).toEqual({
          kind: 'unavailable',
        });
        expect(await f.call((s) => s.cancel(intruder, 'asset_one', id))).toEqual({
          kind: 'unavailable',
        });
        expect(await f.call((s) => s.accept(intruder, 'asset_one', id, intent))).toEqual({
          kind: 'unavailable',
        });
        expect(await f.call((s) => s.original(intruder, 'asset_one', 'source_wrong'))).toEqual({
          kind: 'unavailable',
        });
      }
      expect(await f.call((s) => s.status(owner, 'asset_other', id))).toEqual({
        kind: 'unavailable',
      });
      expect(
        await f.call((s) =>
          s.accept(owner, 'asset_one', id, {
            operation: 'replace-set',
            expectedSourceSetRevision: '0',
          })
        )
      ).toEqual({ kind: 'rejected', reason: 'candidate-intent-conflict' });
    } finally {
      await f.close();
    }
  });
  it('bounds simultaneous candidates atomically, frees a cancellation slot and conflicts changed byte replay', async () => {
    const f = fixture();
    try {
      const first = await create(f, 'first');
      await create(f, 'second');
      expect(
        await f.call((s) => s.create(owner, 'asset_one', { ...intent, idempotencyKey: 'third' }))
      ).toEqual({ kind: 'rejected', reason: 'candidate-count-limit' });
      expect(await upload(f, first)).toMatchObject({ candidate: { status: 'ready' } });
      expect(await upload(f, first)).toMatchObject({ candidate: { status: 'ready' } });
      expect(await upload(f, first, [9, 8])).toEqual({
        kind: 'rejected',
        reason: 'byte-digest-conflict',
      });
      expect(await f.call((s) => s.cancel(owner, 'asset_one', first))).toMatchObject({
        candidate: { status: 'cancelled' },
      });
      await create(f, 'third');
      expect(f.state.sources).toEqual([]);
      expect(
        f.state.candidates.every(
          (c) => Date.parse(c.expiresAt) > 0 && Date.parse(c.orphanExpiresAt) > 0
        )
      ).toBe(true);
    } finally {
      await f.close();
    }
  });
  it('cancellation fences late inspection and immutable preparation without withdrawing an accepted Source', async () => {
    const f = fixture();
    try {
      const id = await create(f, 'cancel');
      f.setInspect(() =>
        Effect.promise(async () => {
          await f.call((s) => s.cancel(owner, 'asset_one', id));
          return {
            kind: 'verified' as const,
            facts: {
              width: 100,
              height: 100,
              model: 'sdr-png',
              mimeType: 'image/png',
              byteLength: 4,
              digest: 'ignored',
            },
          };
        })
      );
      expect(await upload(f, id)).toMatchObject({ candidate: { status: 'cancelled' } });
      expect(f.state.sources).toEqual([]);
      const next = await create(f, 'next');
      f.setInspect(() =>
        Effect.succeed({
          kind: 'verified',
          facts: {
            width: 100,
            height: 100,
            model: 'sdr-png',
            mimeType: 'image/png',
            byteLength: 4,
            digest: 'ignored',
          },
        })
      );
      await upload(f, next);
      f.setPrepare(() =>
        Effect.promise(async () => {
          await f.call((s) => s.cancel(owner, 'asset_one', next));
        })
      );
      expect(await f.call((s) => s.accept(owner, 'asset_one', next, intent))).toEqual({
        kind: 'rejected',
        reason: 'candidate-not-ready',
      });
      expect(f.state.sources).toEqual([]);
      expect(f.confirmations).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it('keeps membership unchanged on failed preparation and resolves an ambiguous committed acceptance by replay', async () => {
    const f = fixture();
    try {
      const id = await create(f, 'one');
      await upload(f, id);
      f.setPrepare(() => Effect.fail(new SourceFailure({ operation: 'prepare', cause: null })));
      await expect(f.call((s) => s.accept(owner, 'asset_one', id, intent))).rejects.toBeDefined();
      expect(f.state.sourceSetRevision).toBe('0');
      expect(f.state.sources).toEqual([]);
      f.setPrepare(() => Effect.void);
      f.loseCommit();
      await expect(f.call((s) => s.accept(owner, 'asset_one', id, intent))).rejects.toBeDefined();
      expect(await f.call((s) => s.accept(owner, 'asset_one', id, intent))).toMatchObject({
        candidate: { status: 'accepted', sourceSetRevision: '1' },
      });
      expect(f.confirmations).toHaveLength(1);
      expect(f.state.deliveryRevision).toBe('1');
      expect(await f.call((s) => s.cancel(owner, 'asset_one', id))).toEqual({
        kind: 'rejected',
        reason: 'already-accepted',
      });
    } finally {
      await f.close();
    }
  });
  it('serializes competing first acceptances and retains the losing candidate with its cleanup identity', async () => {
    const f = fixture();
    try {
      const one = await create(f, 'one'),
        two = await create(f, 'two');
      await upload(f, one);
      await upload(f, two);
      const outcomes = await Promise.all(
        [one, two].map((id) => f.call((s) => s.accept(owner, 'asset_one', id, intent)))
      );
      expect(
        outcomes.filter((o) => o.kind === 'candidate' && o.candidate.status === 'accepted')
      ).toHaveLength(1);
      expect(outcomes).toContainEqual({ kind: 'rejected', reason: 'source-set-conflict' });
      expect(f.state.sources).toHaveLength(1);
      expect(f.confirmations).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
  it('fences an old policy worker and rechecks prospective limits while retaining already accepted Sources', async () => {
    const f = fixture();
    try {
      const id = await create(f, 'one');
      await upload(f, id);
      const useNew = f.activate({
        ...initialSourcePolicies.wallpaper,
        admission: { ...initialSourcePolicies.wallpaper.admission, maxBytes: 3 },
      });
      await expect(f.call((s) => s.accept(owner, 'asset_one', id, intent))).rejects.toBeDefined();
      useNew();
      expect(await f.call((s) => s.accept(owner, 'asset_one', id, intent))).toMatchObject({
        candidate: { status: 'rejected', reason: 'encoded-size-limit' },
      });
      expect(f.state.sources).toEqual([]);
    } finally {
      await f.close();
    }
    const retained = fixture();
    try {
      const id = await create(retained, 'accepted');
      await upload(retained, id);
      await retained.call((s) => s.accept(owner, 'asset_one', id, intent));
      retained.activate({
        ...initialSourcePolicies.wallpaper,
        admission: { ...initialSourcePolicies.wallpaper.admission, maxBytes: 1 },
      })();
      expect(await retained.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
        kind: 'found',
        asset: { sourceSetRevision: '1', defaultSourceId: retained.state.sources[0]?.sourceId },
      });
      expect(retained.state.initialAnalysisSourceId).toBe(retained.state.defaultSourceId);
    } finally {
      await retained.close();
    }
  });
  it.each([
    { facts: { width: 20001, height: 1, model: 'sdr-png' }, reason: 'geometry-limit' },
    { facts: { width: 10001, height: 10000, model: 'sdr-png' }, reason: 'geometry-limit' },
    {
      facts: { width: 100, height: 100, model: 'hdr-pq-avif' },
      reason: 'unsupported-source-model',
    },
  ])('rejects mandatory facts outside configured admission: $reason', async ({ facts, reason }) => {
    const f = fixture();
    try {
      f.setInspect(() =>
        Effect.succeed({
          kind: 'verified',
          facts: { ...facts, mimeType: 'image/png', byteLength: 4, digest: 'ignored' },
        })
      );
      expect(await upload(f, await create(f, 'one'))).toMatchObject({
        candidate: { status: 'rejected', reason },
      });
      expect(f.state.sources).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
it('closes a stalled upload when its owning request is interrupted', async () => {
  const f = fixture();
  let closed = false;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let unblock!: (value: IteratorResult<Uint8Array>) => void;
  const stream = {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          started();
          return new Promise<IteratorResult<Uint8Array>>((resolve) => {
            unblock = resolve;
          });
        },
      };
    },
    cancel: () => {
      closed = true;
      unblock({ done: true, value: undefined });
    },
  };
  const controller = new AbortController();
  try {
    const id = await create(f, 'stalled');
    const pending = f.call((s) => s.upload(owner, 'asset_one', id, stream), controller.signal);
    await reading;
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(closed).toBe(true);
    expect(f.state.sources).toEqual([]);
  } finally {
    if (!closed && unblock) unblock({ done: true, value: undefined });
    await f.close();
  }
});
it('includes the configured byte, displayed-axis and pixel boundaries without broadening source models', async () => {
  const f = fixture({
    ...initialSourcePolicies.wallpaper,
    admission: { ...initialSourcePolicies.wallpaper.admission, maxBytes: 4 },
  });
  try {
    f.setInspect(() =>
      Effect.succeed({
        kind: 'verified',
        facts: {
          width: 20000,
          height: 5000,
          byteLength: 4,
          digest: 'ignored',
          model: 'sdr-png',
          mimeType: 'image/png',
        },
      })
    );
    const id = await create(f, 'inclusive');
    expect(await upload(f, id)).toMatchObject({ candidate: { status: 'ready' } });
    expect(await f.call((s) => s.accept(owner, 'asset_one', id, intent))).toMatchObject({
      candidate: { status: 'accepted' },
    });
  } finally {
    await f.close();
  }
  const tooLarge = fixture({
    ...initialSourcePolicies.wallpaper,
    admission: { ...initialSourcePolicies.wallpaper.admission, maxBytes: 4 },
  });
  try {
    expect(await upload(tooLarge, await create(tooLarge, 'oversize'), [1, 2, 3, 4, 5])).toEqual({
      kind: 'rejected',
      reason: 'encoded-size-limit',
    });
    expect(tooLarge.state.sources).toEqual([]);
  } finally {
    await tooLarge.close();
  }
});
it('rechecks the activated operation policy atomically for a retained ready candidate', async () => {
  const f = fixture();
  try {
    const id = await create(f, 'revoked-add');
    await upload(f, id);
    f.activate({ ...initialSourcePolicies.wallpaper, operations: ['replace-one'] })();
    expect(await f.call((s) => s.accept(owner, 'asset_one', id, intent))).toEqual({
      kind: 'rejected',
      reason: 'unsupported-operation',
    });
    expect(f.state.sources).toEqual([]);
    expect(f.state.sourceSetRevision).toBe('0');
    expect(f.confirmations).toEqual([]);
  } finally {
    await f.close();
  }
});

it('adds independent Sources after first acceptance while preserving the Default and initial analysis identity', async () => {
  const f = fixture();
  try {
    const first = await create(f, 'first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    const original = await f.call((s) => s.list(owner, 'asset_one'));
    const second = await create(f, 'second', '1');
    await upload(f, second, [5, 6]);
    expect(
      await f.call((s) =>
        s.accept(owner, 'asset_one', second, { ...intent, expectedSourceSetRevision: '1' })
      )
    ).toMatchObject({ candidate: { status: 'accepted', sourceSetRevision: '2' } });
    const current = await f.call((s) => s.list(owner, 'asset_one'));
    if (original.kind !== 'found' || current.kind !== 'found') throw new Error('Expected Sources');
    expect(current.asset).toMatchObject({
      assetId: 'asset_one',
      sourceSetRevision: '2',
      deliveryRevision: '2',
      defaultSourceId: original.asset.defaultSourceId,
    });
    expect(current.asset.sources).toHaveLength(2);
    expect(current.asset.sources[0]).toEqual(original.asset.sources[0]);
    expect(f.confirmations).toHaveLength(2);
    expect(f.confirmations[1]?.initialAnalysisSourceId).toBe(original.asset.defaultSourceId);
  } finally {
    await f.close();
  }
});

it.each([
  { first: [100, 100], next: [103, 100], accepted: true },
  { first: [103, 100], next: [100, 100], accepted: true },
  { first: [100, 100], next: [1031, 1000], accepted: false },
  { first: [1031, 1000], next: [100, 100], accepted: false },
])('checks inclusive extreme ratio after orientation: $first then $next', async ({
  first,
  next,
  accepted,
}) => {
  const f = fixture();
  const admit = async (key: string, dimensions: number[], revision: string) => {
    const [width, height] = dimensions;
    if (!width || !height) throw new Error('Missing dimensions');
    f.setInspect(() =>
      Effect.succeed({
        kind: 'verified',
        facts: {
          width,
          height,
          orientation: 6,
          model: 'sdr-png',
          mimeType: 'image/png',
          byteLength: 4,
          digest: 'ignored',
        },
      })
    );
    const id = await create(f, key, revision);
    await upload(f, id);
    return f.call((s) =>
      s.accept(owner, 'asset_one', id, { ...intent, expectedSourceSetRevision: revision })
    );
  };
  try {
    await admit('first', first, '0');
    expect(await admit('next', next, '1')).toMatchObject({
      candidate: accepted
        ? { status: 'accepted' }
        : { status: 'rejected', reason: 'aspect-ratio-limit' },
    });
    expect(await f.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
      asset: { sourceSetRevision: accepted ? '2' : '1' },
    });
  } finally {
    await f.close();
  }
});
it('compares the full active set rather than chaining pairwise similar Sources', async () => {
  const f = fixture();
  const admit = async (key: string, width: number, revision: string) => {
    f.setInspect(() =>
      Effect.succeed({
        kind: 'verified',
        facts: {
          width,
          height: 1000,
          model: 'sdr-png',
          mimeType: 'image/png',
          byteLength: 4,
          digest: 'ignored',
        },
      })
    );
    const id = await create(f, key, revision);
    await upload(f, id);
    return f.call((s) =>
      s.accept(owner, 'asset_one', id, { ...intent, expectedSourceSetRevision: revision })
    );
  };
  try {
    await admit('first', 1000, '0');
    await admit('middle', 1020, '1');
    expect(await admit('extreme', 1040, '2')).toMatchObject({
      candidate: { status: 'rejected', reason: 'aspect-ratio-limit' },
    });
    expect(await f.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
      asset: {
        sourceSetRevision: '2',
        sources: expect.arrayContaining([
          expect.objectContaining({ facts: expect.objectContaining({ width: 1000 }) }),
          expect.objectContaining({ facts: expect.objectContaining({ width: 1020 }) }),
        ]),
      },
    });
  } finally {
    await f.close();
  }
});

it('bounds concurrent preparation and acceptance and refuses preparation at the active Source limit', async () => {
  const f = fixture({ ...initialSourcePolicies.wallpaper, maxActiveSources: 2 });
  try {
    const prepared = await Promise.all(
      ['one', 'two', 'three'].map((key) =>
        f.call((s) => s.create(owner, 'asset_one', { ...intent, idempotencyKey: key }))
      )
    );
    expect(prepared.filter((o) => o.kind === 'candidate')).toHaveLength(2);
    expect(prepared).toContainEqual({ kind: 'rejected', reason: 'candidate-count-limit' });
    const ids = prepared.flatMap((o) => (o.kind === 'candidate' ? [o.candidate.candidateId] : []));
    for (const id of ids) await upload(f, id);
    const outcomes = await Promise.all(
      ids.map((id) => f.call((s) => s.accept(owner, 'asset_one', id, intent)))
    );
    expect(
      outcomes.filter((o) => o.kind === 'candidate' && o.candidate.status === 'accepted')
    ).toHaveLength(1);
    expect(outcomes).toContainEqual({ kind: 'rejected', reason: 'source-set-conflict' });
    const stale = ids.find((_, i) => outcomes[i]?.kind === 'rejected');
    if (!stale) throw new Error('Expected stale candidate');
    await f.call((s) => s.cancel(owner, 'asset_one', stale));
    const next = await create(f, 'next', '1');
    await upload(f, next);
    await f.call((s) =>
      s.accept(owner, 'asset_one', next, { ...intent, expectedSourceSetRevision: '1' })
    );
    expect(
      await f.call((s) =>
        s.create(owner, 'asset_one', {
          ...intent,
          expectedSourceSetRevision: '2',
          idempotencyKey: 'full',
        })
      )
    ).toEqual({ kind: 'rejected', reason: 'source-count-limit' });
    expect(await f.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
      asset: { sourceSetRevision: '2' },
    });
  } finally {
    await f.close();
  }
});
it.each([
  'count',
  'ratio',
])('rechecks effective %s policy at acceptance without withdrawing existing Sources', async (limit) => {
  const f = fixture();
  try {
    const first = await create(f, 'first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    f.setInspect(() =>
      Effect.succeed({
        kind: 'verified',
        facts: {
          width: 102,
          height: 100,
          model: 'sdr-png',
          mimeType: 'image/png',
          byteLength: 4,
          digest: 'ignored',
        },
      })
    );
    const next = await create(f, 'next', '1');
    await upload(f, next);
    const policy = {
      ...initialSourcePolicies.wallpaper,
      ...(limit === 'count' ? { maxActiveSources: 1 } : { aspectRatioTolerance: 0.01 }),
    };
    const useNew = f.activate(policy);
    await expect(
      f.call((s) =>
        s.accept(owner, 'asset_one', next, { ...intent, expectedSourceSetRevision: '1' })
      )
    ).rejects.toBeDefined();
    useNew();
    expect(
      await f.call((s) =>
        s.accept(owner, 'asset_one', next, { ...intent, expectedSourceSetRevision: '1' })
      )
    ).toMatchObject(
      limit === 'count'
        ? { kind: 'rejected', reason: 'source-count-limit' }
        : { candidate: { status: 'rejected', reason: 'aspect-ratio-limit' } }
    );
    expect(await f.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
      asset: {
        sourceSetRevision: '1',
        sources: [expect.objectContaining({ facts: expect.objectContaining({ width: 100 }) })],
      },
    });
  } finally {
    await f.close();
  }
});
it('recovers stopped additional inspection by same-digest replay while fencing changed bytes and preserving accepted Sources', async () => {
  const f = fixture();
  try {
    const first = await create(f, 'accepted-first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    const original = await f.call((s) => s.list(owner, 'asset_one'));
    expect(original).toMatchObject({ asset: { hasPendingCandidates: false } });
    const next = await create(f, 'stopped-inspection', '1');
    f.setInspect(() =>
      Effect.fail(new SourceFailure({ operation: 'inspect', cause: 'owned inspection stopped' }))
    );
    await expect(upload(f, next)).rejects.toBeDefined();
    expect(await f.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
      asset: { hasPendingCandidates: true },
    });
    expect(await f.call((s) => s.status(owner, 'asset_one', next))).toMatchObject({
      candidate: { status: 'inspecting' },
    });
    expect(await upload(f, next, [9, 8, 7])).toEqual({
      kind: 'rejected',
      reason: 'byte-digest-conflict',
    });
    const unchanged = await f.call((s) => s.list(owner, 'asset_one'));
    if (original.kind !== 'found' || unchanged.kind !== 'found')
      throw new Error('Expected Sources');
    expect(unchanged.asset.sources).toEqual(original.asset.sources);
    expect(unchanged.asset.sourceSetRevision).toBe('1');
    f.setInspect(() =>
      Effect.succeed({
        kind: 'verified',
        facts: {
          width: 100,
          height: 100,
          model: 'sdr-png',
          mimeType: 'image/png',
          byteLength: 4,
          digest: 'ignored',
        },
      })
    );
    expect(await upload(f, next)).toMatchObject({ candidate: { status: 'ready' } });
    expect(
      await f.call((s) =>
        s.accept(owner, 'asset_one', next, { ...intent, expectedSourceSetRevision: '1' })
      )
    ).toMatchObject({ candidate: { status: 'accepted', sourceSetRevision: '2' } });
    const recovered = await f.call((s) => s.list(owner, 'asset_one'));
    if (recovered.kind !== 'found') throw new Error('Expected Sources');
    expect(recovered.asset.sources[0]).toEqual(original.asset.sources[0]);
    expect(recovered.asset.sources).toHaveLength(2);
    expect(recovered.asset.hasPendingCandidates).toBe(false);
  } finally {
    await f.close();
  }
});
it('bounds each discovery page while preserving continuation, exact old status and pending initial-work detection', async () => {
  const f = fixture();
  try {
    const pending = await create(f, 'pending');
    const history: string[] = [];
    for (let n = 0; n < 70; n++) {
      const id = await create(f, `cancelled-${n}`);
      history.push(id);
      await f.call((s) => s.cancel(owner, 'asset_one', id));
    }
    const discovered: string[] = [];
    let cursor: string | undefined;
    let appended: string | undefined;
    do {
      const page = await f.call((s) => s.list(owner, 'asset_one', cursor));
      if (page.kind !== 'found') throw new Error('Expected owner discovery');
      expect(page.asset.candidates.length).toBeLessThanOrEqual(32);
      expect(page.asset.hasPendingCandidates).toBe(true);
      discovered.push(...page.asset.candidates.map((c) => c.candidateId));
      cursor = page.asset.nextCandidateCursor;
      if (!appended) {
        const added = await create(f, 'appended-after-first-page');
        appended = added;
        await f.call((s) => s.cancel(owner, 'asset_one', added));
      }
    } while (cursor);
    expect(discovered).toEqual([...history].reverse().concat(pending));
    expect(new Set(discovered).size).toBe(71);
    expect(await f.call((s) => s.status(owner, 'asset_one', pending))).toMatchObject({
      candidate: { candidateId: pending, status: 'awaiting-bytes' },
    });
    expect(
      await f.call((s) => s.list({ ...owner, subject: 'other' }, 'asset_one', history[0]))
    ).toEqual({ kind: 'unavailable' });
    expect(await f.call((s) => s.list(owner, 'asset_one', 'missing-candidate'))).toEqual({
      kind: 'unavailable',
    });
    const latest = await f.call((s) => s.list(owner, 'asset_one'));
    expect(latest).toMatchObject({
      asset: {
        candidates: [
          expect.objectContaining({ candidateId: appended }),
          ...Array.from({ length: 31 }, () => expect.anything()),
        ],
        hasPendingCandidates: true,
      },
    });
    expect(await f.call((s) => s.list(owner, 'asset_one', '0:wrong-identity'))).toEqual({
      kind: 'unavailable',
    });
    const terminal = history[0];
    if (!terminal) throw new Error('Missing retained history');
    await f.call((s) => s.cancel(owner, 'asset_one', terminal));
    expect(await f.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
      asset: { hasPendingCandidates: true },
    });
    await f.call((s) => s.cancel(owner, 'asset_one', pending));
    expect(await f.call((s) => s.list(owner, 'asset_one'))).toMatchObject({
      asset: { hasPendingCandidates: false },
    });
  } finally {
    await f.close();
  }
});

it('replaces the Default at the count limit only after preparation while retaining first analysis provenance', async () => {
  const clockRuntime = ManagedRuntime.make(TestClock.layer());
  await clockRuntime.runPromise(TestClock.setTime(Date.parse('2026-10-23T00:00:00.000Z')));
  const clock = await clockRuntime.runPromise(Clock.clockWith(Effect.succeed));
  const f = fixture({ ...initialSourcePolicies.wallpaper, maxActiveSources: 1 }, clock);
  try {
    const first = await create(f, 'first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    const previous = f.state.sources[0];
    if (!previous) throw new Error('Expected first Source');
    const replacement = {
      operation: 'replace-one' as const,
      expectedSourceSetRevision: '1',
      targetSourceId: previous.sourceId,
    };
    const proposed = await f.call((s) =>
      s.create(owner, 'asset_one', { ...replacement, idempotencyKey: 'replace-first' })
    );
    expect(proposed).toMatchObject({ candidate: { status: 'awaiting-bytes' } });
    if (proposed.kind !== 'candidate') throw new Error('Expected replacement candidate');
    const id = proposed.candidate.candidateId;
    await upload(f, id, [9, 8, 7]);
    f.setPrepare(() =>
      Effect.fail(new SourceFailure({ operation: 'interrupted-write', cause: null }))
    );
    await expect(
      f.call((s) => s.accept(owner, 'asset_one', id, replacement))
    ).rejects.toBeDefined();
    expect(await f.call((s) => s.original(owner, 'asset_one', previous.sourceId))).toMatchObject({
      kind: 'original',
      facts: previous.facts,
    });
    expect(f.state.sources).toEqual([previous]);
    expect(f.state.sourceSetRevision).toBe('1');
    f.setPrepare(() => Effect.void);
    expect(await f.call((s) => s.accept(owner, 'asset_one', id, replacement))).toMatchObject({
      candidate: { status: 'accepted', sourceSetRevision: '2' },
    });
    const winner = f.state.sources[0];
    expect(winner?.sourceId).not.toBe(previous.sourceId);
    expect(f.state.sources).toHaveLength(1);
    expect(f.state.defaultSourceId).toBe(winner?.sourceId);
    expect(f.state.initialAnalysisSourceId).toBe(previous.sourceId);
    expect(await f.call((s) => s.original(owner, 'asset_one', previous.sourceId))).toEqual({
      kind: 'unavailable',
    });
    expect(f.confirmations[1]).toMatchObject({
      assetId: 'asset_one',
      defaultSourceId: winner?.sourceId,
      initialAnalysisSourceId: previous.sourceId,
      sourceSetRevision: '2',
      deliveryRevision: '2',
    });
    expect(await f.call((s) => s.accept(owner, 'asset_one', id, replacement))).toMatchObject({
      candidate: { status: 'accepted' },
    });
    expect(f.confirmations).toHaveLength(2);
    const deadline = '2026-10-30T00:00:00.000Z';
    expect(f.retirements).toEqual([{ sourceId: previous.sourceId, evidenceExpiresAt: deadline }]);
    await clockRuntime.runPromise(TestClock.setTime(Date.parse('2026-11-06T00:00:00.000Z')));
    f.activate({
      ...initialSourcePolicies.wallpaper,
      retention: { evidenceMs: 1, candidateMs: 86400000 },
    })();
    expect(await f.call((s) => s.accept(owner, 'asset_one', id, replacement))).toMatchObject({
      candidate: { status: 'accepted', sourceSetRevision: '2' },
    });
    expect(f.retirements).toEqual([{ sourceId: previous.sourceId, evidenceExpiresAt: deadline }]);
  } finally {
    await f.close();
    await clockRuntime.dispose();
  }
});

it.each([
  { width: 1030, accepted: true },
  { width: 1031, accepted: false },
])('includes the replaced Source in the full oriented inclusive ratio check: $width', async ({
  width,
  accepted,
}) => {
  const f = fixture();
  try {
    const first = await create(f, 'ratio-first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    const predecessor = f.state.sources[0];
    if (!predecessor) throw new Error('Expected Source');
    const replacement = {
      operation: 'replace-one' as const,
      expectedSourceSetRevision: '1',
      targetSourceId: predecessor.sourceId,
    };
    const candidate = await f.call((s) =>
      s.create(owner, 'asset_one', { ...replacement, idempotencyKey: 'ratio-replace' })
    );
    if (candidate.kind !== 'candidate') throw new Error('Expected candidate');
    f.setInspect(() =>
      Effect.succeed({
        kind: 'verified',
        facts: {
          width,
          height: 1000,
          orientation: 6,
          model: 'sdr-png',
          mimeType: 'image/png',
          byteLength: 4,
          digest: 'ignored',
        },
      })
    );
    await upload(f, candidate.candidate.candidateId);
    expect(
      await f.call((s) =>
        s.accept(owner, 'asset_one', candidate.candidate.candidateId, replacement)
      )
    ).toMatchObject({
      candidate: accepted
        ? { status: 'accepted' }
        : { status: 'rejected', reason: 'aspect-ratio-limit' },
    });
    expect(f.state.sourceSetRevision).toBe(accepted ? '2' : '1');
    expect(f.retirements).toHaveLength(accepted ? 1 : 0);
  } finally {
    await f.close();
  }
});

it('replaces a non-default independently and fences concurrent replacement, retargeting and late replay', async () => {
  const f = fixture();
  try {
    const first = await create(f, 'first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    const second = await create(f, 'second', '1');
    await upload(f, second);
    await f.call((s) =>
      s.accept(owner, 'asset_one', second, { ...intent, expectedSourceSetRevision: '1' })
    );
    const predecessor = f.state.sources[1];
    if (!predecessor) throw new Error('Expected second Source');
    const replacement = {
      operation: 'replace-one' as const,
      targetSourceId: predecessor.sourceId,
      expectedSourceSetRevision: '2',
    };
    const ids: string[] = [];
    for (const key of ['replace-a', 'replace-b']) {
      const outcome = await f.call((s) =>
        s.create(owner, 'asset_one', { ...replacement, idempotencyKey: key })
      );
      if (outcome.kind !== 'candidate') throw new Error('Expected candidate');
      ids.push(outcome.candidate.candidateId);
      await upload(f, outcome.candidate.candidateId);
    }
    const one = ids[0];
    if (!one) throw new Error('Expected candidate');
    expect(
      await f.call((s) =>
        s.accept(owner, 'asset_one', one, {
          ...replacement,
          targetSourceId: f.state.defaultSourceId ?? '',
        })
      )
    ).toEqual({ kind: 'rejected', reason: 'candidate-intent-conflict' });
    const results = await Promise.all(
      ids.map((id) => f.call((s) => s.accept(owner, 'asset_one', id, replacement)))
    );
    expect(
      results.filter((r) => r.kind === 'candidate' && r.candidate.status === 'accepted')
    ).toHaveLength(1);
    expect(results).toContainEqual({ kind: 'rejected', reason: 'source-set-conflict' });
    const saved = structuredClone(f.state.sources);
    for (const id of ids) await f.call((s) => s.accept(owner, 'asset_one', id, replacement));
    expect(f.state.sources).toEqual(saved);
    expect(f.state.sources).toHaveLength(2);
    expect(f.state.defaultSourceId).toBe(f.state.initialAnalysisSourceId);
    expect(f.retirements).toHaveLength(1);
    expect(f.retirements[0]?.sourceId).toBe(predecessor.sourceId);
    expect(
      await f.call((s) =>
        s.create(owner, 'asset_one', {
          ...replacement,
          expectedSourceSetRevision: '3',
          idempotencyKey: 'retired-target',
        })
      )
    ).toEqual({ kind: 'rejected', reason: 'unavailable-source' });
    expect(
      await f.call((s) =>
        s.create({ ...owner, namespace: 'other' }, 'asset_one', {
          ...replacement,
          idempotencyKey: 'other-owner',
        })
      )
    ).toEqual({ kind: 'unavailable' });
  } finally {
    await f.close();
  }
});

it.each([
  'ratio',
  'count',
  'operation',
  'model',
])('rechecks activated %s policy for replacement without retiring its predecessor', async (limit) => {
  const f = fixture();
  try {
    const first = await create(f, 'first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    const predecessor = f.state.sources[0];
    if (!predecessor) throw new Error('Expected Source');
    const replacement = {
      operation: 'replace-one' as const,
      expectedSourceSetRevision: '1',
      targetSourceId: predecessor.sourceId,
    };
    const proposed = await f.call((s) =>
      s.create(owner, 'asset_one', { ...replacement, idempotencyKey: 'replace' })
    );
    if (proposed.kind !== 'candidate') throw new Error('Expected candidate');
    f.setInspect(() =>
      Effect.succeed({
        kind: 'verified',
        facts: {
          width: 102,
          height: 100,
          model: 'sdr-png',
          mimeType: 'image/png',
          byteLength: 4,
          digest: 'ignored',
        },
      })
    );
    await upload(f, proposed.candidate.candidateId);
    const useNew = f.activate({
      ...initialSourcePolicies.wallpaper,
      ...(limit === 'ratio' ? { aspectRatioTolerance: 0.01 } : {}),
      ...(limit === 'count' ? { maxActiveSources: 1 } : {}),
      ...(limit === 'operation' ? { operations: ['add'] } : {}),
      ...(limit === 'model'
        ? {
            admission: { ...initialSourcePolicies.wallpaper.admission, sourceModels: ['sdr-jpeg'] },
          }
        : {}),
    });
    await expect(
      f.call((s) => s.accept(owner, 'asset_one', proposed.candidate.candidateId, replacement))
    ).rejects.toBeDefined();
    useNew();
    const outcome = await f.call((s) =>
      s.accept(owner, 'asset_one', proposed.candidate.candidateId, replacement)
    );
    // One-for-one replacement still fits a newly lowered count of one.
    expect(outcome).toMatchObject(
      limit === 'count'
        ? { candidate: { status: 'accepted' } }
        : limit === 'operation'
          ? { kind: 'rejected', reason: 'unsupported-operation' }
          : {
              candidate: {
                status: 'rejected',
                reason: limit === 'ratio' ? 'aspect-ratio-limit' : 'unsupported-source-model',
              },
            }
    );
    expect(f.retirements).toHaveLength(limit === 'count' ? 1 : 0);
    if (limit !== 'count') expect(f.state.sources).toEqual([predecessor]);
  } finally {
    await f.close();
  }
});

it('fences late cancelled replacement inspection after a new candidate has won', async () => {
  const f = fixture();
  let entered!: () => void, finish!: () => void;
  const inspecting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let pending: Promise<unknown> | undefined;
  try {
    const first = await create(f, 'first');
    await upload(f, first);
    await f.call((s) => s.accept(owner, 'asset_one', first, intent));
    const previous = f.state.sources[0];
    if (!previous) throw new Error('Expected predecessor');
    const replacement = {
      operation: 'replace-one' as const,
      targetSourceId: previous.sourceId,
      expectedSourceSetRevision: '1',
    };
    const proposed = await f.call((s) =>
      s.create(owner, 'asset_one', { ...replacement, idempotencyKey: 'late' })
    );
    if (proposed.kind !== 'candidate') throw new Error('Expected candidate');
    const facts = previous.facts;
    f.setInspect(() =>
      Effect.promise(async () => {
        entered();
        await release;
        return { kind: 'verified' as const, facts };
      })
    );
    pending = upload(f, proposed.candidate.candidateId);
    await inspecting;
    await f.call((s) => s.cancel(owner, 'asset_one', proposed.candidate.candidateId));
    f.setInspect(() => Effect.succeed({ kind: 'verified', facts }));
    const winning = await f.call((s) =>
      s.create(owner, 'asset_one', { ...replacement, idempotencyKey: 'winner' })
    );
    if (winning.kind !== 'candidate') throw new Error('Expected candidate');
    await upload(f, winning.candidate.candidateId);
    await f.call((s) => s.accept(owner, 'asset_one', winning.candidate.candidateId, replacement));
    const saved = structuredClone(f.state);
    finish();
    await pending;
    expect(
      await f.call((s) => s.accept(owner, 'asset_one', proposed.candidate.candidateId, replacement))
    ).toEqual({ kind: 'rejected', reason: 'candidate-not-ready' });
    expect(f.state).toEqual(saved);
    expect(f.state.defaultSourceId).toBe(winning.candidate.sourceId);
    expect(f.retirements).toHaveLength(1);
    expect(f.confirmations).toHaveLength(2);
  } finally {
    finish();
    await pending;
    await f.close();
  }
});

describe('Owner Default selection and Source withdrawal', () => {
  it('changes Default before withdrawing its predecessor while preserving first analysis and fixed private evidence', async () => {
    const clockRuntime = ManagedRuntime.make(TestClock.layer());
    const clock = await clockRuntime.runPromise(Clock.Clock);
    await clockRuntime.runPromise(TestClock.setTime(Date.parse('2026-10-23T00:00:00Z')));
    const f = fixture(initialSourcePolicies.wallpaper, clock);
    try {
      const first = await create(f, 'first');
      await upload(f, first);
      await f.call((s) => s.accept(owner, 'asset_one', first, intent));
      const a = f.state.defaultSourceId;
      if (!a) throw new Error('Expected first Default');
      const second = await create(f, 'second', '1');
      await upload(f, second, [4, 3, 2, 1]);
      await f.call((s) =>
        s.accept(owner, 'asset_one', second, { ...intent, expectedSourceSetRevision: '1' })
      );
      const b = f.state.sources.find((s) => s.sourceId !== a)?.sourceId;
      if (!b) throw new Error('Expected second Source');
      expect(await f.call((s) => s.withdraw(owner, 'asset_one', a, '2'))).toEqual({
        kind: 'rejected',
        reason: 'default-source-withdrawal',
      });
      expect(await f.call((s) => s.selectDefault(owner, 'asset_one', b, '2'))).toEqual({
        kind: 'changed',
        sourceSetRevision: '3',
        deliveryRevision: '3',
        defaultSourceId: b,
      });
      expect(await f.call((s) => s.withdraw(owner, 'asset_one', a, '3'))).toEqual({
        kind: 'changed',
        sourceSetRevision: '4',
        deliveryRevision: '4',
        defaultSourceId: b,
      });
      expect(f.state.sources.map((s) => s.sourceId)).toEqual([b]);
      expect(f.state.initialAnalysisSourceId).toBe(a);
      expect(f.confirmations).toHaveLength(2);
      expect(f.retirements).toEqual([
        { sourceId: a, evidenceExpiresAt: '2026-10-30T00:00:00.000Z' },
      ]);
      expect(await f.call((s) => s.original(owner, 'asset_one', a))).toEqual({
        kind: 'unavailable',
      });
      expect(await f.call((s) => s.original(owner, 'asset_one', b))).toMatchObject({
        kind: 'original',
      });
      expect(await f.call((s) => s.withdraw(owner, 'asset_one', b, '4'))).toEqual({
        kind: 'rejected',
        reason: 'last-source-withdrawal',
      });
      await clockRuntime.runPromise(TestClock.setTime(Date.parse('2026-11-06T00:00:00Z')));
      expect(await f.call((s) => s.withdraw(owner, 'asset_one', a, '4'))).toEqual({
        kind: 'rejected',
        reason: 'unavailable-source',
      });
      expect(f.retirements).toHaveLength(1);
      expect(f.state.sourceSetRevision).toBe('4');
    } finally {
      await f.close();
      await clockRuntime.dispose();
    }
  });
});
