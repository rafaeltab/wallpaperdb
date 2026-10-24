import { appendFileSync, writeFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';
import { connect } from 'nats';
import { mutationNatsEndpoint } from './mutation-nats-endpoint.js';

delete mutationNatsEndpoint.url;
delete mutationNatsEndpoint.connection;
delete mutationNatsEndpoint.withDisposal;
delete mutationNatsEndpoint.recordLifecycle;
type DisposalObservation = {
  observationFailed: boolean;
  closeAttempted: boolean;
  closeCompleted: boolean;
};
const fail = (disposal?: DisposalObservation) => {
  const receipt = process.env.WALLPAPERDB_MUTATION_FAILURE_FILE;
  if (receipt) writeFileSync(receipt, JSON.stringify({ failed: true, ...disposal }));
};
const url = process.env.WALLPAPERDB_MUTATION_NATS_URL;
const reset = process.env.WALLPAPERDB_MUTATION_NATS_RESET;
const token = process.env.WALLPAPERDB_MUTATION_NATS_TOKEN;
const reportFailure = async (disposal?: DisposalObservation) => {
  try {
    fail(disposal);
  } catch {
    // Receipt storage cannot prevent independent controller notification.
  }
  try {
    if (reset && token)
      await fetch(new URL('/failure', reset), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      });
  } catch {
    // The original failure remains authoritative if notification also fails.
  }
};
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
    const disposal = { observationFailed: false, closeAttempted: false, closeCompleted: false };
    const observe = (event: 'close-entry' | 'close-return') => {
      try {
        record({ event });
      } catch {
        disposal.observationFailed = true;
      }
    };
    try {
      await Promise.race([
        (async () => {
          try {
            await cleanup();
          } finally {
            observe('close-entry');
            disposal.closeAttempted = true;
            await connection.close();
            disposal.closeCompleted = true;
            observe('close-return');
          }
          // Audit before native worker termination can hide the final client's leak.
          const response = await fetch(new URL('/disposed', reset), {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(1000),
          });
          if (!response.ok) throw new Error('Mutation NATS client disposal audit failed');
          if (disposal.observationFailed) throw new Error('Mutation NATS lifecycle receipt failed');
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Mutation NATS disposal deadline expired')),
            7000
          );
        }),
      ]);
    } catch (error) {
      await reportFailure(disposal);
      if (disposal.observationFailed)
        throw new AggregateError(
          [error],
          `Mutation NATS trace incomplete; closeAttempted=${disposal.closeAttempted}, closeCompleted=${disposal.closeCompleted}`
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  if (timings)
    mutationNatsEndpoint.recordLifecycle = async (phase, seconds) => {
      try {
        record({ phase, seconds });
      } catch (error) {
        // Startup owns created-phase cleanup. Disposed runs after that boundary.
        if (phase === 'disposed') await reportFailure();
        throw error;
      }
    };
  await mutationNatsEndpoint.recordLifecycle?.('created', (performance.now() - started) / 1000);
} catch (error) {
  const failures = [error];
  try {
    await mutationNatsEndpoint.connection?.close();
  } catch (closeError) {
    failures.push(closeError);
  }
  await reportFailure();
  if (failures.length > 1)
    throw new AggregateError(failures, 'Mutation NATS startup cleanup failed');
  throw error;
}
