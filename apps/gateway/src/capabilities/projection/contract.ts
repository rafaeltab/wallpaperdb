import { Context, type Effect, Schema } from 'effect';
import type { Profile, Variant } from '../catalogue/index.js';

export interface Occurrence {
  readonly source: string;
  readonly id: string;
  /** Canonical UTC instant: preserve fractional precision, pad to three places, trim further trailing zeros. */
  readonly occurredAt: string;
}

export type ProjectionChange =
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
      readonly _tag: 'ColorsExtracted';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly colorHistogram: number[];
      readonly colorSpace: string;
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
      readonly _tag: 'PublishColors';
      readonly occurrence: Occurrence;
      readonly wallpaperId: string;
      readonly colorHistogram: number[];
      readonly colorSpace: string;
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

/** Each mutation is atomic for its target. Replays do not duplicate variants or reset
 * enrichment; partial enrichment is durable before an upload and stays invisible to
 * catalogue readers until the upload arrives. Profile snapshots only advance version.
 * Complete color snapshots and variants with the same dimensions and format converge by occurrence time
 * and identity while legacy producers lack an entity version. Reads see completed writes. */
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
      readonly reason: 'invalid-color-histogram' | 'invalid-projection';
    };

export interface ProjectCatalogue {
  record(change: ProjectionChange): Effect.Effect<ProjectionOutcome, ProjectionUnavailable>;
}

export const ProjectCatalogue = Context.Service<ProjectCatalogue>(
  'wallpaperdb.gateway.projection.project'
);
