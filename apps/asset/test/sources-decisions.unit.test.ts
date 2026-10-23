import { Effect, Layer, ManagedRuntime } from 'effect';
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
function fixture(policy: SourcePolicy = initialSourcePolicies.wallpaper) {
  let state: SourceState = {
    asset: { id: 'asset_one', applicationId: 'wallpaper', assetType: 'wallpaper', owner },
    sourceSetRevision: '0',
    deliveryRevision: '0',
    sources: [],
    candidates: [],
    defaultSourceId: null,
    initialAnalysisSourceId: null,
  };
  let activeRevision = 'one';
  const confirmations: SourceConfirmation[] = [];
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
      current.runPromise(Sources.use(f), { signal }),
    get state() {
      return state;
    },
    confirmations,
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
