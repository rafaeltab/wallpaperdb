import { describe, expect, it, vi } from 'vitest';
import { downloadInitialPicture, PermanentPictureImportError } from '../src/services/profile-picture-source.js';

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
});
