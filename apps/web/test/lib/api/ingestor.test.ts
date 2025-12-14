import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadWallpaperWithDetails } from '@/lib/api/ingestor';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockFile(name = 'test.jpg'): File {
  return new File(['test'], name, { type: 'image/jpeg' });
}

function createSuccessResponse(status: 'processing' | 'already_uploaded' = 'processing') {
  return {
    wallpaperId: 'wlpr_123',
    userId: 'user_1',
    uploadState: status === 'already_uploaded' ? 'completed' : 'processing',
    status,
    fileType: 'image',
    mimeType: 'image/jpeg',
    fileSizeBytes: 1024,
    width: 1920,
    height: 1080,
    aspectRatio: 1.78,
    uploadedAt: new Date().toISOString(),
  };
}

describe('uploadWallpaperWithDetails', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success result for 200 with status: processing', async () => {
    const responseData = createSuccessResponse('processing');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
      headers: new Headers(),
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(true);
    expect(result.isDuplicate).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response?.wallpaperId).toBe('wlpr_123');
    expect(result.error).toBeUndefined();
  });

  it('returns duplicate result for 200 with status: already_uploaded', async () => {
    const responseData = createSuccessResponse('already_uploaded');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseData),
      headers: new Headers(),
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(true);
    expect(result.isDuplicate).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('returns rate_limit error for 429 with retryAfter from header', async () => {
    const headers = new Headers();
    headers.set('Retry-After', '60');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ detail: 'Rate limit exceeded' }),
      headers,
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('rate_limit');
    expect(result.error?.retryAfter).toBe(60);
    expect(result.error?.message).toContain('Rate limit');
  });

  it('returns rate_limit error with default retryAfter when header missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ detail: 'Too many requests' }),
      headers: new Headers(),
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('rate_limit');
    expect(result.error?.retryAfter).toBe(60); // default value
  });

  it('returns validation error for 400', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ detail: 'Invalid file format' }),
      headers: new Headers(),
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('validation');
    expect(result.error?.message).toContain('Invalid file format');
    expect(result.error?.retryAfter).toBeUndefined();
  });

  it('returns validation error for 413 (file too large)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: () => Promise.resolve({ detail: 'File too large' }),
      headers: new Headers(),
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('validation');
    expect(result.error?.message).toContain('File too large');
  });

  it('returns server error for 500', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Internal server error' }),
      headers: new Headers(),
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('server');
    expect(result.error?.message).toContain('Internal server error');
  });

  it('returns network error on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('network');
    expect(result.error?.message).toContain('Network error');
  });

  it('handles JSON parse error gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
      headers: new Headers(),
    });

    const result = await uploadWallpaperWithDetails(createMockFile(), 'user_1');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('server');
  });
});
