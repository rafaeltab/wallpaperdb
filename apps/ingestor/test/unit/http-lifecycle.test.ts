import { Deferred, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { Admission } from '../../src/admission/index.js';
import {
  AvailabilityProbe,
  availabilityLayer,
  type DependencyHealth,
} from '../../src/availability/index.js';
import { Ingestion, type UploadOutcome } from '../../src/ingestion/index.js';
import { createHttpApp } from '../../src/http/index.js';
const receipt = {
  id: 'wlpr_test',
  uploadedAt: '2026-01-01T00:00:00.000Z',
  fileType: 'image' as const,
  mimeType: 'image/png',
  width: 1920,
  height: 1080,
  fileSizeBytes: 5,
};
const availability = availabilityLayer.pipe(
  Layer.provide(
    Layer.succeed(AvailabilityProbe, {
      inspect: () => Effect.succeed({ database: true, s3: true, nats: true, otel: true }),
    })
  )
);
const admission = Layer.succeed(Admission, {
  admit: () => Effect.succeed({ _tag: 'Allowed', remaining: 1, reset: 1000 }),
});
function serve(
  upload: Effect.Effect<UploadOutcome>,
  options: {
    readonly shutdownTimeoutMs?: number;
    readonly requestTimeoutMs?: number;
    readonly probe?: Effect.Effect<DependencyHealth>;
  } = {}
) {
  const probe = options.probe;
  return createHttpApp(
    { nodeEnv: 'test', rateLimitMax: 2, requestTimeoutMs: options.requestTimeoutMs },
    Layer.mergeAll(
      probe
        ? availabilityLayer.pipe(
            Layer.provide(Layer.succeed(AvailabilityProbe, { inspect: () => probe }))
          )
        : availability,
      admission,
      Layer.succeed(Ingestion, {
        upload: () => upload,
        reconcile: () => Effect.succeed({ processed: 0 }),
        cleanup: () => Effect.void,
      })
    ),
    { shutdownTimeoutMs: options.shutdownTimeoutMs ?? 30 }
  );
}
function send(address: string, signal?: AbortSignal) {
  const body = new FormData();
  body.set('file', new Blob(['image'], { type: 'image/png' }), 'test.png');
  return fetch(`${address}/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'owner' })).toString('base64')}`,
    },
    body,
    signal,
  });
}
describe('HTTP ownership', () => {
  it('closes a stalled multipart upload at the configured socket deadline', async () => {
    let ingested = false;
    const app = await serve(
      Effect.sync(() => {
        ingested = true;
        return { _tag: 'InProgress' } as const;
      }),
      { requestTimeoutMs: 30 }
    );
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = httpRequest(`${address}/upload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'owner' })).toString('base64')}`,
        'content-type': 'multipart/form-data; boundary=stalled',
      },
    });
    request.on('error', () => undefined);
    try {
      request.write(
        '--stalled\r\nContent-Disposition: form-data; name="file"; filename="upload.png"\r\nContent-Type: image/png\r\n\r\npartial'
      );
      await expect.poll(() => request.destroyed, { timeout: 1000 }).toBe(true);
      expect(ingested).toBe(false);
    } finally {
      request.destroy();
      await app.close();
    }
  });

  it('interrupts a dependency probe when its caller disconnects', async () => {
    let entered = false;
    let interrupted = false;
    const app = await serve(Effect.succeed({ _tag: 'InProgress' }), {
      probe: Effect.sync(() => {
        entered = true;
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      ),
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    try {
      const response = fetch(`${address}/health`, { signal: abort.signal }).catch(
        (error: unknown) => error
      );
      await expect.poll(() => entered).toBe(true);
      abort.abort();
      expect(await response).toBeInstanceOf(Error);
      await expect.poll(() => interrupted, { timeout: 500 }).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('cancels a blocked upload when the client abandons its response', async () => {
    let entered = false;
    let interrupted = false;
    const app = await serve(
      Effect.sync(() => {
        entered = true;
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      )
    );
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    try {
      const response = send(address, abort.signal).catch((error: unknown) => error);
      await expect.poll(() => entered).toBe(true);
      abort.abort();
      expect(await response).toBeInstanceOf(Error);
      await expect.poll(() => interrupted, { timeout: 500 }).toBe(true);
    } finally {
      await app.close();
    }
  });
});
it('allows an accepted request to finish within shutdown grace', async () => {
  const release = Effect.runSync(Deferred.make<void>());
  let entered = false;
  const app = await serve(
    Effect.sync(() => {
      entered = true;
    }).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.as<UploadOutcome>({ _tag: 'Accepted', upload: receipt })
    ),
    { shutdownTimeoutMs: 1000 }
  );
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = send(address).then((response) => response.json());
  await expect.poll(() => entered).toBe(true);
  const closed = app.close();
  await expect.poll(() => app.connectionsState.isShuttingDown).toBe(true);
  await Effect.runPromise(Deferred.succeed(release, undefined));
  expect(await response).toMatchObject({ id: 'wlpr_test', status: 'processing' });
  await closed;
});
it('interrupts a blocked upload and closes its socket after the shutdown deadline', async () => {
  let entered = false;
  let interrupted = false;
  const app = await serve(
    Effect.sync(() => {
      entered = true;
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        })
      )
    )
  );
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = send(address).catch((error: unknown) => error);
  await expect.poll(() => entered).toBe(true);
  await app.close();
  expect(interrupted).toBe(true);
  expect(await response).toBeInstanceOf(Error);
});
it('releases acquired resources when later startup fails', async () => {
  let closed = false;
  const broken = Layer.effect(
    Ingestion,
    Effect.acquireRelease(Effect.void, () =>
      Effect.sync(() => {
        closed = true;
      })
    ).pipe(Effect.andThen(Effect.fail(new Error('startup failed'))))
  );
  await expect(
    createHttpApp(
      { nodeEnv: 'test', rateLimitMax: 2 },
      Layer.mergeAll(availability, admission, broken)
    )
  ).rejects.toThrow();
  expect(closed).toBe(true);
});
import { request as httpRequest } from 'node:http';
