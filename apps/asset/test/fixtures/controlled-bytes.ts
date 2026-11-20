import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { SourceFailure, type SourceBytesPort } from '../../src/capabilities/sources/index.js';
export function controlledBytes(): SourceBytesPort {
  const stored = new Map<string, Uint8Array>();
  const write = (id: string, bytes: Uint8Array, digest: string) => {
    if (createHash('sha256').update(bytes).digest('hex') !== digest)
      throw new Error('Digest mismatch');
    const prior = stored.get(id);
    if (prior && !Buffer.from(prior).equals(bytes)) throw new Error('Immutable conflict');
    stored.set(id, bytes.slice());
  };
  const sourceKey = (asset: string, source: string) => JSON.stringify([asset, source]);
  return {
    put: (id, bytes, digest) =>
      Effect.try({
        try: () => write(id, bytes, digest),
        catch: (cause) => new SourceFailure({ operation: 'put', cause }),
      }),
    prepare: (candidate, source, asset, facts) =>
      Effect.try({
        try: () => {
          const bytes = stored.get(candidate);
          if (!bytes) throw new Error('Missing candidate');
          write(sourceKey(asset, source), bytes, facts.digest);
        },
        catch: (cause) => new SourceFailure({ operation: 'prepare', cause }),
      }),
    read: (source, asset) =>
      Effect.suspend(() => {
        const bytes = stored.get(sourceKey(asset, source));
        if (!bytes) return Effect.fail(new SourceFailure({ operation: 'read', cause: null }));
        let closed = false;
        let finish!: () => void;
        const ended = new Promise<void>((resolve) => {
          finish = resolve;
        });
        return Effect.succeed({
          bytes: (async function* () {
            try {
              if (!closed) yield bytes.slice();
            } finally {
              closed = true;
              finish();
            }
          })(),
          close: () =>
            Effect.sync(() => {
              closed = true;
              finish();
            }),
          closed: Effect.promise(() => ended),
        });
      }),
  };
}
