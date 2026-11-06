import { expect, it } from 'vitest';
import { z } from 'zod';
import { fakeV2Server } from '../src/http/index.js';

const limit = z.union([
  z.object({ kind: z.literal('unlimited') }),
  z.object({ kind: z.literal('limited'), maximum: z.number() }),
]);
// This HTTP client validates the subset it consumes, without asserting a full DTO.
const clientBoard = z.object({
  cursor: z.string(),
  entities: z.object({
    actions: z.object({
      'action:configure': z.object({
        id: z.string(),
        availability: z.object({ state: z.literal('available'), precondition: z.string() }),
      }),
    }),
  }),
  meta: z.object({
    factory: z.object({
      concurrency: z.object({ limit }),
      admission: z.object({ limit }),
    }),
  }),
});

type Server = ReturnType<typeof fakeV2Server>;
async function connect(
  check: (app: Server, origin: string) => Promise<void>,
  options: Parameters<typeof fakeV2Server>[0] = {}
) {
  const app = fakeV2Server({ heartbeatMs: 10, ...options });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    await check(app, origin);
  } finally {
    await app.close();
  }
}
async function snapshot(origin: string) {
  return clientBoard.parse(await (await fetch(`${origin}/api/v2/board`)).json());
}
async function configure(
  origin: string,
  value: z.infer<typeof clientBoard>,
  n: number,
  paused = true
) {
  const action = value.entities.actions['action:configure'];
  if (action.availability.state !== 'available') throw new Error('Missing configure action');
  const response = await fetch(`${origin}/api/v2/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      commandId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      actionId: action.id,
      precondition: action.availability.precondition,
      kind: 'configure',
      payload: {
        paused,
        concurrency: value.meta.factory.concurrency.limit,
        admissionAllowance: value.meta.factory.admission.limit,
      },
    }),
  });
  expect(response.status).toBe(202);
  await response.json();
}
function events(response: Response) {
  if (!response.body) throw new Error('Missing SSE body');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  return {
    async next() {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n');
          const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
          const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
          if (event && data)
            return {
              event,
              id: lines.find((line) => line.startsWith('id: '))?.slice(4),
              data: JSON.parse(data),
            };
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Stream ended before an event');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    done: () => reader.read(),
    close: () => reader.cancel().catch(() => {}),
  };
}

it('replays SSE batches and then delivers live changes with the same cursor sequence as polling', () =>
  connect(async (_app, origin) => {
    const first = await snapshot(origin);
    await configure(origin, first, 1);
    const second = await snapshot(origin);
    const controller = new AbortController();
    const response = await fetch(
      `${origin}/api/v2/board/events?after=${encodeURIComponent(first.cursor)}`,
      { signal: controller.signal }
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-factory-data')).toBe('fake');
    const stream = events(response);
    try {
      const replay = await stream.next();
      expect(replay).toMatchObject({
        event: 'change',
        id: second.cursor,
        data: { fromCursor: first.cursor, toCursor: second.cursor },
      });
      await configure(origin, second, 2, false);
      const live = await stream.next();
      const current = await snapshot(origin);
      expect(live).toMatchObject({
        event: 'change',
        id: current.cursor,
        data: { fromCursor: second.cursor, toCursor: current.cursor },
      });
      const polling = await (
        await fetch(`${origin}/api/v2/board/changes?after=${encodeURIComponent(second.cursor)}`)
      ).json();
      expect(polling).toMatchObject({ batches: [live.data] });
    } finally {
      controller.abort();
      await stream.close();
    }
  }));

it('prefers Last-Event-ID on reconnect and exposes resync before streaming an expired cursor', () =>
  connect(
    async (_app, origin) => {
      const first = await snapshot(origin);
      await configure(origin, first, 1);
      const second = await snapshot(origin);
      const controller = new AbortController();
      const response = await fetch(`${origin}/api/v2/board/events?after=invalid-initial-cursor`, {
        headers: { 'last-event-id': second.cursor },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      const stream = events(response);
      try {
        await configure(origin, second, 2, false);
        expect((await stream.next()).data.fromCursor).toBe(second.cursor);
      } finally {
        controller.abort();
        await stream.close();
      }
      const expired = await fetch(
        `${origin}/api/v2/board/events?after=${encodeURIComponent(first.cursor)}`
      );
      expect(expired.status).toBe(409);
      expect(await expired.json()).toEqual({ kind: 'resync-required', reason: 'expired' });
    },
    { historyLimit: 1 }
  ));

it('wakes a long poll after a command without racing the subscription', () =>
  connect(async (_app, origin) => {
    const first = await snapshot(origin);
    const pending = fetch(
      `${origin}/api/v2/board/changes?after=${encodeURIComponent(first.cursor)}&waitMs=5000`
    );
    await configure(origin, first, 1);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: 'changes',
      batches: [{ fromCursor: first.cursor }],
    });
  }));

it('closes live connections on server shutdown', () =>
  connect(async (app, origin) => {
    const first = await snapshot(origin);
    const response = await fetch(
      `${origin}/api/v2/board/events?after=${encodeURIComponent(first.cursor)}`
    );
    const stream = events(response);
    try {
      // Reading the connected comment establishes that the stream is owned by the server.
      expect((await stream.done()).done).toBe(false);
      const closing = app.close();
      let ended = false;
      while (!ended) ended = (await stream.done()).done;
      await closing;
      expect(ended).toBe(true);
    } finally {
      await stream.close();
    }
  }));

it('ends an oversized SSE batch with a resync signal rather than buffering it indefinitely', () =>
  connect(
    async (_app, origin) => {
      const first = await snapshot(origin);
      await configure(origin, first, 1);
      const response = await fetch(
        `${origin}/api/v2/board/events?after=${encodeURIComponent(first.cursor)}`
      );
      const stream = events(response);
      try {
        expect(await stream.next()).toMatchObject({
          event: 'resync-required',
          data: { kind: 'resync-required', reason: 'slow-consumer' },
        });
        expect((await stream.done()).done).toBe(true);
      } finally {
        await stream.close();
      }
    },
    { maxFrameBytes: 64 }
  ));
