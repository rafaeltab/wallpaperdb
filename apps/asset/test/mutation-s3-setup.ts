import { appendFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { Agent } from 'node:http';
import type { Socket } from 'node:net';
import { threadId } from 'node:worker_threads';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { vi } from 'vitest';
import { mutationS3Endpoint } from './mutation-s3-endpoint.js';

// Observe actual SDK instances and transports. No S3 operation is replaced.
const observed = vi.hoisted(() => ({
  clients: new Map<
    object,
    {
      id: number;
      attempted: boolean;
      returned: boolean;
      observationFailed: boolean;
      sockets: Map<Socket, ReturnType<typeof socketState>>;
    }
  >(),
}));
vi.mock('@aws-sdk/client-s3', async (original) => {
  const sdk = await original<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class extends sdk.S3Client {
      constructor(...args: ConstructorParameters<typeof sdk.S3Client>) {
        const started = performance.now();
        super(...args);
        const entry = {
          id: observed.clients.size + 1,
          attempted: false,
          returned: false,
          observationFailed: false,
          sockets: new Map<Socket, ReturnType<typeof socketState>>(),
        };
        observed.clients.set(this, entry);
        try {
          record({
            phase: 'created',
            sdkClientId: entry.id,
            seconds: (performance.now() - started) / 1000,
          });
        } catch (error) {
          entry.observationFailed = true;
          entry.attempted = true;
          try {
            super.destroy();
            entry.returned = true;
          } catch (cause) {
            throw new AggregateError(
              [error, cause],
              'S3 observation and constructor cleanup failed'
            );
          }
          throw error;
        }
      }
      override destroy() {
        const started = performance.now();
        const record = observed.clients.get(this);
        if (!record) throw new Error('Unknown mutation S3 client');
        record.attempted = true;
        let observationError: unknown;
        try {
          for (const { agent } of agentsFor(this)) {
            for (const socket of [
              ...Object.values(agent.sockets),
              ...Object.values(agent.freeSockets),
            ].flatMap((entries) => entries ?? []))
              if (!record.sockets.has(socket)) record.sockets.set(socket, socketState(socket));
          }
        } catch (error) {
          record.observationFailed = true;
          observationError = error;
        }
        // Observation failure cannot skip the actual resource release.
        super.destroy();
        record.returned = true;
        try {
          recordDestroy({ sdkClientId: record.id, seconds: (performance.now() - started) / 1000 });
        } catch (error) {
          record.observationFailed = true;
          observationError ??= error;
        }
        if (observationError) throw observationError;
      }
    },
  };
});

delete mutationS3Endpoint.config;
delete mutationS3Endpoint.upload;
delete mutationS3Endpoint.dispose;
delete mutationS3Endpoint.observeApplication;
const reset = process.env.WALLPAPERDB_MUTATION_S3_RESET;
const token = process.env.WALLPAPERDB_MUTATION_S3_TOKEN;
const endpoint = process.env.WALLPAPERDB_MUTATION_S3_ENDPOINT;
const timings = process.env.WALLPAPERDB_MUTATION_CLIENT_TIMINGS;
let executionId = 0;
const record = (entry: object) => {
  if (!timings) throw new Error('Missing mutation S3 observation file');
  appendFileSync(
    timings,
    `${JSON.stringify({ execution: executionId, pid: process.pid, threadId, at: Date.now(), ...entry })}\n`
  );
};
const recordDestroy = (entry: object) => record({ event: 'sdk-destroy-return', ...entry });
const notifyFailure = async () => {
  try {
    const receipt = process.env.WALLPAPERDB_MUTATION_FAILURE_FILE;
    if (receipt) writeFileSync(receipt, JSON.stringify({ failed: true }));
  } finally {
    if (reset && token) {
      const response = await fetch(new URL('/failure', reset), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
    }
  }
};
const connectionConfig = (kind: 'APP' | 'HELPER') => {
  const accessKeyId = process.env[`WALLPAPERDB_MUTATION_S3_${kind}_KEY`];
  const secretAccessKey = process.env[`WALLPAPERDB_MUTATION_S3_${kind}_SECRET`];
  if (!endpoint || !accessKeyId || !secretAccessKey)
    throw new Error('Missing owned mutation S3 connection');
  return { endpoint, region: 'us-east-1', accessKeyId, secretAccessKey };
};
const socketState = (socket: Socket) => ({
  localAddress: socket.localAddress,
  localPort: socket.localPort,
  remoteAddress: socket.remoteAddress,
  remotePort: socket.remotePort,
  destroyed: socket.destroyed,
  closed: socket.closed,
});
function agentsFor(value: S3Client) {
  const handler = value.config.requestHandler;
  if (!('httpHandlerConfigs' in handler) || typeof handler.httpHandlerConfigs !== 'function')
    throw new Error('Unobservable mutation S3 transport');
  const config = handler.httpHandlerConfigs();
  const agents = [];
  for (const name of ['httpAgent', 'httpsAgent']) {
    const agent: unknown = config[name];
    // The SDK initializes its Node handler only on the first actual request.
    if (agent === undefined) continue;
    if (!(agent instanceof Agent)) throw new Error('Unobservable mutation S3 agent');
    agents.push({ name, agent });
  }
  return agents;
}
const audit = () => {
  const clients = [];
  for (const [value, lifetime] of observed.clients) {
    if (!(value instanceof S3Client)) throw new Error('Mutation S3 client identity changed');
    const agents = [];
    for (const { name, agent } of agentsFor(value)) {
      const sockets = [...Object.values(agent.sockets), ...Object.values(agent.freeSockets)]
        .flatMap((entries) => entries ?? [])
        .map(socketState);
      const queued = Object.values(agent.requests).reduce(
        (n, entries) => n + (entries?.length ?? 0),
        0
      );
      agents.push({ name, sockets, queued });
    }
    const { sockets, ...disposal } = lifetime;
    clients.push({
      ...disposal,
      agents,
      ownedSockets: [...sockets].map(([socket, identity]) => ({
        ...identity,
        destroyed: socket.destroyed,
        closed: socket.closed,
      })),
    });
  }
  if (clients.length > 1024) throw new Error('Mutation S3 client observation limit exceeded');
  return {
    scope: 'actual-sdk-instances-and-node-agents',
    complete: true,
    clients,
    passed: clients.every(
      (client) =>
        !client.observationFailed &&
        client.attempted &&
        client.returned &&
        client.ownedSockets.every((socket) => socket.destroyed && socket.closed) &&
        client.agents.every(
          (agent) =>
            agent.queued === 0 && agent.sockets.every((socket) => socket.destroyed && socket.closed)
        )
    ),
  };
};

let helper: S3Client | undefined;
try {
  if (!reset || !token) throw new Error('Missing owned mutation S3 reset');
  const response = await fetch(reset, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error('Owned mutation S3 reset failed');
  const execution = Number(await response.text());
  if (!Number.isSafeInteger(execution) || execution < 1)
    throw new Error('Invalid S3 execution identity');
  executionId = execution;
  const started = performance.now();
  const app = connectionConfig('APP');
  const seed = connectionConfig('HELPER');
  helper = new S3Client({
    endpoint: seed.endpoint,
    region: seed.region,
    credentials: { accessKeyId: seed.accessKeyId, secretAccessKey: seed.secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 1,
  });
  const client = helper;
  let applicationObserved = false;
  mutationS3Endpoint.observeApplication = async (clients, failed, complete) => {
    try {
      if (
        !complete ||
        clients.some(
          (value) =>
            value === client || !observed.clients.has(value) || !(value instanceof S3Client)
        )
      )
        throw new Error('Mutation S3 application SDK binding is incomplete');
      record({
        execution,
        event: 'application-observation',
        complete: true,
        failed,
        clientIds: clients.map((value) => observed.clients.get(value)?.id),
        helperClientId: observed.clients.get(client)?.id,
      });
      applicationObserved = true;
    } catch (error) {
      try {
        await notifyFailure();
      } catch {
        /* Observation failure remains authoritative. */
      }
      throw error;
    }
  };
  mutationS3Endpoint.config = app;
  mutationS3Endpoint.upload = async (Bucket, Key, Body) => {
    await client.send(new PutObjectCommand({ Bucket, Key, Body }), {
      abortSignal: AbortSignal.timeout(5000),
    });
  };
  mutationS3Endpoint.dispose = async () => {
    const started = performance.now();
    try {
      // The ordinary test asserts release before its emergency application
      // cleanup. A failed ordinary assertion stays a native failure; only a
      // remaining leak or incomplete observation invalidates the fixture.
      client.destroy();
      // Wait for the exact observed close events, without closing an application
      // client or polling until an unrelated keepalive deadline hides a leak.
      const signal = AbortSignal.timeout(1000);
      await Promise.all(
        [...observed.clients.values()]
          .flatMap((entry) => [...entry.sockets.keys()])
          .map((socket) => (socket.closed ? Promise.resolve() : once(socket, 'close', { signal })))
      );
      const snapshot = audit();
      record({ execution, event: 'disposal-audit', ...snapshot });
      if (!applicationObserved) throw new Error('Missing S3 application observation');
      if (!snapshot.passed) throw new Error('Mutation S3 client disposal audit failed');
      if (process.env.MUTATION_S3_DISPOSAL_FAILURE === 'after-progress' && execution >= 3)
        throw new Error('Requested S3 disposal-failure diagnostic');
      const response = await fetch(new URL(`/disposed/${execution}`, reset), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error('Owned mutation S3 disposal rejected');
      await response.body?.cancel();
      record({ execution, phase: 'disposed', seconds: (performance.now() - started) / 1000 });
    } catch (error) {
      try {
        await notifyFailure();
      } catch {
        /* Original disposal failure stays authoritative. */
      }
      throw error;
    }
  };
  record({ execution, event: 'helper-ready', seconds: (performance.now() - started) / 1000 });
} catch (error) {
  const failures = [error];
  try {
    helper?.destroy();
  } catch (cause) {
    failures.push(cause);
  }
  try {
    await notifyFailure();
  } catch (cause) {
    failures.push(cause);
  }
  if (failures.length > 1)
    throw new AggregateError(failures, 'Mutation S3 startup or cleanup failed', { cause: error });
  throw error;
}
