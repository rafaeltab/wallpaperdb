import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { ExtractionUnavailable } from '../../extraction/index.js';

// Retain Sharp's default 268402689-pixel input limit and the existing extreme
// aspect-ratio resize behavior. Output cannot exceed this RGBA allocation.
const maxPixelBytes = 268402689 * 4;
const maxDiagnosticBytes = 64 * 1024;

/** Own the operating-system process until close, including interrupted execution. */
export function decodePixels(bytes: Uint8Array): Effect.Effect<Buffer, ExtractionUnavailable> {
  return Effect.callback<Buffer, ExtractionUnavailable>((resume) => {
    const worker = new URL(
      import.meta.url.endsWith('.ts') ? './decoder.ts' : './decoder.mjs',
      import.meta.url
    );
    const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(worker)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
              new ExtractionUnavailable({
                operation: 'decode-image',
                cause:
                  failure ??
                  new Error(
                    Buffer.concat(diagnostics).toString() || `Decoder exited ${code ?? signal}`
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
      if (size > maxPixelBytes) stop(new Error('Image decoder output exceeds the pixel limit'));
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnosticSize += chunk.byteLength;
      if (diagnosticSize > maxDiagnosticBytes)
        stop(new Error('Image decoder diagnostics exceed their limit'));
      else diagnostics.push(chunk);
    });
    child.stdin.end(bytes);
    return Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: '10 seconds',
      orElse: () =>
        Effect.fail(
          new ExtractionUnavailable({
            operation: 'decode-image',
            cause: new Error('Image decoder exceeded 10 seconds'),
          })
        ),
    }),
    Effect.tapError((error) => Effect.logError('Image decoding failed', { cause: error.cause }))
  );
}
