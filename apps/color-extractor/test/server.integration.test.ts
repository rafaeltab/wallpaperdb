import { createServer } from 'node:net';
import { once } from 'node:events';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { startColorExtractor } from '../src/server.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester()
  .withS3()
  .withS3Bucket('wallpapers')
  .withNats((nats) => nats.withJetstream())
  .withStream('WALLPAPER');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());

function config(port: number): Config {
  const s3 = tester.s3.config;
  return {
    nodeEnv: 'test',
    port,
    s3Endpoint: s3.endpoints.fromHost,
    s3AccessKeyId: s3.options.accessKey,
    s3SecretAccessKey: s3.options.secretKey,
    s3Bucket: 'wallpapers',
    assetReferenceBucket: 'asset-references',
    s3Region: 'us-east-1',
    natsUrl: tester.nats.config.endpoints.fromHost,
    natsStream: 'WALLPAPER',
    otelServiceName: 'color-extractor-server-contract',
  };
}
const decodeConnections = Schema.decodeUnknownSync(Schema.Struct({ num_connections: Schema.Int }));
async function connections(): Promise<number> {
  const container = tester.nats.config.container.getContainer();
  const response = await fetch(`http://127.0.0.1:${container.getMappedPort(8222)}/connz`);
  return decodeConnections(await response.json()).num_connections;
}

it('serves readiness through a real listener and releases the listener and broker on scope exit', async () => {
  const baseline = await connections();
  let address = '';
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startColorExtractor(config(0));
        address = server.address.replace('0.0.0.0', '127.0.0.1');
        yield* Effect.promise(async () => {
          const response = await fetch(`${address}/ready`);
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ ready: true });
          expect(await connections()).toBe(baseline + 1);
        });
      })
    )
  );
  await expect.poll(connections).toBe(baseline);
  await expect(fetch(`${address}/ready`)).rejects.toThrow();
}, 10000);

it('releases acquired broker resources when its HTTP port is already occupied', async () => {
  const occupied = createServer();
  occupied.listen(0, '0.0.0.0');
  await once(occupied, 'listening');
  const address = occupied.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  try {
    const baseline = await connections();
    const result = await Effect.runPromise(
      startColorExtractor(config(address.port)).pipe(Effect.scoped, Effect.result)
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      expect(result.failure).toMatchObject({ _tag: 'StartupFailure', stage: 'listener' });
    }
    await expect.poll(connections).toBe(baseline);
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve()))
    );
  }
}, 10000);
