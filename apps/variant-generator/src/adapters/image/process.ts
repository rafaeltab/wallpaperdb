import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { GenerationUnavailable } from '../../capabilities/generation/index.js';

export interface EncodingOptions {
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly jpegQuality: number;
  readonly pngCompressionLevel: number;
  readonly webpQuality: number;
}

// Largest preset is 5120 × 2160; 64 MiB leaves room beyond its RGBA size.
const maxPixelBytes = 64 * 1024 * 1024;
const maxDiagnosticBytes = 64 * 1024;
const dimensionFrameBytes = 8;

export interface EncodedImage {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

export function encodeImage(bytes: Uint8Array, options: EncodingOptions) {
  return runImage(bytes, options);
}

export function inspectImage(bytes: Uint8Array) {
  return runImage(bytes, { inspect: true }).pipe(
    Effect.map(({ width, height }) => ({ width, height }))
  );
}

/** Own the operating-system process until close, including interrupted execution. */
function runImage(
  bytes: Uint8Array,
  options: EncodingOptions | { readonly inspect: true }
): Effect.Effect<EncodedImage, GenerationUnavailable> {
  const inspection = 'inspect' in options;
  const operation = inspection ? 'inspect-image' : 'encode-image';
  const stage = inspection ? 'Image inspection' : 'Image encoder';
  return Effect.callback<EncodedImage, GenerationUnavailable>((resume) => {
    const worker = new URL(
      import.meta.url.endsWith('.ts') ? './encoder.ts' : './encoder.mjs',
      import.meta.url
    );
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(worker), JSON.stringify(options)],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const chunks: Buffer[] = [];
    const diagnostics: Buffer[] = [];
    let size = 0;
    let diagnosticSize = 0;
    let failure: unknown;
    const stop = (cause: unknown) => {
      failure ??= cause;
      child.kill('SIGKILL');
    };
    const closed = new Promise<void>((resolve) => {
      child.once('close', (code, signal) => {
        resolve();
        if (failure !== undefined || code !== 0) {
          const cause =
            failure ??
            new Error(
              Buffer.concat(diagnostics).toString() ||
                `${inspection ? 'Inspection' : 'Encoder'} exited ${code ?? signal}`
            );
          resume(
            Effect.fail(
              new GenerationUnavailable({
                operation,
                cause: inspection ? new Error('Image inspection failed', { cause }) : cause,
              })
            )
          );
        } else {
          const output = Buffer.concat(chunks);
          const width = output.length >= dimensionFrameBytes ? output.readUInt32BE(0) : 0;
          const height = output.length >= dimensionFrameBytes ? output.readUInt32BE(4) : 0;
          if (
            width <= 0 ||
            height <= 0 ||
            (!inspection &&
              (output.length <= dimensionFrameBytes ||
                width > options.width ||
                height > options.height)) ||
            (inspection && output.length !== dimensionFrameBytes)
          ) {
            resume(
              Effect.fail(
                new GenerationUnavailable({
                  operation,
                  cause: new Error(`${stage} returned invalid dimensions`),
                })
              )
            );
          } else {
            resume(Effect.succeed({ bytes: output.subarray(dimensionFrameBytes), width, height }));
          }
        }
      });
    });
    child.once('error', stop);
    child.stdin.once('error', stop);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > (inspection ? dimensionFrameBytes : maxPixelBytes + dimensionFrameBytes))
        stop(
          new Error(
            inspection
              ? 'Image inspection output exceeds its frame limit'
              : 'Image encoder output exceeds the pixel limit'
          )
        );
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnosticSize += chunk.byteLength;
      if (diagnosticSize > maxDiagnosticBytes)
        stop(new Error(`${stage} diagnostics exceed their limit`));
      else diagnostics.push(chunk);
    });
    child.stdin.end(bytes);
    return Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: '60 seconds',
      orElse: () =>
        Effect.fail(
          new GenerationUnavailable({
            operation,
            cause: new Error(`${stage} exceeded 60 seconds`),
          })
        ),
    }),
    Effect.tapError((error) =>
      Effect.logError(inspection ? 'Image inspection failed' : 'Image encoding failed', {
        operation,
        cause: error.cause,
      })
    )
  );
}
