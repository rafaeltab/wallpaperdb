import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer } from '../src/http/index.js';
it('serves the app and compiled same-origin assets without reading any external or job dependency', async () => {
  const unavailable = () => Effect.die('Must not read external work for assets');
  const app = operationsServer({
    base: 'a'.repeat(40),
    run: Effect.runPromise,
    job: {
      retry: () => Effect.die('Unexpected fresh retry in this fixture'),
      status: unavailable,
      start: unavailable,
      resume: unavailable,
      cancel: unavailable,
    },
  });
  try {
    const shell = await app.inject('/');
    expect(shell.statusCode).toBe(200);
    const assets = [...shell.body.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(
      (match) => match[1]
    );
    expect(assets.length).toBeGreaterThanOrEqual(2);
    const workers = new Set<string>();
    for (const path of assets) {
      const asset = await app.inject(path);
      expect(asset.statusCode).toBe(200);
      expect(asset.body.length).toBeGreaterThan(0);
      for (const match of asset.body.matchAll(/new Worker\(new URL\("([^" ]+)"/g))
        workers.add(new URL(match[1], `http://factory.test${path}`).pathname);
    }
    expect(workers.size, 'The Project canvas bundles its item dependency link worker').toBe(1);
    for (const path of workers) {
      const worker = await app.inject(path);
      expect(worker.statusCode, `Compiled worker ${path} must be served`).toBe(200);
      expect(worker.headers['content-type']).toContain('javascript');
    }
    expect((await app.inject('/assets/missing.js')).statusCode).toBe(404);
    expect((await app.inject('/assets/..%2Fpackage.json')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
