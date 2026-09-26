import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { pictureSourceLayer } from '../src/adapters/pictures/index.js';
import { PictureSource } from '../src/pictures/index.js';

class PermanentPictureImportError extends Error {}
async function downloadInitialPicture(url: string, options: { maxBytes: number; timeoutMs: number; allowedHosts: string[] }, fetcher: typeof fetch) {
 const result = await Effect.runPromise(Effect.flatMap(PictureSource, source => source.download(url)).pipe(Effect.provide(pictureSourceLayer(options, fetcher))));
 if (result._tag === 'Rejected') throw new PermanentPictureImportError(result.message);
 return result.bytes;
}

const options = { maxBytes: 1024, timeoutMs: 1000, allowedHosts: ['img.clerk.com', 'images.clerk.dev'] };

describe('Initial Profile picture download', () => {
  it('downloads the captured source through the configured external fetch boundary', async () => {
    const bytes = Buffer.from('initial picture bytes');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes));
    expect(await downloadInitialPicture('https://img.clerk.com/captured-picture', options, fetcher)).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledWith('https://img.clerk.com/captured-picture', expect.objectContaining({
      redirect: 'manual', headers: { Accept: 'image/jpeg, image/png, image/webp' }, signal: expect.any(AbortSignal),
    }));
  });

  it('rejects untrusted initial destinations before sending any request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('bytes'));
    for (const url of [
      'not a url', 'http://img.clerk.com/picture', 'https://img.clerk.com.evil.example/picture',
      'https://evil.example/img.clerk.com', 'https://user:secret@img.clerk.com/picture',
      'https://img.clerk.com:444/picture', 'https://127.0.0.1/picture', 'https://[::1]/picture',
    ]) {
      await expect(downloadInitialPicture(url, { ...options, allowedHosts: [...options.allowedHosts, '127.0.0.1', '[::1]'] }, fetcher))
        .rejects.toBeInstanceOf(PermanentPictureImportError);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates every redirect destination before following it', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://images.clerk.dev/next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: '/final' } }))
      .mockResolvedValueOnce(new Response('redirected bytes'));
    expect(await downloadInitialPicture('https://img.clerk.com/start', options, fetcher)).toEqual(Buffer.from('redirected bytes'));
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://img.clerk.com/start', 'https://images.clerk.dev/next', 'https://images.clerk.dev/final',
    ]);
    for (const destination of ['http://img.clerk.com/picture', 'https://127.0.0.1/private', 'https://untrusted.example/picture']) {
      const malicious = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: destination } }));
      await expect(downloadInitialPicture('https://img.clerk.com/start', options, malicious)).rejects.toBeInstanceOf(PermanentPictureImportError);
      expect(malicious).toHaveBeenCalledTimes(1);
    }
  });

  it('allows at most three redirect hops', async () => {
    for (const hops of [3, 4]) {
      const fetcher = vi.fn<typeof fetch>();
      for (let index = 0; index < hops; index++) {
        fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: `/hop-${index}` } }));
      }
      fetcher.mockResolvedValueOnce(new Response('picture bytes'));
      const result = downloadInitialPicture('https://img.clerk.com/start', options, fetcher);
      if (hops === 3) await expect(result).resolves.toEqual(Buffer.from('picture bytes'));
      else await expect(result).rejects.toBeInstanceOf(PermanentPictureImportError);
      expect(fetcher).toHaveBeenCalledTimes(4);
    }
  });

  it('rejects an oversized declared body and cancels it before reading picture bytes', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); }, cancel,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'Content-Length': '1025' } }));
    await expect(downloadInitialPicture('https://img.clerk.com/picture', options, fetcher)).rejects.toBeInstanceOf(PermanentPictureImportError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('enforces actual streamed bytes with absent or understated length headers and accepts the exact limit', async () => {
    for (const declaredLength of [null, '2']) {
      const headers = new Headers();
      if (declaredLength !== null) headers.set('Content-Length', declaredLength);
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < 4; index++) controller.enqueue(new Uint8Array([1, 2]));
          controller.close();
        }, cancel,
      });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers }));
      await expect(downloadInitialPicture('https://img.clerk.com/picture', { ...options, maxBytes: 5 }, fetcher))
        .rejects.toBeInstanceOf(PermanentPictureImportError);
      expect(cancel).toHaveBeenCalledOnce();
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4, 5])));
    await expect(downloadInitialPicture('https://img.clerk.com/picture', { ...options, maxBytes: 5 }, fetcher))
      .resolves.toEqual(Buffer.from([1, 2, 3, 4, 5]));
  });

  it.each(['headers', 'body', 'redirects'])('bounds hanging %s with one shared download deadline', async (stage) => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const fetcher = vi.fn<typeof fetch>();
      if (stage === 'headers') fetcher.mockImplementation(() => new Promise(() => {}));
      else if (stage === 'body') fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel })));
      else {
        fetcher.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(new Response(null, {
          status: 302, headers: { Location: '/next' },
        })), 60)));
        fetcher.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(new Response('late bytes')), 60)));
      }
      let failure: unknown;
      void downloadInitialPicture('https://img.clerk.com/picture', { ...options, timeoutMs: 100 }, fetcher)
        .catch((error: unknown) => { failure = error; });
      await vi.advanceTimersByTimeAsync(100);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(PermanentPictureImportError);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      if (stage === 'body') expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes permanent HTTP rejection from retryable service failures', async () => {
    for (const status of [400, 401, 403, 404, 410, 422, 408, 429, 500, 502, 503]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not picture bytes', { status }));
      const failure = await downloadInitialPicture('https://img.clerk.com/private-source', options, fetcher).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      if (status < 500 && status !== 408 && status !== 429) expect(failure).toBeInstanceOf(PermanentPictureImportError);
      else expect(failure).not.toBeInstanceOf(PermanentPictureImportError);
    }
  });

  it('keeps external failure details containing the private captured source out of retry errors', async () => {
    const source = 'https://img.clerk.com/private-picture?token=secret';
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`Cannot download ${source}`));
    const failure = await downloadInitialPicture(source, options, fetcher).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PermanentPictureImportError);
    expect(String(failure)).not.toContain(source);
    expect(String(failure)).not.toContain('secret');
    expect(JSON.stringify(failure)).not.toContain('secret');
  });
  it('propagates Effect interruption to the source request and streamed body', async () => {
    const canceled = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel: canceled })));
    const controller = new AbortController();
    const running = Effect.runPromise(Effect.flatMap(PictureSource, source => source.download('https://img.clerk.com/picture')).pipe(
      Effect.provide(pictureSourceLayer(options, fetcher)),
    ), { signal: controller.signal });
    const settled = running.then(value => ({ value }), error => ({ error }));
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      controller.abort();
      expect(await settled).toHaveProperty('error');
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(canceled).toHaveBeenCalledOnce();
    } finally { controller.abort(); await settled; }
  });

});
