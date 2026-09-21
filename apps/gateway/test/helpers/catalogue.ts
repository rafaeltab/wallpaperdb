import { DateTime, Effect, Layer } from 'effect';
import {
  Catalogue,
  CatalogueRead,
  CatalogueUnavailable,
  CatalogueCursors,
  type CursorValue,
  type Profile,
  type SearchBatch,
  type SearchSelection,
  type Wallpaper,
  catalogueLayer,
  type CatalogueConfig,
} from '../../src/catalogue/index.js';
const timestamp = '2026-01-01T00:00:00.000Z';
export function wallpaper(id: string): Wallpaper {
  return {
    wallpaperId: id,
    profileId: 'profile_one',
    variants: [],
    uploadedAt: timestamp,
    updatedAt: timestamp,
  };
}
export class ReadAdapter implements CatalogueRead {
  selections: SearchSelection[] = [];
  response: SearchBatch = { entries: [], total: 0 };
  wallpapers = new Map<string, Wallpaper>();
  profileSnapshots = new Map<string, Profile>();
  unavailable = false;
  search(selection: SearchSelection) {
    this.selections.push(selection);
    return this.unavailable
      ? Effect.fail(new CatalogueUnavailable({ cause: 'controlled outage' }))
      : Effect.succeed(this.response);
  }
  wallpaper(id: string) {
    return this.read(this.wallpapers.get(id) ?? null);
  }
  profile(id: string) {
    return this.read(this.profileSnapshots.get(id) ?? null);
  }
  profileByHandle(handle: string) {
    return this.read(
      [...this.profileSnapshots.values()].find((profile) => profile.handle === handle) ?? null
    );
  }
  profiles(ids: string[]) {
    return this.read(ids.map((id) => this.profileSnapshots.get(id) ?? null));
  }
  private read<T>(value: T): Effect.Effect<T, CatalogueUnavailable> {
    return this.unavailable
      ? Effect.fail(new CatalogueUnavailable({ cause: 'controlled outage' }))
      : Effect.succeed(value);
  }
}
export class Cursors implements CatalogueCursors {
  values = new Map<string, { values: CursorValue[]; issuedAt: number }>();
  private nextCursor = 0;
  constructor(private readonly expirationMs = 60_000) {}
  readonly encode = Effect.fnUntraced(function* (this: Cursors, values: CursorValue[]) {
    const issuedAt = DateTime.toEpochMillis(yield* DateTime.now);
    const cursor = `cursor_${++this.nextCursor}`;
    this.values.set(cursor, { values: [...values], issuedAt });
    return cursor;
  });
  readonly decode = Effect.fnUntraced(function* (this: Cursors, cursor: string) {
    const entry = this.values.get(cursor);
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (!entry || entry.issuedAt > now || now - entry.issuedAt > this.expirationMs)
      return { _tag: 'InvalidCursor' as const };
    return { _tag: 'Decoded' as const, values: [...entry.values] };
  });
}
export async function setup(config: CatalogueConfig = { colorSpreadStrategy: 'linear' }) {
  const read = new ReadAdapter();
  const cursors = new Cursors();
  const layer = catalogueLayer(config).pipe(
    Layer.provide(
      Layer.mergeAll(Layer.succeed(CatalogueRead, read), Layer.succeed(CatalogueCursors, cursors))
    )
  );
  return {
    read,
    cursors,
    catalogue: await Effect.runPromise(Effect.service(Catalogue).pipe(Effect.provide(layer))),
  };
}
