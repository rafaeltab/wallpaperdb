import { createServer } from 'node:http';
import { Deferred, Effect, ManagedRuntime } from 'effect';
import { expect, it, vi } from 'vitest';
import { assetsLayer } from '../../src/adapters/assets/index.js';
import { AssetStorage } from '../../src/ingestion/index.js';

it('aborts the underlying S3 request when upload work is interrupted', async () => {
  const started = Deferred.makeUnsafe<void>();
  let aborted = false;
  const server = createServer((request, response) => {
    if (request.url?.includes('wlpr_pending')) {
      response.once('close', () => { aborted = true; });
      Effect.runSync(Deferred.succeed(started, undefined));
      return;
    }
    response.writeHead(200);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const runtime = ManagedRuntime.make(assetsLayer({
    endpoint: `http://127.0.0.1:${address.port}`, region: 'us-east-1',
    accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'wallpapers',
  }));
  try {
    const controller = new AbortController();
    const pending = runtime.runPromise(AssetStorage.use((assets) =>
      assets.exists({ wallpaperId: 'wlpr_pending', extension: 'png' })
    ), { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    await Effect.runPromise(Deferred.await(started).pipe(Effect.timeout('2 seconds')));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(aborted).toBe(true), { timeout: 1000 });
  } finally {
    await runtime.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
