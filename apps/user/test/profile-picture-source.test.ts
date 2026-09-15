import { describe, expect, it, vi } from 'vitest';
import { downloadInitialPicture } from '../src/services/profile-picture-source.js';

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
});
