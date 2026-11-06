import { expect, it, vi } from 'vitest';
import { fakeV2Server } from '../../src/http/index.js';
import { FactoryClient } from '../src/canvas/client';

it('reads conditional snapshots, searches, loads versioned details, and executes a fake command', async () => {
  const server = fakeV2Server({ epoch: 'ui-test' });
  const client = new FactoryClient(async (path, init) => {
    const response = await server.inject({
      method: init?.method === 'POST' ? 'POST' : 'GET',
      url: String(path),
      headers: { ...Object.fromEntries(new Headers(init?.headers)), host: 'localhost' },
      payload: init?.body ? String(init.body) : undefined,
    });
    return new Response(response.statusCode === 304 ? null : response.body, {
      status: response.statusCode,
      headers: Object.fromEntries(
        Object.entries(response.headers).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, String(value)]]
        )
      ),
    });
  });
  try {
    const board = await client.board();
    expect(board?.meta.dataMode).toBe('fake');
    if (!board) throw new Error('Expected initial snapshot');
    expect(await client.board()).toBeNull();
    const hits = await client.search('');
    expect(hits.hits.length).toBeGreaterThan(0);
    const item = Object.values(board.entities.items)[0];
    expect((await client.details(item)).itemVersion).toBe(item.version);
    const action = Object.values(board.entities.actions).find((a) => a.kind === 'preview-plan');
    if (!action) throw new Error('Expected preview action');
    const receipt = await client.submit(action, { kind: 'preview-plan', payload: {} });
    expect(receipt.state).toBe('accepted');
    expect((await client.receipt(receipt.commandId)).state).toBe('succeeded');
    expect((await client.board())?.meta.currentPlanId).toBeTruthy();
  } finally {
    await server.close();
  }
});

it('reserves commands synchronously and retains an uncertain request for an explicit retry', async () => {
  let attempts = 0;
  const bodies: string[] = [];
  const client = new FactoryClient(async (_path, init) => {
    bodies.push(String(init?.body));
    if (++attempts === 1) throw new TypeError('offline');
    return new Response(
      JSON.stringify({ commandId: JSON.parse(bodies[0]).commandId, state: 'succeeded' })
    );
  });
  const action = {
    id: 'action:preview',
    version: '1',
    kind: 'preview-plan',
    targetId: 'factory:main',
    availability: { state: 'available', precondition: 'token', validUntil: null },
  } as const;
  const first = client.submit(action, { kind: 'preview-plan', payload: {} });
  await expect(client.submit(action, { kind: 'preview-plan', payload: {} })).rejects.toThrow(
    /pending/
  );
  await expect(first).rejects.toThrow(/uncertain/i);
  await expect(client.submit(action, { kind: 'preview-plan', payload: {} })).rejects.toThrow(
    /uncertain/i
  );
  await client.retry();
  expect(bodies[1]).toBe(bodies[0]);
});
it('creates a v4 command UUID on a private HTTP origin without randomUUID', async () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
  let commandId = '';
  const client = new FactoryClient(async (_path, init) => {
    commandId = JSON.parse(String(init?.body)).commandId;
    return new Response(JSON.stringify({ commandId, state: 'succeeded', reasons: [] }));
  });
  try {
    await client.submit(
      {
        id: 'action:preview',
        version: '1',
        kind: 'preview-plan',
        targetId: 'factory:main',
        availability: { state: 'available', precondition: 'current', validUntil: null },
      },
      { kind: 'preview-plan', payload: {} }
    );
    expect(commandId).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  } finally {
    vi.unstubAllGlobals();
  }
});
