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
});
