import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { recover } from '../src/capabilities/restack/index.js';

it.each(['SIMPLE', 'COMPLEX', undefined] as const)(
  'gates %s conflict resolution on its required verification',
  async (classification) => {
    let reviewed = false;
    let ci = false;
    const calls: string[] = [];
    const ports = {
      resolve: () => Effect.succeed({ classification, commit: 'resolved', progress: 'resolving' }),
      review: () => {
        calls.push('review');
        return Effect.succeed(reviewed);
      },
      verify: () => {
        calls.push('ci');
        return Effect.succeed(ci);
      },
    };
    expect((await Effect.runPromise(recover(ports))).ready).toBe(false);
    expect(calls).toEqual(
      classification === 'SIMPLE' ? ['ci'] : classification === 'COMPLEX' ? ['review'] : []
    );
    reviewed = true;
    calls.length = 0;
    expect((await Effect.runPromise(recover(ports))).ready).toBe(false);
    expect(calls).toEqual(
      classification === 'COMPLEX' ? ['review', 'ci'] : classification === 'SIMPLE' ? ['ci'] : []
    );
    ci = true;
    expect((await Effect.runPromise(recover(ports))).ready).toBe(Boolean(classification));
  }
);
