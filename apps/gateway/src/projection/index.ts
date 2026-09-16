import { Context, Effect, Layer, Schema } from 'effect';
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

const validHistogram = Schema.is(
  Schema.Array(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))).check(
    Schema.isLengthBetween(64, 64),
    Schema.makeFilter((values) => values.some((value) => value > 0))
  )
);

export const projectionLayer: Layer.Layer<ProjectCatalogue, never, ProjectionStore> = Layer.effect(
  ProjectCatalogue,
  Effect.gen(function* () {
    const store = yield* ProjectionStore;
    const record = Effect.fn('catalogue.project')(function* (
      change: ProjectionChange
    ): Effect.fn.Return<ProjectionOutcome, ProjectionUnavailable> {
      if (change._tag === 'ColorsExtracted' && !validHistogram(change.colorHistogram)) {
        return { _tag: 'Rejected', reason: 'invalid-color-histogram' } satisfies ProjectionOutcome;
      }
      const outcome = yield* store.apply(toMutation(change));
      switch (outcome._tag) {
        case 'Applied':
          return { _tag: 'Completed' } satisfies ProjectionOutcome;
        case 'Unchanged':
          return { _tag: 'Ignored' } satisfies ProjectionOutcome;
        case 'Rejected':
          return { _tag: 'Rejected', reason: 'invalid-projection' } satisfies ProjectionOutcome;
      }
    });
    return ProjectCatalogue.of({ record });
  })
);

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
