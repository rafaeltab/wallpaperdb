import { createServer } from 'node:http';
import { once } from 'node:events';
import { Effect, ManagedRuntime } from 'effect';
import { expect, it, vi } from 'vitest';
import { assetsLayer } from '../../src/adapters/assets/index.js';
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
