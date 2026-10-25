import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { S3Client } from '@aws-sdk/client-s3';
import { once } from 'node:events';
import { Agent } from 'node:http';
import type { Socket } from 'node:net';
import { Effect, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AssetReader } from '../src/capabilities/delivery/index.js';
import { type AssetHealth, s3AssetsLayer } from '../src/adapters/assets/index.js';
import { mutationS3Endpoint } from './mutation-s3-endpoint.js';
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('assets');
function applicationAgents(client: S3Client): Agent[] {
  const handler = client.config.requestHandler;
  if (!('httpHandlerConfigs' in handler) || typeof handler.httpHandlerConfigs !== 'function')
    throw new Error('The real S3 Node transport cannot be observed');
  const config = handler.httpHandlerConfigs();
  return ['httpAgent', 'httpsAgent'].map((name) => {
    const agent: unknown = config[name];
    if (!(agent instanceof Agent)) throw new Error('The real S3 agent cannot be observed');
    return agent;
  });
}
beforeAll(async () => {
  if (!mutationS3Endpoint.config) await tester.setup();
}, 60000);
afterAll(async () => {
  if (mutationS3Endpoint.dispose) await mutationS3Endpoint.dispose();
  else await tester.destroy();
});
it('reads exact stored bytes and distinguishes missing objects', async () => {
  if (mutationS3Endpoint.upload)
    await mutationS3Endpoint.upload('assets', 'image', Buffer.from([9, 4, 1]));
  else await tester.s3.uploadObject('assets', 'image', Buffer.from([9, 4, 1]));
  // Observe the real application requests after the seed helper has finished.
  // Vitest's default spy forwards every call to the actual SDK implementation.
  const sending = vi.spyOn(S3Client.prototype, 'send');
  const destroying = vi.spyOn(S3Client.prototype, 'destroy');
  const config = mutationS3Endpoint.config ?? {
    endpoint: tester.getS3().endpoints.fromHost,
    region: 'us-east-1',
    accessKeyId: tester.getS3().options.accessKey,
    secretAccessKey: tester.getS3().options.secretKey,
  };
  let runtime: ManagedRuntime.ManagedRuntime<AssetReader | AssetHealth, never> | undefined;
  const failures: unknown[] = [];
  try {
    runtime = ManagedRuntime.make(s3AssetsLayer({ ...config, bucket: 'assets' }));
    const body = await runtime.runPromise(
      Effect.flatMap(AssetReader, (a) => a.read({ storageBucket: 'assets', storageKey: 'image' }))
    );
    if (!body) throw new Error('missing image');
    const chunks = [];
    for await (const chunk of body) chunks.push(...chunk);
    expect(chunks).toEqual([9, 4, 1]);
    expect(
      await runtime.runPromise(
        Effect.flatMap(AssetReader, (a) =>
          a.read({ storageBucket: 'assets', storageKey: 'missing' })
        )
      )
    ).toBeNull();
  } catch (cause) {
    failures.push(cause);
  } finally {
    const contexts = [...new Set(sending.mock.contexts)];
    const clients = contexts.filter((client): client is S3Client => client instanceof S3Client);
    const agents: Agent[] = [];
    const sockets = new Set<Socket>();
    const closures: Promise<unknown>[] = [];
    let observationComplete = clients.length === contexts.length;
    const closureDeadline = new AbortController();
    const timer = setTimeout(() => closureDeadline.abort(), 1000);
    try {
      try {
        for (const client of clients) {
          for (const agent of applicationAgents(client)) {
            agents.push(agent);
            for (const socket of [
              ...Object.values(agent.sockets),
              ...Object.values(agent.freeSockets),
            ].flatMap((entries) => entries ?? []))
              sockets.add(socket);
          }
        }
        // Listen before disposal. A destroyed socket may still be awaiting close.
        for (const socket of sockets)
          closures.push(
            socket.closed
              ? Promise.resolve(undefined)
              : once(socket, 'close', { signal: closureDeadline.signal }).then(
                  () => undefined,
                  (cause: unknown) => cause
                )
          );
      } catch (cause) {
        observationComplete = false;
        failures.push(cause);
      }
      try {
        await runtime?.dispose();
      } catch (cause) {
        failures.push(cause);
      }
      try {
        // An early production failure can legitimately precede any SDK request.
        if (failures.length === 0) {
          if (clients.length !== 1) observationComplete = false;
          expect(clients).toHaveLength(1);
        }
        // An idle connection may already have closed. The runtime still owns
        // the real SDK client's release, independently of live socket count.
        const released = new Set(destroying.mock.contexts);
        for (const client of clients) expect(released.has(client)).toBe(true);
        for (const socket of sockets) expect(socket.destroyed).toBe(true);
        for (const agent of agents)
          expect(Object.values(agent.requests).flatMap((entries) => entries ?? [])).toHaveLength(0);
        for (const result of await Promise.all(closures))
          if (result !== undefined) failures.push(result);
        for (const socket of sockets) expect(socket.closed).toBe(true);
      } catch (cause) {
        failures.push(cause);
      }
      try {
        await mutationS3Endpoint.observeApplication?.(
          clients,
          failures.length > 0,
          observationComplete
        );
      } catch (cause) {
        failures.push(cause);
      }
    } finally {
      clearTimeout(timer);
      closureDeadline.abort();
      // Emergency cleanup follows the ordinary lifecycle assertion, including
      // when a mutation removed the production release. Retain every failure.
      for (const client of clients) {
        try {
          client.destroy();
        } catch (cause) {
          failures.push(cause);
        }
      }
      try {
        sending.mockRestore();
      } catch (cause) {
        failures.push(cause);
      }
      try {
        destroying.mockRestore();
      } catch (cause) {
        failures.push(cause);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'S3 read or runtime disposal failed');
});
