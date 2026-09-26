import { isIP } from 'node:net';
import { Effect, Layer } from 'effect';
import { PictureSource, PictureUnavailable } from '../../pictures/index.js';

class PermanentPictureImportError extends Error {}

export interface PictureSourceConfig {
  maxBytes: number;
  timeoutMs: number;
  allowedHosts: string[];
}

function trustedSource(url: string, allowedHosts: string[]): URL {
  let source: URL;
  try {
    source = new URL(url);
  } catch {
    throw new PermanentPictureImportError('Initial picture source is invalid');
  }
  if (
    source.protocol !== 'https:' ||
    source.username ||
    source.password ||
    source.port ||
    source.hostname.startsWith('[') ||
    isIP(source.hostname) ||
    !allowedHosts.includes(source.hostname)
  ) {
    throw new PermanentPictureImportError('Initial picture source is not allowed');
  }
  return source;
}

async function downloadInitialPicture(
  url: string,
  options: PictureSourceConfig,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<Buffer> {
  const source = trustedSource(url, options.allowedHosts);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Initial picture download timed out'));
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([readSource(source, options, fetcher, controller.signal), deadline]);
  } catch (error) {
    if (error instanceof PermanentPictureImportError) throw error;
    // Transport errors may contain the private captured URL, including its query string.
    throw new Error('Initial picture download is temporarily unavailable');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

async function readSource(
  source: URL,
  options: PictureSourceConfig,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<Buffer> {
  let redirects = 0;
  while (true) {
    signal.throwIfAborted();
    const response = await fetcher(source.href, {
      redirect: 'manual',
      headers: { Accept: 'image/jpeg, image/png, image/webp' },
      signal,
    });
    if (signal.aborted) {
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects++ >= 3)
        throw new PermanentPictureImportError('Initial picture has too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new PermanentPictureImportError('Initial picture redirect is invalid');
      try {
        source = trustedSource(new URL(location, source).href, options.allowedHosts);
      } catch {
        throw new PermanentPictureImportError('Initial picture redirect is not allowed');
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 429].includes(response.status)
      ) {
        throw new PermanentPictureImportError('Initial picture source rejected the request');
      }
      throw new Error('Initial picture source is temporarily unavailable');
    }
    if (Number(response.headers.get('content-length')) > options.maxBytes) {
      await response.body?.cancel();
      throw new PermanentPictureImportError('Initial picture exceeds the byte limit');
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const cancelBody = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancelBody, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > options.maxBytes) {
          await reader.cancel();
          throw new PermanentPictureImportError('Initial picture exceeds the byte limit');
        }
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks, length);
    } finally {
      signal.removeEventListener('abort', cancelBody);
      reader.releaseLock();
    }
  }
}

export function pictureSourceLayer(
  options: PictureSourceConfig,
  fetcher: typeof fetch = (...args) => fetch(...args)
): Layer.Layer<PictureSource> {
  return Layer.succeed(PictureSource, {
    download: (url) =>
      Effect.tryPromise({
        try: async (signal) => {
          try {
            const bytes = await downloadInitialPicture(url, options, fetcher, signal);
            return { _tag: 'Downloaded', bytes } as const;
          } catch (cause) {
            if (cause instanceof PermanentPictureImportError)
              return {
                _tag: 'Rejected',
                reason: 'picture-source-rejected',
                message: cause.message,
              } as const;
            throw cause;
          }
        },
        // URLs can carry private credentials. The transport error is deliberately discarded.
        catch: () =>
          new PictureUnavailable({
            operation: 'download-picture',
            cause: new Error('Initial picture source is temporarily unavailable'),
          }),
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError('Initial picture download failed', {
            operation: error.operation,
            cause: error.cause,
          })
        ),
        Effect.withSpan('pictures.source.download')
      ),
  });
}
