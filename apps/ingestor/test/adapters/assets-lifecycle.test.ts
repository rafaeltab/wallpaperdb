import { createServer } from 'node:http';
import { once } from 'node:events';
import { Effect, ManagedRuntime } from 'effect';
import { expect, it, vi } from 'vitest';
import { AssetsHealth, assetsLayer } from '../../src/adapters/assets/index.js';
import { AssetStorage } from '../../src/ingestion/index.js';

it('aborts connected storage requests that exceed their deadline', async () => {
  let entered = () => {};
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = createServer((request, response) => {
    if (request.url?.includes('/original.')) {
      entered();
      return;
    }
    response.writeHead(200).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const runtime = ManagedRuntime.make(
    assetsLayer({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      bucket: 'assets',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    })
  );
  const controller = new AbortController();
  let outcome: unknown;
  let pending: Promise<void> | undefined;
  try {
    const assets = await runtime.runPromise(AssetStorage);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    pending = runtime
      .runPromise(
        assets.exists({ wallpaperId: 'wlpr_hanging', extension: 'png' }).pipe(Effect.result),
        { signal: controller.signal }
      )
      .then(
        (result) => {
          outcome = result;
        },
        () => {}
      );
    await enteredPromise;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(outcome).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'IngestionUnavailable', operation: 'inspect-asset' },
    });
  } finally {
    controller.abort();
    vi.useRealTimers();
    await pending;
    await runtime.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('cancels a hanging health request when its sibling bucket check fails', async () => {
  let initialized = false;
  let failOriginal: (() => void) | undefined;
  let referenceEntered = false;
  let referenceClosed = false;
  const server = createServer((request, response) => {
    if (request.url === '/wallpapers/' && !initialized) {
      initialized = true;
      response.writeHead(200).end();
      return;
    }
    if (request.url?.includes('asset-references')) {
      referenceEntered = true;
      response.on('close', () => {
        referenceClosed = true;
      });
    } else {
      failOriginal = () => {
        response.writeHead(404).end();
      };
    }
    if (referenceEntered) failOriginal?.();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
  const runtime = ManagedRuntime.make(
    assetsLayer({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      bucket: 'wallpapers',
    })
  );
  try {
    expect(await runtime.runPromise(AssetsHealth.use((health) => health.check()))).toBe(false);
    expect(referenceEntered).toBe(true);
    await vi.waitFor(() => expect(referenceClosed).toBe(true), { timeout: 500, interval: 10 });
  } finally {
    await runtime.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
