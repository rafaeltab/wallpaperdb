import { Effect } from 'effect';
import type { Profile, Variant } from '../catalogue/index.js';

export interface Occurrence {
  readonly source: string;
  readonly id: string;
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

export type ProjectionWrite =
  | { readonly _tag: 'Applied' }
  | { readonly _tag: 'Unchanged' }
  | { readonly _tag: 'Unavailable' }
  | { readonly _tag: 'Rejected' };

/** Each mutation is atomic for its target. Replays do not duplicate variants or reset
 * enrichment; partial enrichment is durable before an upload and stays invisible to
 * catalogue readers until the upload arrives. Profile snapshots only advance version.
 * Complete color snapshots and variants with the same dimensions and format converge by occurrence time
 * and identity while legacy producers lack an entity version. Reads see completed writes. */
export interface ProjectionStore {
  apply(mutation: ProjectionMutation): Effect.Effect<ProjectionWrite>;
}
export const ProjectionStore = Symbol.for('wallpaperdb.gateway.projection.store');

export type ProjectionOutcome =
  | { readonly _tag: 'Completed' }
  | { readonly _tag: 'Ignored' }
  | { readonly _tag: 'Retry' }
  | {
      readonly _tag: 'Rejected';
      readonly reason: 'invalid-color-histogram' | 'invalid-projection';
    };

export interface ProjectCatalogue {
  record(change: ProjectionChange): Effect.Effect<ProjectionOutcome>;
}
export const ProjectCatalogue = Symbol.for('wallpaperdb.gateway.projection.project');

class CatalogueProjection implements ProjectCatalogue {
  constructor(private readonly store: ProjectionStore) {}

  record(change: ProjectionChange): Effect.Effect<ProjectionOutcome> {
    return Effect.gen(this, function* () {
      if (
        change._tag === 'ColorsExtracted' &&
        (change.colorHistogram.length !== 64 ||
          change.colorHistogram.some((value) => !Number.isFinite(value) || value < 0) ||
          !change.colorHistogram.some((value) => value > 0))
      ) {
        return { _tag: 'Rejected', reason: 'invalid-color-histogram' } satisfies ProjectionOutcome;
      }
      const outcome = yield* this.store.apply(toMutation(change));
      switch (outcome._tag) {
        case 'Applied':
          return { _tag: 'Completed' } satisfies ProjectionOutcome;
        case 'Unchanged':
          return { _tag: 'Ignored' } satisfies ProjectionOutcome;
        case 'Unavailable':
          return { _tag: 'Retry' } satisfies ProjectionOutcome;
        case 'Rejected':
          return { _tag: 'Rejected', reason: 'invalid-projection' } satisfies ProjectionOutcome;
      }
    }).pipe(Effect.withSpan('catalogue.project'));
  }
}

function toMutation(change: ProjectionChange): ProjectionMutation {
  switch (change._tag) {
    case 'WallpaperUploaded':
      return { ...change, _tag: 'PublishWallpaper' };
    case 'VariantAvailable':
      return { ...change, _tag: 'PublishVariant' };
    case 'ColorsExtracted':
      return { ...change, _tag: 'PublishColors' };
    case 'ProfilePublished':
      return { ...change, _tag: 'PublishProfile' };
  }
}

export function createProjection(store: ProjectionStore): ProjectCatalogue {
  return new CatalogueProjection(store);
}
