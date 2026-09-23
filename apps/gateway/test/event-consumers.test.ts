import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { deliverProjection } from '../src/adapters/events/index.js';
import {
  ProjectCatalogue,
  ProjectionUnavailable,
  type ProjectionChange,
  type ProjectionOutcome,
} from '../src/projection/index.js';

const timestamp = '2026-01-01T00:00:00.000Z';
const base = { eventId: 'event-1', timestamp };
const snapshot = {
  id: 'profile-1',
  displayName: 'Profile',
  handle: 'profile',
  biographyMarkdown: '',
  pictureAssetId: null,
  claimGeneration: 1,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const upload = {
  ...base,
  eventType: 'wallpaper.uploaded',
  wallpaper: {
    id: 'wallpaper-1',
    userId: 'profile-1',
    fileType: 'image',
    mimeType: 'image/jpeg',
    fileSizeBytes: 1000,
    width: 1920,
    height: 1080,
    aspectRatio: 1920 / 1080,
    storageKey: 'private/key',
    storageBucket: 'private-bucket',
    originalFilename: 'private-filename',
    uploadedAt: timestamp,
  },
};
const variant = {
  ...base,
  eventType: 'wallpaper.variant.available',
  variant: {
    wallpaperId: 'wallpaper-1',
    width: 1920,
    height: 1080,
    aspectRatio: 1920 / 1080,
    format: 'image/jpeg',
    fileSizeBytes: 1000,
    createdAt: timestamp,
  },
};
const colors = {
  ...base,
  eventType: 'wallpaper.colors.extracted',
  wallpaperId: 'wallpaper-1',
  colorHistogram: Array(64).fill(1),
  colorSpace: 'hsv',
};
const created = {
  ...base,
  eventType: 'profile.created',
  change: { type: 'created' },
  profile: snapshot,
};
const updated = {
  ...base,
  eventType: 'profile.updated',
  change: { type: 'display-name-changed', before: 'Before', after: 'Profile' },
  profile: { ...snapshot, version: 2 },
};

class ControlledProjection implements ProjectCatalogue {
  readonly changes: ProjectionChange[] = [];
  constructor(
    private readonly outcome: ProjectionOutcome | ProjectionUnavailable = { _tag: 'Completed' }
  ) {}
  record(change: ProjectionChange): Effect.Effect<ProjectionOutcome, ProjectionUnavailable> {
    return Effect.suspend(() => {
      this.changes.push(change);
      return this.outcome instanceof ProjectionUnavailable
        ? Effect.fail(this.outcome)
        : Effect.succeed(this.outcome);
    });
  }
}
function deliver(subject: string, data: unknown, project: ProjectCatalogue, attempt = 1) {
  return Effect.runPromise(
    deliverProjection({
      subject,
      payload: new TextEncoder().encode(JSON.stringify(data)),
      attempt,
    }).pipe(Effect.provideService(ProjectCatalogue, project))
  );
}

describe('Projection event driving adapter contract', () => {
  it('translates uploads into local ownership and stable occurrence without passing storage metadata inward', async () => {
    const project = new ControlledProjection();
    expect(await deliver(upload.eventType, upload, project)).toEqual({ _tag: 'Completed' });
    expect(project.changes).toEqual([
      {
        _tag: 'WallpaperUploaded',
        wallpaperId: 'wallpaper-1',
        profileId: 'profile-1',
        uploadedAt: timestamp,
        occurrence: { source: 'wallpaperdb/ingestor', id: 'event-1', occurredAt: timestamp },
      },
    ]);
  });

  it('translates variant contracts into a gateway-owned variant snapshot', async () => {
    const project = new ControlledProjection();
    await deliver(variant.eventType, variant, project);
    expect(project.changes).toEqual([
      {
        _tag: 'VariantAvailable',
        wallpaperId: 'wallpaper-1',
        variant: {
          width: 1920,
          height: 1080,
          aspectRatio: 1920 / 1080,
          format: 'image/jpeg',
          fileSizeBytes: 1000,
          createdAt: timestamp,
        },
        occurrence: { source: 'wallpaperdb/media', id: 'event-1', occurredAt: timestamp },
      },
    ]);
  });

  it('translates colors into a local complete histogram snapshot', async () => {
    const project = new ControlledProjection();
    await deliver(colors.eventType, colors, project);
    expect(project.changes).toEqual([
      {
        _tag: 'ColorsExtracted',
        wallpaperId: 'wallpaper-1',
        colorHistogram: Array(64).fill(1),
        colorSpace: 'hsv',
        occurrence: { source: 'wallpaperdb/color-extractor', id: 'event-1', occurredAt: timestamp },
      },
    ]);
  });

  it.each([
    created,
    updated,
  ])('translates profile facts into complete local snapshots', async (event) => {
    const project = new ControlledProjection();
    await deliver(event.eventType, event, project);
    expect(project.changes).toEqual([
      {
        _tag: 'ProfilePublished',
        profile: event.profile,
        occurrence: { source: 'wallpaperdb/profile', id: 'event-1', occurredAt: timestamp },
      },
    ]);
  });

  it.each([
    {
      change: {
        type: 'profile-details-changed',
        before: { displayName: 'Before', biographyMarkdown: '' },
        after: {
          displayName: 'Profile',
          biographyMarkdown: '  # About\n\nAuthored **Markdown**\n',
        },
      },
      fields: { biographyMarkdown: '  # About\n\nAuthored **Markdown**\n' },
    },
    {
      change: { type: 'biography-changed', before: '# Old biography', after: '' },
      fields: { biographyMarkdown: '' },
    },
    ...['upload', 'clerk-import'].map((source) => ({
      change: {
        type: 'picture-changed',
        before: 'previous-picture',
        after: 'public-picture',
        source,
        asset: {
          id: 'public-picture',
          storageBucket: 'private-profile-pictures',
          storageKey: 'private/picture.webp',
          mimeType: 'image/webp',
          width: 256,
          height: 256,
          fileSizeBytes: 1024,
        },
      },
      fields: { pictureAssetId: 'public-picture' },
    })),
    {
      change: {
        type: 'picture-changed',
        before: 'public-picture',
        after: null,
        source: 'remove',
        asset: null,
      },
      fields: { pictureAssetId: null },
    },
    {
      change: {
        type: 'handle-changed',
        before: 'former',
        after: 'profile',
        scheduledAliases: [{ handle: 'former', expiresAt: '2026-02-01T00:00:00.000Z' }],
      },
      fields: {
        aliases: [
          {
            handle: 'former',
            claimGeneration: 1,
            createdAt: timestamp,
            expiresAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
    },
    {
      change: {
        type: 'alias-expiry-scheduled',
        handle: 'former',
        before: null,
        after: '2026-02-01T00:00:00.000Z',
      },
      fields: {
        aliases: [
          {
            handle: 'former',
            claimGeneration: 1,
            createdAt: timestamp,
            expiresAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      },
    },
    {
      change: {
        type: 'alias-reactivated',
        handle: 'former',
        claimGeneration: 2,
        before: '2026-02-01T00:00:00.000Z',
        after: null,
      },
      fields: {
        aliases: [{ handle: 'former', claimGeneration: 2, createdAt: timestamp, expiresAt: null }],
      },
    },
    ...['scheduled', 'immediate'].map((reason) => ({
      change: {
        type: 'alias-expired',
        handle: 'former',
        claimGeneration: 1,
        before: '2026-02-01T00:00:00.000Z',
        after: null,
        reason,
      },
      fields: { aliases: [] },
    })),
  ])('projects a $change.type snapshot without event-only metadata', async ({ change, fields }) => {
    const project = new ControlledProjection();
    const profile = { ...snapshot, ...fields, version: 2 };
    const event = { ...base, eventType: 'profile.updated', change, profile };
    expect(await deliver(event.eventType, event, project)).toEqual({ _tag: 'Completed' });
    expect(project.changes).toEqual([
      {
        _tag: 'ProfilePublished',
        profile,
        occurrence: { source: 'wallpaperdb/profile', id: 'event-1', occurredAt: timestamp },
      },
    ]);
  });

  it('continues to accept historical profile-created events while stripping obsolete fields', async () => {
    const project = new ControlledProjection();
    await deliver(
      'profile.created',
      {
        ...base,
        eventType: 'profile.created',
        profile: { ...snapshot, legacyEmail: 'private@example.com' },
      },
      project
    );
    expect(project.changes[0]).toEqual({
      _tag: 'ProfilePublished',
      profile: snapshot,
      occurrence: { source: 'wallpaperdb/profile', id: 'event-1', occurredAt: timestamp },
    });
  });

  it('accepts CloudEvents 1.0 and preserves the producer source plus occurrence identity', async () => {
    const project = new ControlledProjection();
    const event = {
      specversion: '1.0',
      id: 'cloud-1',
      source: '/contexts/profile',
      type: 'profile.created',
      time: timestamp,
      correlationid: 'workflow-1',
      causationid: 'cause-1',
      data: { profile: snapshot, change: { type: 'created' } },
    };
    await deliver(event.type, event, project);
    expect(project.changes[0]).toEqual({
      _tag: 'ProfilePublished',
      profile: snapshot,
      occurrence: { source: '/contexts/profile', id: 'cloud-1', occurredAt: timestamp },
    });
    await deliver(
      event.type,
      { ...event, correlationid: undefined, causationid: undefined },
      project
    );
    expect(project.changes[1]).toEqual(project.changes[0]);
  });

  it.each([
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T02:00:00.000+02:00',
    '2025-12-31T18:30:00.000-05:30',
    '2026-01-01t00:00:00z',
  ])('normalizes the CloudEvent occurrence time %s before payload validation', async (time) => {
    const project = new ControlledProjection();
    const event = {
      specversion: '1.0',
      id: 'cloud-1',
      source: '/contexts/profile',
      type: 'profile.created',
      time,
      data: { profile: snapshot, change: { type: 'created' } },
    };
    expect(await deliver(event.type, event, project)).toEqual({ _tag: 'Completed' });
    expect(project.changes).toEqual([
      {
        _tag: 'ProfilePublished',
        profile: snapshot,
        occurrence: { source: '/contexts/profile', id: 'cloud-1', occurredAt: timestamp },
      },
    ]);
  });

  it.each([
    '2026-01-01T00:00:00.123100Z',
    '2026-01-01T02:00:00.1231+02:00',
    '2025-12-31T18:30:00.123100000-05:30',
  ])('preserves fractional occurrence precision when normalizing %s', async (time) => {
    const project = new ControlledProjection();
    const event = {
      specversion: '1.0',
      id: 'precise-event',
      source: '/contexts/colors',
      type: colors.eventType,
      time,
      data: colors,
    };
    expect(await deliver(event.type, event, project)).toEqual({ _tag: 'Completed' });
    expect(project.changes[0]?.occurrence.occurredAt).toBe('2026-01-01T00:00:00.1231Z');
  });

  it('preserves precise legacy occurrences and equivalent trailing zeros', async () => {
    const project = new ControlledProjection();
    for (const time of ['2026-01-01T00:00:00.123100Z', '2026-01-01T00:00:00.1231Z']) {
      expect(await deliver(colors.eventType, { ...colors, timestamp: time }, project)).toEqual({
        _tag: 'Completed',
      });
    }
    expect(project.changes[0]).toEqual(project.changes[1]);
    expect(project.changes[0]?.occurrence.occurredAt).toBe('2026-01-01T00:00:00.1231Z');
  });

  it.each([
    'invalid',
    '2026-01-01',
    '2026-01-01T00:00:00',
    '2026-01-01T00:00:00+0200',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:00+24:00',
    '2026-01-01T00:00:00+02:60',
    '2026-02-30T00:00:00+02:00',
    '1900-02-29T00:00:00-05:00',
  ])('rejects malformed CloudEvent occurrence time %s before calling the port', async (time) => {
    const project = new ControlledProjection();
    const event = {
      specversion: '1.0',
      id: 'cloud-1',
      source: '/contexts/profile',
      type: 'profile.created',
      time,
      data: { profile: snapshot, change: { type: 'created' } },
    };
    expect(await deliver(event.type, event, project)).toEqual({ _tag: 'Invalid' });
    expect(project.changes).toEqual([]);
  });

  it('accepts a CloudEvent leap day without changing the legacy UTC-only timestamp contract', async () => {
    const project = new ControlledProjection();
    const event = {
      specversion: '1.0',
      id: 'cloud-1',
      source: '/contexts/profile',
      type: 'profile.created',
      time: '2000-02-29T02:00:00+02:00',
      data: { profile: snapshot, change: { type: 'created' } },
    };
    expect(await deliver(event.type, event, project)).toEqual({ _tag: 'Completed' });
    expect(project.changes[0]?.occurrence.occurredAt).toEqual('2000-02-29T00:00:00.000Z');
    expect(await deliver(upload.eventType, { ...upload, timestamp: event.time }, project)).toEqual({
      _tag: 'Invalid',
    });
    expect(project.changes).toHaveLength(1);
  });

  it.each([
    null,
    {},
    { ...upload, timestamp: 'invalid' },
    { ...upload, eventType: 'unexpected' },
    { ...upload, wallpaper: { ...upload.wallpaper, width: -1 } },
    { specversion: '0.3', ...upload },
  ])('rejects malformed external data before calling the driving port', async (data) => {
    const project = new ControlledProjection();
    expect(await deliver(upload.eventType, data, project)).toEqual({ _tag: 'Invalid' });
    expect(project.changes).toEqual([]);
  });

  it('rejects invalid JSON before calling the driving port', async () => {
    const project = new ControlledProjection();
    expect(
      await Effect.runPromise(
        deliverProjection({
          subject: upload.eventType,
          payload: new TextEncoder().encode('{'),
          attempt: 1,
        }).pipe(Effect.provideService(ProjectCatalogue, project))
      )
    ).toEqual({ _tag: 'Invalid' });
    expect(project.changes).toEqual([]);
  });

  it('rejects a valid message on the wrong broker subject', async () => {
    const project = new ControlledProjection();
    expect(await deliver('profile.created', upload, project)).toEqual({ _tag: 'Invalid' });
    expect(project.changes).toEqual([]);
  });

  it.each<ProjectionOutcome>([
    { _tag: 'Completed' },
    { _tag: 'Ignored' },
    { _tag: 'Rejected', reason: 'invalid-projection' },
  ])('preserves application outcome classification for broker acknowledgement', async (outcome) => {
    expect(await deliver(upload.eventType, upload, new ControlledProjection(outcome))).toEqual(
      outcome
    );
  });

  it('translates a technical projection failure into a broker retry', async () => {
    const project = new ControlledProjection(
      new ProjectionUnavailable({ cause: new Error('store unavailable') })
    );
    expect(await deliver(upload.eventType, upload, project)).toEqual({ _tag: 'Retry' });
    expect(project.changes).toHaveLength(1);
  });

  it('exhausts transient processing on the fourth delivery', async () => {
    const project = new ControlledProjection(
      new ProjectionUnavailable({ cause: new Error('store unavailable') })
    );
    expect(await deliver(upload.eventType, upload, project, 4)).toEqual({ _tag: 'Exhausted' });
    expect(project.changes).toHaveLength(1);
  });

  it('does not repeat application work when quarantine must be retried after exhaustion', async () => {
    const project = new ControlledProjection(
      new ProjectionUnavailable({ cause: new Error('store unavailable') })
    );
    expect(await deliver(upload.eventType, upload, project, 5)).toEqual({ _tag: 'Exhausted' });
    expect(project.changes).toEqual([]);
  });
});
