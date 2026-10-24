import { appendFileSync, writeFileSync } from 'node:fs';
import { mutationPostgresEndpoint } from './mutation-postgres-endpoint.js';

delete mutationPostgresEndpoint.url;
delete mutationPostgresEndpoint.recordLifecycle;
delete mutationPostgresEndpoint.withDisposal;
const fail = () => {
  const receipt = process.env.WALLPAPERDB_MUTATION_FAILURE_FILE;
  if (receipt) writeFileSync(receipt, '{"failed":true}');
};
try {
  const url = process.env.WALLPAPERDB_MUTATION_POSTGRES_URL;
  const reset = process.env.WALLPAPERDB_MUTATION_POSTGRES_RESET;
  const token = process.env.WALLPAPERDB_MUTATION_POSTGRES_TOKEN;
  if (!url || !reset || !token) throw new Error('Missing owned mutation PostgreSQL endpoint');
  const response = await fetch(reset, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error('Owned mutation PostgreSQL reset failed');
  mutationPostgresEndpoint.url = url;
  mutationPostgresEndpoint.withDisposal = async (cleanup) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await cleanup();
          // Audit before the native runner can kill its workers and hide sockets
          // leaked by the final execution. This controller is not instrumented.
          const response = await fetch(new URL('/disposed', reset), {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(1000),
          });
          if (!response.ok) throw new Error('Mutation PostgreSQL client disposal audit failed');
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Mutation PostgreSQL disposal deadline expired')),
            2000
          );
        }),
      ]);
    } catch (error) {
      fail();
      // The controller stops and reaps the worker, bounding a hung cleanup too.
      await fetch(new URL('/failure', reset), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      }).catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const timings = process.env.WALLPAPERDB_MUTATION_CLIENT_TIMINGS;
  if (timings)
    mutationPostgresEndpoint.recordLifecycle = (phase, seconds) =>
      appendFileSync(timings, `${JSON.stringify({ phase, seconds })}\n`);
} catch (error) {
  // A setup failure must not become a native mutant kill, even if HTTP failed.
  fail();
  throw error;
}
