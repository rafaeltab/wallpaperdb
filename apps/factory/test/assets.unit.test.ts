import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer } from '../src/http/index.js';
it('serves the app and compiled same-origin assets without reading any external or job dependency', async () => {
  const unavailable = () => Effect.die('Must not read external work for assets');
  const app = operationsServer({
    base: 'a'.repeat(40),
    run: Effect.runPromise,
    job: { status: unavailable, start: unavailable, resume: unavailable, cancel: unavailable },
  });
  try {
    const shell = await app.inject('/');
    expect(shell.statusCode).toBe(200);
    const assets = [...shell.body.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(
      (match) => match[1]
    );
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const path of assets) {
      const asset = await app.inject(path);
      expect(asset.statusCode).toBe(200);
      expect(asset.body.length).toBeGreaterThan(0);
    }
    expect((await app.inject('/assets/missing.js')).statusCode).toBe(404);
    expect((await app.inject('/assets/..%2Fpackage.json')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
