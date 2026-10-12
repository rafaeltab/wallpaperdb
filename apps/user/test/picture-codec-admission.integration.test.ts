import childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Effect, Fiber } from 'effect';
import { expect, it, vi } from 'vitest';
import { pictureCodecLayer } from '../src/adapters/pictures/index.js';
import { PictureCodec, type EffectivePicturePolicy } from '../src/capabilities/pictures/index.js';

const input = readFileSync(new URL('./fixtures/profile-disposal.gif', import.meta.url));
const policy: EffectivePicturePolicy = {
  output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
  maxOutputBytes: 5242880,
  acceptedSourceFormats: ['image/gif'],
  animation: { available: true },
  encoding: { staticQuality: 85, animationQuality: 85 },
};

it.each([
  { decodedMiB: 512, children: 1 },
  { decodedMiB: 128, children: 2 },
])('bounds native admission for a $decodedMiB MiB decode ceiling', async ({
  decodedMiB,
  children,
}) => {
  const realSpawn = childProcess.spawn;
  let first: childProcess.ChildProcess | undefined;
  let firstClosed = false;
  const overlap: boolean[] = [];
  const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation((...args) => {
    const child = realSpawn(...args);
    if (!first) {
      first = child;
      child.kill('SIGSTOP');
      child.once('close', () => {
        firstClosed = true;
      });
    } else if (children === 1) {
      overlap.push(!firstClosed);
    }
    return child;
  });
  syncBuiltinESMExports();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const codec = yield* PictureCodec;
        const running = yield* Effect.forkChild(codec.process(input, policy), {
          startImmediately: true,
        });
        const queued = yield* Effect.forkChild(codec.process(input, policy), {
          startImmediately: true,
        });
        expect(spawn).toHaveBeenCalledTimes(children);
        if (!first) throw new Error('Missing encoder process');
        first.kill('SIGCONT');
        expect((yield* Fiber.join(running))._tag).toBe('Processed');
        expect((yield* Fiber.join(queued))._tag).toBe('Processed');
        expect(spawn).toHaveBeenCalledTimes(2);
        if (children === 1) expect(overlap).toEqual([false]);
      }).pipe(
        Effect.provide(
          pictureCodecLayer({
            maxBytes: 5242880,
            maxPixels: 16000000,
            maxDecodedBytes: decodedMiB * 1024 * 1024,
          })
        )
      )
    );
  } finally {
    spawn.mockRestore();
    syncBuiltinESMExports();
  }
});

it.each([
  'running',
  'queued',
])('releases admission after interrupting a %s 512 MiB job', async (interrupted) => {
  const realSpawn = childProcess.spawn;
  let first: childProcess.ChildProcess | undefined;
  let firstClosed = false;
  const overlap: boolean[] = [];
  const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation((...args) => {
    const child = realSpawn(...args);
    if (!first) {
      first = child;
      child.kill('SIGSTOP');
      child.once('close', () => {
        firstClosed = true;
      });
    } else {
      overlap.push(!firstClosed);
    }
    return child;
  });
  syncBuiltinESMExports();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const codec = yield* PictureCodec;
        const running = yield* Effect.forkChild(codec.process(input, policy), {
          startImmediately: true,
        });
        const queued = yield* Effect.forkChild(codec.process(input, policy), {
          startImmediately: true,
        });
        expect(spawn).toHaveBeenCalledTimes(1);
        if (interrupted === 'running') {
          yield* Fiber.interrupt(running);
          expect(first?.signalCode).toBe('SIGKILL');
          expect((yield* Fiber.join(queued))._tag).toBe('Processed');
        } else {
          yield* Fiber.interrupt(queued);
          expect(spawn).toHaveBeenCalledTimes(1);
          if (!first) throw new Error('Missing encoder process');
          first.kill('SIGCONT');
          expect((yield* Fiber.join(running))._tag).toBe('Processed');
          expect((yield* codec.process(input, policy))._tag).toBe('Processed');
        }
        expect(spawn).toHaveBeenCalledTimes(2);
        expect(overlap).toEqual([false]);
      }).pipe(
        Effect.provide(
          pictureCodecLayer({
            maxBytes: 5242880,
            maxPixels: 16000000,
            maxDecodedBytes: 512 * 1024 * 1024,
          })
        )
      )
    );
  } finally {
    spawn.mockRestore();
    syncBuiltinESMExports();
  }
});
