import { expect, it } from 'vitest';
import { z } from 'zod';
import { t3Subscription, t3ReadRpc } from '../src/adapters/t3/index.js';
import { websocketProtocol } from './fixtures/websocket.js';

it('authenticates with a separate bearer credential, applies a chunk before acknowledging it and resumes by cursor', async () => {
  const requests: unknown[] = [];
  let applied = false;
  let applying!: () => void;
  const entered = new Promise<void>((resolve) => {
    applying = resolve;
  });
  let release!: () => void;
  const publication = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acknowledged!: () => void;
  const completed = new Promise<void>((resolve) => {
    acknowledged = resolve;
  });
  const host = await websocketProtocol((raw, send) => {
    requests.push(raw);
    const request = z
      .object({
        _tag: z.string(),
        id: z.string().optional(),
        tag: z.string().optional(),
        payload: z.unknown().optional(),
      })
      .parse(raw);
    if (request._tag === 'Ack') {
      expect(applied).toBe(true);
      acknowledged();
    }
    if (request._tag === 'Request')
      send({ _tag: 'Chunk', requestId: request.id, values: [{ kind: 'synchronized' }] });
  });
  const abort = new AbortController();
  try {
    const running = t3Subscription({
      origin: host.origin,
      token: 'controlled-observer',
      signal: abort.signal,
      requests: [
        {
          id: 'owner',
          method: 'orchestration.subscribeThread',
          payload: { threadId: 'managed', afterSequence: 15, requestCompletionMarker: true },
        },
      ],
      apply: async (_id, values) => {
        expect(values).toEqual([{ kind: 'synchronized' }]);
        applying();
        await publication;
        applied = true;
      },
    });
    await entered;
    expect(requests).toHaveLength(1);
    release();
    await completed;
    expect(requests[0]).toMatchObject({
      _tag: 'Request',
      id: 'owner',
      tag: 'orchestration.subscribeThread',
      payload: { threadId: 'managed', afterSequence: 15, requestCompletionMarker: true },
    });
    abort.abort();
    await running;
  } finally {
    abort.abort();
    await host.close();
  }
});

it('reads lightweight archived metadata through the installed single-response RPC', async () => {
  const host = await websocketProtocol((raw, send) => {
    const request = z
      .object({ _tag: z.string(), id: z.string().optional(), tag: z.string().optional() })
      .parse(raw);
    if (request._tag === 'Request') {
      expect(request.tag).toBe('orchestration.getArchivedShellSnapshot');
      send({
        _tag: 'Exit',
        requestId: request.id,
        exit: { _tag: 'Success', value: { snapshotSequence: 10, threads: [] } },
      });
    }
  });
  try {
    expect(
      await t3ReadRpc({
        origin: host.origin,
        token: 'controlled-observer',
        signal: new AbortController().signal,
        method: 'orchestration.getArchivedShellSnapshot',
        payload: {},
      })
    ).toEqual({ snapshotSequence: 10, threads: [] });
  } finally {
    await host.close();
  }
});

it('does not acknowledge observations that failed durable application', async () => {
  const requests: unknown[] = [];
  const host = await websocketProtocol((raw, send) => {
    requests.push(raw);
    const request = z.object({ _tag: z.string(), id: z.string().optional() }).parse(raw);
    if (request._tag === 'Request')
      send({ _tag: 'Chunk', requestId: request.id, values: [{ kind: 'synchronized' }] });
  });
  const abort = new AbortController();
  try {
    await expect(
      t3Subscription({
        origin: host.origin,
        token: 'controlled-observer',
        signal: abort.signal,
        requests: [
          {
            id: 'owner',
            method: 'orchestration.subscribeThread',
            payload: { threadId: 'managed' },
          },
        ],
        apply: async () => {
          throw new Error('Controlled publication failure');
        },
      })
    ).rejects.toThrow('could not apply subscription update');
    expect(requests).toHaveLength(1);
  } finally {
    abort.abort();
    await host.close();
  }
});

it('rejects an invalid observer credential without opening a subscription', async () => {
  const requests: unknown[] = [];
  const host = await websocketProtocol((raw) => {
    requests.push(raw);
  });
  try {
    await expect(
      t3Subscription({
        origin: host.origin,
        token: 'invalid',
        signal: new AbortController().signal,
        requests: [{ id: 'inventory', method: 'orchestration.subscribeShell', payload: {} }],
        apply: async () => {
          throw new Error('Authentication must precede observations');
        },
      })
    ).rejects.toThrow('HTTP 401');
    expect(requests).toEqual([]);
  } finally {
    await host.close();
  }
});

it('receives a compressed inventory snapshot larger than the native client decompression limit', async () => {
  const host = await websocketProtocol((raw, send) => {
    const request = z.object({ _tag: z.string(), id: z.string().optional() }).parse(raw);
    if (request._tag === 'Request')
      send({
        _tag: 'Chunk',
        requestId: request.id,
        values: [{ kind: 'snapshot', payload: 'x'.repeat(5 * 1024 * 1024) }],
      });
  });
  const abort = new AbortController();
  let received = 0;
  try {
    await t3Subscription({
      origin: host.origin,
      token: 'controlled-observer',
      signal: abort.signal,
      requests: [{ id: 'inventory', method: 'orchestration.subscribeShell', payload: {} }],
      apply: async (_id, values) => {
        const snapshot = z
          .object({ kind: z.literal('snapshot'), payload: z.string() })
          .parse(values[0]);
        received = snapshot.payload.length;
        abort.abort();
      },
    });
    expect(received).toBe(5242880);
  } finally {
    abort.abort();
    await host.close();
  }
});
