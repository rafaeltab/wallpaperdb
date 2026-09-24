import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { GenerationUnavailable } from '../../generation/index.js';

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

/** Own the operating-system process until close, including interrupted execution. */
export function encodeImage(
  bytes: Uint8Array,
  options: EncodingOptions
): Effect.Effect<Buffer, GenerationUnavailable> {
  return Effect.callback<Buffer, GenerationUnavailable>((resume) => {
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
          resume(
            Effect.fail(
              new GenerationUnavailable({
                operation: 'encode-image',
                cause:
                  failure ??
                  new Error(
                    Buffer.concat(diagnostics).toString() || `Encoder exited ${code ?? signal}`
                  ),
              })
            )
          );
        } else resume(Effect.succeed(Buffer.concat(chunks)));
      });
    });
    child.once('error', stop);
    child.stdin.once('error', stop);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxPixelBytes) stop(new Error('Image encoder output exceeds the pixel limit'));
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnosticSize += chunk.byteLength;
      if (diagnosticSize > maxDiagnosticBytes)
        stop(new Error('Image encoder diagnostics exceed their limit'));
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
            operation: 'encode-image',
            cause: new Error('Image encoder exceeded 60 seconds'),
          })
        ),
    }),
    Effect.tapError((error) => Effect.logError('Image encoding failed', { cause: error.cause }))
  );
}
