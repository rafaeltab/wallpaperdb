import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Creation,
  WorkflowStore,
  creationLayer,
  type Wallpaper,
  type Publication,
} from '../src/capabilities/creation/index.js';

const owner = { namespace: 'authors', subject: 'creator-1' };
function setup() {
  const records = new Map<string, Wallpaper>();
  const events: Publication[] = [];
  const layer = Layer.succeed(WorkflowStore, {
    begin: (principal, key) =>
      Effect.sync(() => {
        const old = [...records.values()].find(
          (w) =>
            w.owner.namespace === principal.namespace &&
            w.owner.subject === principal.subject &&
            w.key === key
        );
        if (old) return old;
        const wallpaper: Wallpaper = {
          id: `wallpaper-${records.size}`,
          owner: principal,
          key,
          commandId: `command-${records.size}`,
          creationEventId: `event-${records.size}`,
          state: 'creating-asset',
          assetId: null,
          intent: null,
          sourceId: null,
          initialAnalysisSourceId: null,
          createdAt: '2026-10-22T00:00:00.000Z',
        };
        records.set(wallpaper.id, wallpaper);
        return wallpaper;
      }),
    change: (selector, transition) =>
      Effect.sync(() => {
        const current =
          selector.kind === 'wallpaper'
            ? records.get(selector.id)
            : [...records.values()].find((w) => w.assetId === selector.id);
        const changed = transition(current ? structuredClone(current) : null);
        if (changed.wallpaper) records.set(changed.wallpaper.id, changed.wallpaper);
        if (changed.publication) events.push(changed.publication);
        return changed.result;
      }),
  });
  const runtime = ManagedRuntime.make(creationLayer('authors').pipe(Layer.provide(layer)));
  const run = <A, E>(f: (service: Creation['Service']) => Effect.Effect<A, E>) =>
    runtime.runPromise(Creation.use(f));
  return { run, events, close: () => runtime.dispose() };
}

it('keeps Wallpaper identity separate from its confirmed Asset and publishes its first Source once', async () => {
  const s = setup();
  try {
    const started = await s.run((c) => c.begin(owner, 'request-1'));
    expect(started.kind).toBe('wallpaper');
    if (started.kind !== 'wallpaper') throw new Error('Expected Wallpaper');
    const w = started.wallpaper;
    expect(w.state).toBe('creating-asset');
    expect(await s.run((c) => c.begin(owner, 'request-1'))).toEqual(started);
    expect(
      await s.run((c) =>
        c.assetResult({
          wallpaperId: w.id,
          commandId: w.commandId,
          creationEventId: w.creationEventId,
          outcome: 'created',
          assetId: 'asset-1',
        })
      )
    ).toBe('applied');
    expect(
      await s.run((c) =>
        c.expectSource(owner, w.id, { candidateId: 'candidate-1', intentId: 'intent-1' })
      )
    ).toMatchObject({
      kind: 'wallpaper',
      wallpaper: { state: 'accepting-source', assetId: 'asset-1' },
    });
    const confirmation = {
      assetId: 'asset-1',
      candidateId: 'candidate-1',
      sourceId: 'source-1',
      defaultSourceId: 'source-1',
      initialAnalysisSourceId: 'source-1',
      intentId: 'intent-1',
      occurrenceId: 'acceptance-1',
    };
    expect(await s.run((c) => c.sourceAccepted(confirmation))).toBe('applied');
    expect(await s.run((c) => c.sourceAccepted(confirmation))).toBe('ignored');
    expect(s.events).toEqual([
      {
        id: `published:${w.id}`,
        wallpaperId: w.id,
        assetId: 'asset-1',
        sourceId: 'source-1',
        initialAnalysisSourceId: 'source-1',
        contributorId: 'creator-1',
        causationId: 'acceptance-1',
      },
    ]);
    expect(await s.run((c) => c.get({ ...owner, subject: 'other' }, w.id))).toEqual({
      kind: 'unavailable',
    });
  } finally {
    await s.close();
  }
});
