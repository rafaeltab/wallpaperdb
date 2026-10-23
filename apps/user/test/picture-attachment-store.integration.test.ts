import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Layer, ManagedRuntime } from 'effect';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProfileStore } from '../src/capabilities/profile/index.js';
import { profileStoreLayer } from '../src/adapters/profiles/index.js';
import { runAttachmentOperator } from '../scripts/attachment-operator.js';
import { profilePolicy } from './helpers/profiles.js';
import { databaseLayer } from '../src/adapters/database/index.js';
import { attachmentPostgresLayer } from '../src/adapters/picture-attachments/store.js';
import {
  AttachmentDelivery,
  PictureAttachments,
  pictureAttachmentsLayer,
  type PictureAttachment,
} from '../src/capabilities/picture-attachments/index.js';
describe('PostgreSQL picture attachment contract', () => {
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let runtime: ManagedRuntime.ManagedRuntime<PictureAttachments | AttachmentDelivery, unknown>;
  let databaseUrl: string;
  const layer = () => {
    const store = attachmentPostgresLayer({ maxAttempts: 2, retryDelayMs: 1, leaseMs: 1000 }).pipe(
      Layer.provide(databaseLayer({ databaseUrl }))
    );
    return pictureAttachmentsLayer.pipe(Layer.provideMerge(store));
  };
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    databaseUrl = container.getConnectionUri().replace('localhost', '127.0.0.1');
    sql = postgres(databaseUrl);
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(migrations)
      .filter((n) => n.endsWith('.sql'))
      .sort())
      await sql.unsafe(readFileSync(new URL(name, migrations), 'utf8'));
    runtime = ManagedRuntime.make(layer());
  });
  beforeEach(async () => {
    await sql`truncate profiles,handle_claims,outbox_events cascade`;
    await sql`truncate picture_attachment_quarantine`;
    await sql`insert into profiles(id,display_name,handle) values ('owner','Owner','owner')`;
    await sql`insert into handle_claims(handle,profile_id,kind) values ('owner','owner','profile')`;
  });
  afterAll(async () => {
    await runtime?.dispose();
    await sql?.end();
    await container?.stop();
  });
  const begin = async (key = 'first') => {
    const result = await runtime.runPromise(
      PictureAttachments.use((s) => s.begin({ profileId: 'owner' }, key, 1))
    );
    if (result.kind !== 'attachment') throw new Error(result.kind);
    return result.attachment;
  };
  const created = (i: PictureAttachment, assetId = 'asset-A') =>
    runtime.runPromise(
      PictureAttachments.use((s) =>
        s.assetResult({
          attachmentId: i.id,
          commandId: i.commandId,
          causationId: i.creationEventId,
          outcome: 'created',
          assetId,
        })
      )
    );
  const confirm = (i: PictureAttachment) =>
    runtime.runPromise(
      PictureAttachments.use((s) =>
        s.sourceAccepted({
          assetId: i.assetId ?? 'asset-A',
          candidateId: 'candidate-A',
          intentId: 'edit-A',
          sourceId: 'source-A',
          defaultSourceId: 'source-A',
          initialAnalysisSourceId: 'source-A',
          occurrenceId: 'accepted-A',
        })
      )
    );
  const register = (i: PictureAttachment) =>
    runtime.runPromise(
      PictureAttachments.use((s) =>
        s.expectSource({ profileId: 'owner' }, i.id, {
          candidateId: 'candidate-A',
          intentId: 'edit-A',
        })
      )
    );
  it('atomically reserves command identity, replays through restart and attaches only after the required registered Source', async () => {
    const [a, b] = await Promise.all([begin(), begin()]);
    expect(a.id).toBe(b.id);
    expect(await sql`select count(*)::int as count from picture_attachment_outbox`).toEqual([
      { count: 1 },
    ]);
    await created(a);
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: null, version: 1 },
    ]);
    await register(a);
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    expect(await confirm(a)).toBe('applied');
    expect(await confirm(a)).toBe('ignored');
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: 'asset-A', version: 2 },
    ]);
    const events = await sql`select payload from outbox_events`;
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      profile: { pictureAssetId: 'asset-A', version: 2 },
      change: { type: 'picture-changed', after: 'asset-A', asset: null },
    });
  });
  it('rolls back the intent and Profile together when its event cannot commit', async () => {
    const i = await begin();
    await created(i);
    await register(i);
    await sql.unsafe(
      `create function reject_attachment_event() returns trigger language plpgsql as $$ begin raise exception 'intentional event failure'; end $$`
    );
    await sql.unsafe(
      'create trigger reject_attachment_event before insert on outbox_events for each row execute function reject_attachment_event()'
    );
    try {
      await expect(confirm(i)).rejects.toMatchObject({ _tag: 'AttachmentFailure' });
      expect(await sql`select picture_asset_id,version from profiles`).toEqual([
        { picture_asset_id: null, version: 1 },
      ]);
      expect(
        await runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)))
      ).toMatchObject({ kind: 'attachment', attachment: { state: 'accepting-source' } });
    } finally {
      await sql.unsafe(
        'drop trigger reject_attachment_event on outbox_events;drop function reject_attachment_event()'
      );
    }
    expect(await confirm(i)).toBe('applied');
  });
  it('recovers exhausted duplicate Source confirmation without leaving completed attachment in attention', async () => {
    const i = await begin();
    await created(i);
    await register(i);
    expect(await confirm(i)).toBe('applied');
    const payload = JSON.stringify({
      specversion: '1.0',
      id: 'accepted-A',
      source: 'https://wallpaperdb/asset',
      type: 'asset.source.accepted',
      time: '2026-10-23T00:00:00.000Z',
      datacontenttype: 'application/json',
      causationsource: 'https://wallpaperdb/asset/authors',
      causationid: 'accept-A',
      correlationid: 'edit-A',
      data: {
        assetId: 'asset-A',
        assetType: 'picture',
        candidateId: 'candidate-A',
        sourceId: 'source-A',
        defaultSourceId: 'source-A',
        initialAnalysisSourceId: 'source-A',
        sourceSetRevision: '1',
        deliveryRevision: '1',
      },
    });
    const quarantine = () =>
      runtime.runPromise(
        AttachmentDelivery.use((d) =>
          d.quarantine('duplicate-source-A', payload, 'confirmation-exhausted', {
            kind: 'asset',
            id: 'asset-A',
          })
        )
      );
    const status = () =>
      runtime.runPromise(PictureAttachments.use((s) => s.get({ profileId: 'owner' }, i.id)));
    await quarantine();
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { state: 'attached', attentionRequired: true },
    });
    const alert = (await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).find(
      (a) => a.scope === 'confirmation'
    );
    if (!alert) throw new Error('Missing exhausted confirmation alert');
    expect(
      await runAttachmentOperator(['recover-confirmation', alert.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { state: 'attached', attentionRequired: false },
    });
    await quarantine();
    expect(await status()).toMatchObject({
      kind: 'attachment',
      attachment: { state: 'attached', attentionRequired: false },
    });
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toEqual([]);
    expect(
      await runAttachmentOperator(['recover-confirmation', alert.id], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: false });
    expect(await sql`select picture_asset_id,version from profiles`).toEqual([
      { picture_asset_id: 'asset-A', version: 2 },
    ]);
    expect(await sql`select count(*)::int as count from outbox_events`).toEqual([{ count: 1 }]);
  });
  it('serializes cancellation and late creation with one exact durable orphan-delete command', async () => {
    const i = await begin();
    await runtime.runPromise(PictureAttachments.use((s) => s.cancel({ profileId: 'owner' }, i.id)));
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    await created(i);
    await created(i);
    const commands =
      await sql`select event from picture_attachment_outbox where destination='asset-delete'`;
    expect(commands).toHaveLength(1);
    expect(commands[0].event).toMatchObject({
      id: i.deletionEventId,
      source: 'https://wallpaperdb/user',
      type: 'asset.command.delete',
      data: { commandId: i.deleteCommandId, applicationReference: i.id, assetId: 'asset-A' },
    });
    expect(await sql`select picture_asset_id from profiles`).toEqual([{ picture_asset_id: null }]);
  });
  it('commits conflict fencing and orphan deletion when a Profile edit wins without another attachment request', async () => {
    const i = await begin();
    await created(i);
    const profileRuntime = ManagedRuntime.make(
      profileStoreLayer(profilePolicy).pipe(Layer.provide(databaseLayer({ databaseUrl })))
    );
    try {
      await profileRuntime.runPromise(
        ProfileStore.use((s) =>
          s.transact({ profileId: 'owner', now: new Date() }, () => ({
            _tag: 'Change',
            mutation: {
              type: 'details',
              displayName: 'New name',
              biographyMarkdown: 'Changed Biography',
            },
          }))
        )
      );
    } finally {
      await profileRuntime.dispose();
    }
    const intents = await sql`select state from picture_attachment_intents where id=${i.id}`;
    expect(intents[0].state).toMatchObject({
      state: 'conflicted',
      deletion: 'pending',
      assetId: 'asset-A',
    });
    expect(
      await sql`select count(*)::int as count from picture_attachment_outbox where destination='asset-delete'`
    ).toEqual([{ count: 1 }]);
  });
  it('counts abandoned publication leases toward the same finite retry budget', async () => {
    const i = await begin();
    const claim = () => runtime.runPromise(AttachmentDelivery.use((d) => d.claim()));
    expect((await claim())[0]?.id).toBe(i.creationEventId);
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second'`;
    expect((await claim())[0]?.attempts).toBe(1);
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second'`;
    expect(await claim()).toEqual([]);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toContainEqual({
      id: i.creationEventId,
      scope: 'outbox',
      reason: 'exhausted',
    });
  });
  it('leases finite publication attempts and makes quarantine available for deliberate recovery', async () => {
    const i = await begin();
    const claim = () => runtime.runPromise(AttachmentDelivery.use((d) => d.claim()));
    const first = (await claim())[0];
    if (!first) throw new Error('missing claim');
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(first)));
    await sql`update picture_attachment_outbox set available_at=now()-interval '1 second' where id=${first.id}`;
    const second = (await claim())[0];
    if (!second) throw new Error('missing retry');
    expect(second.id).toBe(i.creationEventId);
    await runtime.runPromise(AttachmentDelivery.use((d) => d.failed(second)));
    expect(await claim()).toEqual([]);
    expect(await runtime.runPromise(AttachmentDelivery.use((d) => d.alerts()))).toContainEqual({
      id: i.creationEventId,
      scope: 'outbox',
      reason: 'exhausted',
    });
    expect(
      await runAttachmentOperator(['recover-outbox', i.creationEventId], {
        databaseUrl,
        maxAttempts: 2,
        retryDelayMs: 1,
      })
    ).toEqual({ recovered: true });
    const recovered = (await claim())[0];
    expect(recovered?.event).toEqual(first.event);
    expect(recovered?.attempts).toBe(0);
  });
});
