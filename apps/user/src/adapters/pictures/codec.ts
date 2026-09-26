import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect, Layer, Semaphore } from 'effect';
import { z } from 'zod';
import { PictureCodec, type PictureLimits, PictureUnavailable } from '../../pictures/index.js';

const outputSchema = z.discriminatedUnion('_tag', [
  z.object({
    _tag: z.literal('Processed'),
    picture: z.object({
      bytes: z.string(),
      mimeType: z.literal('image/webp'),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
  z.object({
    _tag: z.literal('Rejected'),
    reason: z.enum(['invalid-picture', 'picture-too-large']),
    message: z.string(),
  }),
]);

function encode(bytes: Buffer, limits: PictureLimits): ReturnType<PictureCodec['process']> {
  if (bytes.length > limits.maxBytes)
    return Effect.succeed({
      _tag: 'Rejected',
      reason: 'picture-too-large',
      message: 'Picture exceeds the upload byte limit',
    });
  return Effect.callback<Buffer, PictureUnavailable>((resume) => {
    const worker = new URL(
      import.meta.url.endsWith('.ts') ? './encoder.ts' : './picture-encoder.mjs',
      import.meta.url
    );
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(worker), JSON.stringify(limits)],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: unknown;
    const stop = (cause: unknown) => {
      failure ??= cause;
      child.kill('SIGKILL');
    };
    const closed = new Promise<void>((resolve) => {
      child.once('close', (code, signal) => {
        resolve();
        if (failure !== undefined || code !== 0)
          resume(
            Effect.fail(
              new PictureUnavailable({
                operation: 'encode-picture',
                cause: failure ?? new Error(`Encoder exited ${code ?? signal}`),
              })
            )
          );
        else resume(Effect.succeed(Buffer.concat(chunks)));
      });
    });
    child.once('error', stop);
    child.stdin.once('error', stop);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limits.maxDecodedBytes * 2 + 4096)
        stop(new Error('Encoder output exceeds its limit'));
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.end(bytes);
    return Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: '15 seconds',
      orElse: () =>
        Effect.fail(
          new PictureUnavailable({
            operation: 'encode-picture',
            cause: new Error('Picture encoder exceeded its deadline'),
          })
        ),
    }),
    Effect.flatMap((bytes) =>
      Effect.try({
        try: () => {
          const output = outputSchema.parse(JSON.parse(bytes.toString()));
          return output._tag === 'Processed'
            ? {
                ...output,
                picture: { ...output.picture, bytes: Buffer.from(output.picture.bytes, 'base64') },
              }
            : output;
        },
        catch: (cause) => new PictureUnavailable({ operation: 'decode-encoder-output', cause }),
      })
    ),
    Effect.tapError((error) =>
      Effect.logError('Picture encoding failed', { operation: error.operation, cause: error.cause })
    ),
    Effect.withSpan('pictures.codec.process')
  );
}

export function pictureCodecLayer(limits: PictureLimits): Layer.Layer<PictureCodec> {
  return Layer.effect(
    PictureCodec,
    Effect.gen(function* () {
      const nativeWork = yield* Semaphore.make(2);
      return PictureCodec.of({ process: (bytes) => nativeWork.withPermit(encode(bytes, limits)) });
    })
  );
}
