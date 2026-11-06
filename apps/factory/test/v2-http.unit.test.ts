import { expect, it } from 'vitest';
import {
  fakeV2Server,
  type Action,
  type FactoryV2Changes,
  type FactoryV2Command,
  type FactoryV2CommandReceipt,
  type FactoryV2Snapshot,
} from '../src/http/index.js';

type Server = ReturnType<typeof fakeV2Server>;
const commandId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function contract(check: (app: Server) => Promise<void>, historyLimit = 64) {
  const app = fakeV2Server({ epoch: 'test', historyLimit });
  try {
    await check(app);
  } finally {
    await app.close();
  }
}
const board = async (app: Server) => (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
function available(snapshot: FactoryV2Snapshot, kind: Action['kind']) {
  const action = Object.values(snapshot.entities.actions).find(
    (entry) => entry.kind === kind && entry.availability.state === 'available'
  );
  if (action?.availability.state !== 'available') throw new Error(`Missing ${kind}`);
  return { actionId: action.id, precondition: action.availability.precondition };
}
function configure(
  snapshot: FactoryV2Snapshot,
  n: number,
  paused = true
): Extract<FactoryV2Command, { kind: 'configure' }> {
  return {
    commandId: commandId(n),
    ...available(snapshot, 'configure'),
    kind: 'configure',
    payload: {
      paused,
      concurrency: snapshot.meta.factory.concurrency.limit,
      admissionAllowance: snapshot.meta.factory.admission.limit,
    },
  };
}
const submit = (app: Server, payload: FactoryV2Command) =>
  app.inject({ method: 'POST', url: '/api/v2/commands', payload });
const changes = (app: Server, cursor: string) =>
  app.inject(`/api/v2/board/changes?after=${encodeURIComponent(cursor)}`);

it('serves a stable, explicitly fake board with UI metadata and independent v1 isolation', () =>
  contract(async (app) => {
    const first = await app.inject('/api/v2/board');
    const snapshot = first.json<FactoryV2Snapshot>();
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-factory-data']).toBe('fake');
    expect(snapshot.meta.dataMode).toBe('fake');
    expect(snapshot.meta.transport).toMatchObject({ changes: true, events: true });
    expect((await app.inject('/api/v2/board')).body).toBe(first.body);
    expect(
      Object.values(snapshot.entities.labels).every((label) => /^[a-f\d]{6}$/i.test(label.color))
    ).toBe(true);
    expect(
      Object.values(snapshot.entities.items).some((item) => item.attention.state === 'required')
    ).toBe(true);
    expect(
      Object.values(snapshot.entities.pullRequests).some(
        (pr) => pr.metadata.state === 'known' && pr.metadata.value.draft
      )
    ).toBe(true);
    expect((await app.inject('/health')).json()).toMatchObject({ status: 'ok', dataMode: 'fake' });
    expect((await app.inject('/api/job')).statusCode).toBe(404);
  }));

it('implements conditional snapshots, including weak validators and lists', () =>
  contract(async (app) => {
    const first = await app.inject('/api/v2/board');
    const etag = first.headers.etag;
    for (const value of [String(etag), `W/${etag}`, `"older", ${etag}`, '*']) {
      const response = await app.inject({
        url: '/api/v2/board',
        headers: { 'if-none-match': value },
      });
      expect(response.statusCode).toBe(304);
      expect(response.body).toBe('');
      expect(response.headers.etag).toBe(etag);
    }
    expect(
      (await app.inject({ url: '/api/v2/board', headers: { 'if-none-match': '"other"' } }))
        .statusCode
    ).toBe(200);
  }));

it('publishes coherent changes, then returns unchanged for the resulting cursor', () =>
  contract(async (app) => {
    const initial = await board(app);
    expect((await changes(app, initial.cursor)).json()).toEqual({
      kind: 'unchanged',
      cursor: initial.cursor,
    });
    const accepted = await submit(app, configure(initial, 1));
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers.location).toBe(`/api/v2/commands/${commandId(1)}`);
    const response = (await changes(app, initial.cursor)).json<FactoryV2Changes>();
    expect(response.kind).toBe('changes');
    if (response.kind !== 'changes') throw new Error('Expected changes');
    expect(response.batches[0].fromCursor).toBe(initial.cursor);
    expect(response.batches.at(-1)?.toCursor).toBe(response.nextCursor);
    expect(response.batches.at(-1)?.meta?.factory.paused).toBe(true);
    expect(response.hasMore).toBe(false);
    expect((await changes(app, response.nextCursor)).json()).toEqual({
      kind: 'unchanged',
      cursor: response.nextCursor,
    });
    expect((await board(app)).cursor).toBe(response.nextCursor);
  }));

it('observes command receipts and deduplicates retries before checking stale preconditions', () =>
  contract(async (app) => {
    const initial = await board(app);
    const command = configure(initial, 1);
    await submit(app, command);
    const receipt = (
      await app.inject(`/api/v2/commands/${command.commandId}`)
    ).json<FactoryV2CommandReceipt>();
    expect(receipt.state).toBe('succeeded');
    const cursor = (await board(app)).cursor;
    const replay = await submit(app, command);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(receipt);
    expect((await board(app)).cursor).toBe(cursor);
    expect(
      (await submit(app, { ...command, payload: { ...command.payload, paused: false } })).statusCode
    ).toBe(409);
    expect((await submit(app, { ...command, commandId: commandId(2) })).json()).toMatchObject({
      code: 'stale-action',
      retry: 'refresh',
    });
  }));

it('simulates start/resume/cancel without real workers, preserving consumed admissions and emitting removals', () =>
  contract(async (app) => {
    let snapshot = await board(app);
    const consumed = snapshot.meta.factory.admission.consumed;
    await submit(app, {
      commandId: commandId(1),
      ...available(snapshot, 'start'),
      kind: 'start',
      payload: { context: 'Demo only' },
    });
    snapshot = await board(app);
    expect(snapshot.meta.factory.admission.consumed).toBe(consumed + 1);
    const started = snapshot.entities.items['item:1001'];
    expect(started.section).toBe('working');
    expect(started.actionIds.map((id) => snapshot.entities.actions[id])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'cancel',
          availability: { state: 'available', precondition: expect.any(String), validUntil: null },
        }),
      ])
    );
    await submit(app, {
      commandId: commandId(2),
      ...available(snapshot, 'resume'),
      kind: 'resume',
      payload: {},
    });
    snapshot = await board(app);
    const beforeCancel = snapshot.cursor;
    const cancel = available(snapshot, 'cancel');
    await submit(app, { commandId: commandId(3), ...cancel, kind: 'cancel', payload: {} });
    snapshot = await board(app);
    expect(snapshot.meta.factory.admission.consumed).toBe(consumed + 1);
    const delta = (await changes(app, beforeCancel)).json<FactoryV2Changes>();
    expect(
      delta.kind === 'changes' &&
        delta.batches.some((batch) =>
          batch.changes.some((change) => change.operation === 'remove' && change.table === 'items')
        )
    ).toBe(true);
    expect(Object.values(snapshot.entities.jobs).some((job) => job.cancelled)).toBe(true);
  }));

it('provides fake plan previews and self-contained plan detail without admitting work', () =>
  contract(async (app) => {
    const initial = await board(app);
    const result = await submit(app, {
      commandId: commandId(1),
      ...available(initial, 'preview-plan'),
      kind: 'preview-plan',
      payload: {},
    });
    expect(result.statusCode).toBe(202);
    const current = await board(app);
    expect(current.meta.factory.admission).toEqual(initial.meta.factory.admission);
    expect(current.meta.currentPlanId).not.toBeNull();
    const detail = await app.inject(
      `/api/v2/plans/${encodeURIComponent(String(current.meta.currentPlanId))}`
    );
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      apiVersion: 2,
      attempt: { phase: 'succeeded', applicability: 'current' },
    });
    await submit(app, configure(current, 2));
    expect(
      (
        await app.inject(`/api/v2/plans/${encodeURIComponent(String(current.meta.currentPlanId))}`)
      ).json().attempt.applicability
    ).toBe('stale');
  }));

it('validates search pagination against its query and current index generation', () =>
  contract(async (app) => {
    const first = (await app.inject('/api/v2/issues/search?q=&limit=1')).json();
    expect(first.hits).toHaveLength(1);
    expect(first.nextPageToken).toBeTypeOf('string');
    const next = await app.inject(
      `/api/v2/issues/search?q=&limit=1&pageToken=${encodeURIComponent(first.nextPageToken)}`
    );
    expect(next.statusCode).toBe(200);
    expect(next.json().hits[0].issue.id).not.toBe(first.hits[0].issue.id);
    expect(
      (
        await app.inject(
          `/api/v2/issues/search?q=other&pageToken=${encodeURIComponent(first.nextPageToken)}`
        )
      ).statusCode
    ).toBe(400);
    await submit(app, configure(await board(app), 1));
    expect(
      (
        await app.inject(
          `/api/v2/issues/search?pageToken=${encodeURIComponent(first.nextPageToken)}`
        )
      ).statusCode
    ).toBe(409);
    expect((await app.inject('/api/v2/issues/search?q=zzzz-unmatched')).json().hits).toEqual([]);
  }));

it('requires matching strong entity versions for lazy details', () =>
  contract(async (app) => {
    const snapshot = await board(app);
    const item = Object.values(snapshot.entities.items).find(
      (entry) => entry.subject.kind === 'pull-request'
    );
    if (!item) throw new Error('Missing PR card');
    const url = `/api/v2/items/${encodeURIComponent(item.id)}`;
    expect((await app.inject(url)).statusCode).toBe(400);
    expect((await app.inject({ url, headers: { 'if-match': '"old"' } })).statusCode).toBe(412);
    expect(
      (await app.inject({ url, headers: { 'if-match': `W/"${item.version}"` } })).statusCode
    ).toBe(412);
    const response = await app.inject({ url, headers: { 'if-match': `"${item.version}"` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      itemId: item.id,
      itemVersion: item.version,
      checkRuns: { state: 'known' },
    });
    const before = response.json().checkRuns;
    await submit(app, configure(snapshot, 1));
    expect(
      (await app.inject({ url, headers: { 'if-match': `"${item.version}"` } })).json().checkRuns
    ).toEqual(before);
  }));

it('accepts a full Unicode start context and rejects an oversized context without changing the board', () =>
  contract(async (app) => {
    const initial = await board(app);
    const command: FactoryV2Command = {
      commandId: commandId(1),
      ...available(initial, 'start'),
      kind: 'start',
      payload: { context: '\u754c'.repeat(16000) },
    };
    const invalid = await submit(app, {
      ...command,
      payload: { context: `${command.payload.context}x` },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await board(app)).cursor).toBe(initial.cursor);
    expect((await submit(app, command)).statusCode).toBe(202);
  }));

it('returns explicit cursor resync on expiry or process-generation reset', () =>
  contract(async (app) => {
    const initial = await board(app);
    await submit(app, configure(initial, 1));
    await submit(app, configure(await board(app), 2, false));
    const expired = await changes(app, initial.cursor);
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toEqual({ kind: 'resync-required', reason: 'expired' });
    const other = fakeV2Server({ epoch: 'other' });
    try {
      expect((await changes(other, initial.cursor)).json()).toEqual({
        kind: 'resync-required',
        reason: 'reset',
      });
    } finally {
      await other.close();
    }
  }, 1));

it.each([
  '/api/v2/board/changes',
  '/api/v2/board/changes?after=not-a-cursor',
  '/api/v2/issues/search?limit=51',
  '/api/v2/issues/search?limit=0',
  '/api/v2/issues/search?pageToken=invalid',
  '/api/v2/issues/search?extra=1',
])('rejects malformed transport input at %s with safe Problem Details', (url) =>
  contract(async (app) => {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().type).toContain('/docs/problems/');
  })
);

it('bounds polling and commands, rejects foreign origins and never mutates on invalid input', () =>
  contract(async (app) => {
    const initial = await board(app);
    const url = `/api/v2/board/changes?after=${encodeURIComponent(initial.cursor)}`;
    expect((await app.inject(`${url}&waitMs=25001`)).statusCode).toBe(400);
    expect((await app.inject(`${url}&waitMs=1`)).json()).toEqual({
      kind: 'unchanged',
      cursor: initial.cursor,
    });
    const command = configure(initial, 1);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v2/commands',
      payload: command,
      headers: { origin: 'https://foreign.invalid' },
    });
    expect(foreign.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v2/commands',
          payload: { ...command, extra: true },
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v2/commands',
          payload: '{broken',
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v2/commands',
          payload: 'text',
          headers: { 'content-type': 'text/plain' },
        })
      ).statusCode
    ).toBe(415);
    expect((await board(app)).cursor).toBe(initial.cursor);
    expect((await app.inject(`/api/v2/commands/${commandId(99)}`)).statusCode).toBe(404);
  }));
