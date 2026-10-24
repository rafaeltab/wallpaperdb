import { appendFileSync, writeFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';
import { connect } from 'nats';
import { mutationNatsEndpoint } from './mutation-nats-endpoint.js';

delete mutationNatsEndpoint.url;
delete mutationNatsEndpoint.connection;
delete mutationNatsEndpoint.withDisposal;
delete mutationNatsEndpoint.recordLifecycle;
const fail = () => {
  const receipt = process.env.WALLPAPERDB_MUTATION_FAILURE_FILE;
  if (receipt) writeFileSync(receipt, '{"failed":true}');
};
const url = process.env.WALLPAPERDB_MUTATION_NATS_URL;
const reset = process.env.WALLPAPERDB_MUTATION_NATS_RESET;
const token = process.env.WALLPAPERDB_MUTATION_NATS_TOKEN;
try {
  if (!url || !reset || !token) throw new Error('Missing owned mutation NATS endpoint');
  const response = await fetch(reset, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error('Owned mutation NATS reset failed');
  const started = performance.now();
  const connection = await connect({
    servers: url,
    name: 'mutation-contract',
    reconnect: false,
    timeout: 1000,
  });
  const timings = process.env.WALLPAPERDB_MUTATION_CLIENT_TIMINGS;
  const identity = {
    scope: 'nats-helper-only',
    pid: process.pid,
    threadId,
    cid: connection.info?.client_id,
    serverId: connection.info?.server_id,
  };
  const record = (entry: object) => {
    if (timings)
      appendFileSync(timings, `${JSON.stringify({ ...identity, at: Date.now(), ...entry })}\n`);
  };
  mutationNatsEndpoint.url = url;
  mutationNatsEndpoint.connection = connection;
  mutationNatsEndpoint.withDisposal = async (cleanup) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          try {
            await cleanup();
          } finally {
            record({ event: 'close-entry' });
            await connection.close();
            record({ event: 'close-return' });
          }
          // Audit before native worker termination can hide the final client's leak.
          const response = await fetch(new URL('/disposed', reset), {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(1000),
          });
          if (!response.ok) throw new Error('Mutation NATS client disposal audit failed');
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Mutation NATS disposal deadline expired')),
            7000
          );
        }),
      ]);
    } catch (error) {
      fail();
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
  if (timings)
    mutationNatsEndpoint.recordLifecycle = (phase, seconds) => record({ phase, seconds });
  mutationNatsEndpoint.recordLifecycle?.('created', (performance.now() - started) / 1000);
} catch (error) {
  fail();
  await mutationNatsEndpoint.connection?.close();
  throw error;
}
