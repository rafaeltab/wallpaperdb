import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { AckPolicy, connect } from 'nats';
import { Pool } from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { nodeFixtureArguments } from '@wallpaperdb/scripts/node-fixture';
import { databaseLayer } from '../src/adapters/database/index.js';
import {
  brokerLayer,
  ConsumerHealth,
  eventPublisherLayer,
  eventStoreLayer,
  ownershipConsumerLayer,
} from '../src/adapters/events/index.js';
import { profileStoreLayer } from '../src/adapters/profiles/index.js';
import { maintenanceLayer } from '../src/capabilities/maintenance/index.js';
import {
  Identities,
  Profiles,
  ProfileStore,
  profilesLayer,
} from '../src/capabilities/profile/index.js';
import { profilePolicy } from './helpers/profiles.js';

type Release = () => unknown | Promise<unknown>;
const occurred = '2030-01-01T00:00:00.000Z';
const wallpaperView = z.object({ wallpaperId: z.string(), assetId: z.string().nullable() });
const legacy = {
  eventId: 'legacy-publication',
  eventType: 'wallpaper.uploaded',
  timestamp: occurred,
  wallpaper: {
    id: 'wlpr_legacy',
    userId: 'owner',
    fileType: 'image',
    mimeType: 'image/png',
    fileSizeBytes: 8,
    width: 2,
    height: 2,
    aspectRatio: 1,
    uploadedAt: occurred,
    storageBucket: 'legacy-only',
    storageKey: 'legacy-only',
    originalFilename: 'legacy.png',
  },
};

async function publicationServer(
  databaseUrl: string,
  natsUrl: string,
  defer: (release: Release) => void
) {
  const child = spawn(
    process.execPath,
    nodeFixtureArguments('../../wallpaper/test/fixtures/ownership-publication-server.ts', import.meta.url),
    {
      cwd: fileURLToPath(new URL('../../wallpaper/', import.meta.url)),
      env: {
        ...process.env,
        PUBLICATION_TEST_DATABASE_URL: databaseUrl,
        PUBLICATION_TEST_NATS_URL: natsUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  const closed = once(child, 'close');
  const lines = createInterface({ input: child.stdout });
  let diagnostic = '';
  child.stderr.on('data', (bytes) => {
    diagnostic = (diagnostic + bytes.toString()).slice(-65536);
  });
  defer(async () => {
    lines.close();
    child.stdin.end();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const [code, signal] = await closed;
      if (code !== 0) throw new Error(`Wallpaper fixture exited ${code}/${signal}: ${diagnostic}`);
    } finally {
      clearTimeout(deadline);
    }
  });
  return await new Promise<string>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`Wallpaper fixture startup timed out: ${diagnostic}`)),
      15000
    );
    const finish = () => clearTimeout(deadline);
    child.once('error', (error) => {
      finish();
      reject(error);
    });
    void closed.then(([code]) => {
      finish();
      reject(new Error(`Wallpaper fixture exited ${code}: ${diagnostic}`));
    });
    lines.on('line', (line) => {
      if (line.startsWith('PUBLICATION_FIXTURE ')) {
        finish();
        const ready: unknown = JSON.parse(line.slice('PUBLICATION_FIXTURE '.length));
        if (
          typeof ready === 'object' &&
          ready !== null &&
          'url' in ready &&
          typeof ready.url === 'string'
        )
          resolve(ready.url);
        else reject(new Error('Invalid Wallpaper fixture address'));
      }
    });
  });
}

it('replays actual Wallpaper publication into private Biography ownership and preserves legacy authorization and Profile concurrency', async () => {
  const releases: Release[] = [];
  const errors: unknown[] = [];
  const defer = (release: Release) => {
    releases.push(release);
  };
  try {
    const database = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'user' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    defer(() => database.stop());
    const base = `postgresql://postgres:test@${database.getHost()}:${database.getMappedPort(5432)}`;
    const pool = new Pool({ connectionString: `${base}/user` });
    defer(() => pool.end());
    await pool.query('CREATE DATABASE wallpaper');
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await pool.query(readFileSync(new URL(name, migrations), 'utf8'));
    const broker = await new GenericContainer('nats:2.10-alpine')
      .withCopyContentToContainer([
        {
          target: '/config.json',
          content: JSON.stringify({
            port: 4222,
            http: 8222,
            jetstream: { store_dir: '/data' },
            no_auth_user: 'legacy',
            accounts: {
              LEGACY: { jetstream: 'enabled', users: [{ user: 'legacy', password: '' }] },
              ASSET_WALLPAPER: {
                jetstream: 'enabled',
                users: [
                  { user: 'operator', password: 'operator-test' },
                  {
                    user: 'wallpaper-client',
                    password: 'application-test',
                    permissions: {
                      publish: {
                        allow: [
                          'asset.commands.wallpaper.create',
                          '$JS.API.CONSUMER.INFO.ASSET_RESULTS.results_wallpaper',
                          '$JS.API.CONSUMER.MSG.NEXT.ASSET_RESULTS.results_wallpaper',
                          '$JS.ACK.>',
                        ],
                      },
                      subscribe: { allow: ['_ASSET_INBOX.wallpaper.>'] },
                    },
                  },
                ],
              },
            },
          }),
        },
      ])
      .withCommand(['-c', '/config.json'])
      .withExposedPorts(4222, 8222)
      .withWaitStrategy(Wait.forHttp('/healthz', 8222))
      .start();
    defer(() => broker.stop());
    const natsUrl = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
    const connection = await connect({ servers: natsUrl });
    defer(() => connection.close());
    const operator = await connect({ servers: natsUrl, user: 'operator', pass: 'operator-test' });
    defer(() => operator.close());
    const manager = await connection.jetstreamManager();
    const protectedManager = await operator.jetstreamManager();
    await manager.streams.add({ name: 'WALLPAPER', subjects: ['wallpaper.>'] });
    await manager.streams.add({ name: 'PROFILE', subjects: ['profile.>'] });
    await protectedManager.streams.add({
      name: 'ASSET_COMMANDS',
      subjects: ['asset.commands.wallpaper.create'],
    });
    await protectedManager.streams.add({
      name: 'ASSET_RESULTS',
      subjects: ['asset.results.wallpaper'],
    });
    await protectedManager.consumers.add('ASSET_RESULTS', {
      durable_name: 'results_wallpaper',
      filter_subject: 'asset.results.wallpaper',
      ack_policy: AckPolicy.Explicit,
    });
    // Preserve the deployed legacy durable, including a cursor beyond the new publication.
    await manager.consumers.add('WALLPAPER', {
      durable_name: 'user-wallpaper-ownership',
      filter_subject: 'wallpaper.uploaded',
      ack_policy: AckPolicy.Explicit,
    });
    const url = await publicationServer(`${base}/wallpaper`, natsUrl, defer);
    const ownerHeaders = { authorization: 'Bearer owner', 'content-type': 'application/json' };
    const created = await fetch(`${url}/wallpapers`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'idempotency-key': 'biography' },
      body: '{}',
    });
    expect(created.status).toBe(202);
    const wallpaper = wallpaperView.parse(await created.json());
    let command:
      | { id: string; data: { commandId: string; applicationReference: string } }
      | undefined;
    await expect
      .poll(async () => {
        if ((await protectedManager.streams.info('ASSET_COMMANDS')).state.messages === 0)
          return false;
        command = (
          await protectedManager.streams.getMessage('ASSET_COMMANDS', {
            last_by_subj: 'asset.commands.wallpaper.create',
          })
        ).json();
        return true;
      })
      .toBe(true);
    if (!command) throw new Error('Missing actual Wallpaper command');
    const assetId = 'asset_for_biography';
    await operator.jetstream().publish(
      'asset.results.wallpaper',
      JSON.stringify({
        specversion: '1.0',
        id: 'created_for_biography',
        source: 'https://wallpaperdb/asset',
        type: 'asset.command.result',
        time: occurred,
        datacontenttype: 'application/json',
        causationsource: 'https://wallpaperdb/wallpaper',
        causationid: command.id,
        data: {
          commandId: command.data.commandId,
          applicationReference: command.data.applicationReference,
          outcome: 'created',
          assetId,
        },
      })
    );
    await expect
      .poll(
        async () =>
          wallpaperView.parse(
            await (
              await fetch(`${url}/wallpapers/${wallpaper.wallpaperId}`, { headers: ownerHeaders })
            ).json()
          ).assetId
      )
      .toBe(assetId);
    expect(
      (
        await fetch(`${url}/wallpapers/${wallpaper.wallpaperId}/first-source`, {
          method: 'PUT',
          headers: ownerHeaders,
          body: JSON.stringify({
            candidateId: 'candidate_biography',
            intentId: 'intent_biography',
          }),
        })
      ).status
    ).toBe(202);
    await operator.jetstream().publish(
      'asset.results.wallpaper',
      JSON.stringify({
        specversion: '1.0',
        id: 'source_for_biography',
        source: 'https://wallpaperdb/asset',
        type: 'asset.source.accepted',
        time: occurred,
        datacontenttype: 'application/json',
        causationsource: 'https://wallpaperdb/asset/authors',
        causationid: 'accept_biography',
        correlationid: 'intent_biography',
        data: {
          assetId,
          assetType: 'wallpaper',
          candidateId: 'candidate_biography',
          sourceId: 'source_biography',
          defaultSourceId: 'source_biography',
          initialAnalysisSourceId: 'source_biography',
          sourceSetRevision: '1',
          deliveryRevision: '1',
        },
      })
    );
    await expect.poll(async () => (await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
    const published = await manager.streams.getMessage('WALLPAPER', {
      last_by_subj: 'wallpaper.published',
    });
    const publication = published.json();
    expect(publication).toMatchObject({
      source: 'https://wallpaperdb/wallpaper',
      type: 'wallpaper.published',
      correlationid: wallpaper.wallpaperId,
      causationid: 'source_for_biography',
      causationsource: 'https://wallpaperdb/asset',
      data: {
        wallpaperId: wallpaper.wallpaperId,
        contributorId: 'owner',
        assetId,
        firstSourceId: 'source_biography',
        initialAnalysisSourceId: 'source_biography',
      },
    });
    await connection
      .jetstream()
      .publish('wallpaper.uploaded', JSON.stringify({ ...legacy, eventId: 'already-processed' }));
    const old = await connection.jetstream().consumers.get('WALLPAPER', 'user-wallpaper-ownership');
    const prior = await old.next({ expires: 1000 });
    if (!prior) throw new Error('Missing legacy cursor fixture');
    await prior.ackAck();
    expect(
      (await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).ack_floor.stream_seq
    ).toBeGreaterThan(published.seq);

    const databaseAdapter = databaseLayer({ databaseUrl: `${base}/user` });
    const profileAdapter = profileStoreLayer(profilePolicy).pipe(Layer.provide(databaseAdapter));
    const profiles = profilesLayer(profilePolicy).pipe(
      Layer.provideMerge(
        Layer.merge(
          profileAdapter,
          Layer.succeed(Identities, {
            getIdentity: () =>
              Effect.succeed({ displayName: 'Owner', firstName: null, lastName: null }),
          })
        )
      )
    );
    const eventOptions = {
      url: natsUrl,
      stream: 'WALLPAPER',
      serviceName: 'biography-publication-contract',
      retryDelayMs: 10,
      shutdownTimeoutMs: 1000,
    };
    const brokerAdapter = brokerLayer(eventOptions);
    const maintenance = maintenanceLayer({ retentionDays: 30 }).pipe(
      Layer.provide(
        Layer.mergeAll(
          profiles,
          eventStoreLayer().pipe(Layer.provide(databaseAdapter)),
          eventPublisherLayer({ pictureBucket: 'unused' }).pipe(
            Layer.provide(Layer.merge(databaseAdapter, brokerAdapter))
          )
        )
      )
    );
    const userLayer = Layer.merge(
      profiles,
      ownershipConsumerLayer(eventOptions).pipe(
        Layer.provide(Layer.merge(maintenance, brokerAdapter))
      )
    );
    let user = ManagedRuntime.make(userLayer);
    defer(() => user.dispose());
    await user.runPromise(ConsumerHealth);
    for (const profileId of ['owner', 'foreign'])
      expect(await user.runPromise(Profiles.use((p) => p.ensure({ profileId })))).toMatchObject({
        _tag: 'Success',
      });
    await connection.jetstream().publish('wallpaper.uploaded', JSON.stringify(legacy));
    const legacyBiography = '![Legacy](wallpaper:wlpr_legacy)';
    await expect
      .poll(() =>
        user.runPromise(
          Profiles.use((p) =>
            p.updateDetails({ profileId: 'owner' }, { biographyMarkdown: legacyBiography }, 1)
          )
        )
      )
      .toMatchObject({
        _tag: 'Success',
        profile: { version: 2, biographyMarkdown: legacyBiography },
      });
    const biography = `![New](wallpaper:${wallpaper.wallpaperId})\n\n${legacyBiography}`;
    await expect
      .poll(() =>
        user.runPromise(
          Profiles.use((p) =>
            p.updateDetails({ profileId: 'owner' }, { biographyMarkdown: biography }, 2)
          )
        )
      )
      .toMatchObject({ _tag: 'Success', profile: { version: 3, biographyMarkdown: biography } });
    expect(
      await user.runPromise(
        Profiles.use((p) =>
          p.updateDetails(
            { profileId: 'foreign' },
            { biographyMarkdown: `![Foreign](wallpaper:${wallpaper.wallpaperId})` },
            1
          )
        )
      )
    ).toMatchObject({ _tag: 'Rejected', reason: 'unavailable-biography-wallpaper' });
    expect(
      await user.runPromise(
        Profiles.use((p) => p.updateDetails({ profileId: 'owner' }, { displayName: 'stale' }, 2))
      )
    ).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    await user.dispose();
    user = ManagedRuntime.make(userLayer);
    await user.runPromise(ConsumerHealth);
    const replay = await connection.jetstream().publish('wallpaper.published', published.data);
    await connection.jetstream().publish('wallpaper.uploaded', JSON.stringify(legacy));
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              'SELECT wallpaper_id, profile_id FROM wallpaper_ownership ORDER BY wallpaper_id'
            )
          ).rows
      )
      .toEqual(
        [
          { wallpaper_id: wallpaper.wallpaperId, profile_id: 'owner' },
          { wallpaper_id: 'wlpr_legacy', profile_id: 'owner' },
        ].sort((a, b) => a.wallpaper_id.localeCompare(b.wallpaper_id))
      );
    // Observe durable completion after restart before checking that replay changed no Profile state.
    await expect
      .poll(async () => {
        const consumer = await manager.consumers.info(
          'WALLPAPER',
          'user-wallpaper-publication-ownership'
        );
        return consumer.ack_floor.stream_seq === replay.seq;
      })
      .toBe(true);
    expect(
      await user.runPromise(ProfileStore.use((p) => p.read('owner', new Date())))
    ).toMatchObject({ version: 3, biographyMarkdown: biography });
    expect(
      await user.runPromise(ProfileStore.use((p) => p.read('foreign', new Date())))
    ).toMatchObject({ version: 1, biographyMarkdown: '' });
  } catch (error) {
    errors.push(error);
  } finally {
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Publication/Biography contract or cleanup failed');
});
