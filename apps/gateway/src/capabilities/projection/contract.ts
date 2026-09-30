import { Context, type Effect, Schema } from 'effect';
import type { ColorDescriptor, Profile, Variant } from '../catalogue/index.js';

export interface Occurrence {
  readonly source: string;
  readonly id: string;
  /** Canonical UTC instant: preserve fractional precision, pad to three places, trim further trailing zeros. */
  readonly occurredAt: string;
}

export type ProjectionChange =
  | {
      readonly _tag: 'ColorsMeasured';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly descriptor: ColorDescriptor;
      readonly original: { readonly owner: 'ingestor'; readonly id: string };
      readonly provenance: {
        readonly referenceCommit: string;
        readonly anchorsSha256: string;
        readonly originalSha256: string;
      };
    }
  | {
      readonly _tag: 'WallpaperUploaded';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly profileId: string;
      readonly uploadedAt: string;
    }
  | {
      readonly _tag: 'VariantAvailable';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly variant: Variant;
    }
  | {
      readonly _tag: 'ProfilePublished';
      readonly occurrence: Occurrence;
      readonly profile: Profile;
    };

export type ProjectionMutation =
  | {
      readonly _tag: 'PublishWallpaper';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly profileId: string;
      readonly uploadedAt: string;
    }
  | {
      readonly _tag: 'PublishVariant';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly variant: Variant;
    }
  | {
      readonly _tag: 'PublishMeasurements';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly descriptor: ColorDescriptor;
      readonly original: { readonly owner: 'ingestor'; readonly id: string };
      readonly provenance: {
        readonly referenceCommit: string;
        readonly anchorsSha256: string;
        readonly originalSha256: string;
      };
    }
  | { readonly _tag: 'PublishProfile'; readonly occurrence: Occurrence; readonly profile: Profile };

export class ProjectionUnavailable extends Schema.TaggedError<ProjectionUnavailable>()(
  'ProjectionUnavailable',
  { cause: Schema.Defect() }
) {}

export type ProjectionWrite =
  | { readonly _tag: 'Applied' }
  | { readonly _tag: 'Unchanged' }
  | { readonly _tag: 'Rejected' };

/** Each target mutation is atomic. A complete compatible utility bank and its readiness
 * marker commit together with the measurement snapshot. Metadata updates preserve the
 * entire bank, including values unavailable in stored source. Replays never reset
 * enrichment; enrichment before upload is durable but invisible to Catalogue readers.
 * Colors and variants converge by precise occurrence time and identity. Profile
 * snapshots only advance version. Reads see completed writes. Independent target
 * documents and the broker acknowledgement do not share a transaction. */
export interface ProjectionStore {
  apply(mutation: ProjectionMutation): Effect.Effect<ProjectionWrite, ProjectionUnavailable>;
}

export const ProjectionStore = Context.Service<ProjectionStore>(
  'wallpaperdb.gateway.projection.store'
);

export type ProjectionOutcome =
  | { readonly _tag: 'Completed' }
  | { readonly _tag: 'Ignored' }
  | {
      readonly _tag: 'Rejected';
      readonly reason: 'incompatible-color-measurements' | 'invalid-projection';
    };

export interface ProjectCatalogue {
  record(change: ProjectionChange): Effect.Effect<ProjectionOutcome, ProjectionUnavailable>;
}

export const ProjectCatalogue = Context.Service<ProjectCatalogue>(
  'wallpaperdb.gateway.projection.project'
);
