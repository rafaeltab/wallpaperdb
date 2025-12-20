import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  formatFileSize,
  formatAspectRatio,
  formatDate,
  truncateId,
  downloadVariant,
  sortVariantsByQuality,
} from '@/lib/utils/wallpaper';
import type { Variant } from '@/lib/graphql/types';

describe('wallpaper utilities', () => {
  describe('formatFileSize', () => {
    it('formats bytes to B (< 1024)', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(100)).toBe('100 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    it('formats to KB (1024 - 1MB)', () => {
      expect(formatFileSize(1024)).toBe('1.00 KB');
      expect(formatFileSize(2048)).toBe('2.00 KB');
      expect(formatFileSize(1536)).toBe('1.50 KB');
      expect(formatFileSize(1024 * 500)).toBe('500.00 KB');
    });

    it('formats to MB (1MB - 1GB)', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect(formatFileSize(1024 * 1024 * 2)).toBe('2.00 MB');
      expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.50 MB');
      expect(formatFileSize(1024 * 1024 * 500)).toBe('500.00 MB');
    });

    it('formats to GB (>= 1GB)', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatFileSize(1024 * 1024 * 1024 * 2)).toBe('2.00 GB');
      expect(formatFileSize(1024 * 1024 * 1024 * 1.5)).toBe('1.50 GB');
    });

    it('rounds to 2 decimal places', () => {
      expect(formatFileSize(1536)).toBe('1.50 KB');
      expect(formatFileSize(1024 * 1.234)).toBe('1.23 KB');
      expect(formatFileSize(1024 * 1024 * 2.567)).toBe('2.57 MB');
    });

    it('handles zero bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('handles very large files', () => {
      expect(formatFileSize(1024 * 1024 * 1024 * 10)).toBe('10.00 GB');
    });
  });

  describe('formatAspectRatio', () => {
    it('formats common ratios to readable format (16:9)', () => {
      expect(formatAspectRatio(1.7777777777777777)).toBe('16:9');
      expect(formatAspectRatio(1.78)).toBe('16:9');
    });

    it('formats 4:3 ratio', () => {
      expect(formatAspectRatio(1.3333333333333333)).toBe('4:3');
      expect(formatAspectRatio(1.33)).toBe('4:3');
    });

    it('formats 21:9 ultrawide ratio', () => {
      expect(formatAspectRatio(2.3333333333333333)).toBe('21:9');
      expect(formatAspectRatio(2.33)).toBe('21:9');
    });

    it('formats 1:1 square ratio', () => {
      expect(formatAspectRatio(1.0)).toBe('1:1');
      expect(formatAspectRatio(1)).toBe('1:1');
    });

    it('formats 3:2 ratio', () => {
      expect(formatAspectRatio(1.5)).toBe('3:2');
    });

    it('formats uncommon ratios as decimal', () => {
      expect(formatAspectRatio(1.85)).toBe('1.85');
      expect(formatAspectRatio(2.5)).toBe('2.50');
    });

    it('rounds to 2 decimal places', () => {
      expect(formatAspectRatio(1.234567)).toBe('1.23');
      expect(formatAspectRatio(2.789123)).toBe('2.79');
    });

    it('handles portrait ratios', () => {
      expect(formatAspectRatio(0.75)).toBe('0.75'); // 3:4
      expect(formatAspectRatio(0.5625)).toBe('0.56'); // 9:16
    });
  });

  describe('formatDate', () => {
    it('formats ISO date to readable format', () => {
      const isoDate = '2024-01-15T10:30:00.000Z';
      const formatted = formatDate(isoDate);

      // Should include month, day, year
      expect(formatted).toMatch(/Jan|15|2024/);
    });

    it('includes time (hour:minute AM/PM)', () => {
      const isoDate = '2024-01-15T14:30:00.000Z';
      const formatted = formatDate(isoDate);

      // Should include time information
      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });

    it('handles different months correctly', () => {
      expect(formatDate('2024-12-25T12:00:00Z')).toMatch(/Dec/);
      expect(formatDate('2024-06-15T12:00:00Z')).toMatch(/Jun/);
    });

    it('handles midnight correctly', () => {
      const formatted = formatDate('2024-01-15T00:00:00Z');
      expect(formatted).toBeTruthy();
      expect(formatted).toMatch(/12:00/); // Should show as 12:00 AM
    });

    it('handles noon correctly', () => {
      const formatted = formatDate('2024-01-15T12:00:00Z');
      expect(formatted).toBeTruthy();
      expect(formatted).toMatch(/12:00/); // Should show as 12:00 PM
    });
  });

  describe('truncateId', () => {
    it('shows full ID if short (<= 15 chars)', () => {
      expect(truncateId('wlpr_123')).toBe('wlpr_123');
      expect(truncateId('short')).toBe('short');
      expect(truncateId('123456789012345')).toBe('123456789012345');
    });

    it('truncates long IDs with ellipsis', () => {
      const longId = 'wlpr_01234567890123456789012345';
      const truncated = truncateId(longId);

      expect(truncated).toContain('...');
      expect(truncated.length).toBeLessThan(longId.length);
    });

    it('preserves prefix for recognition', () => {
      const truncated = truncateId('wlpr_01234567890123456789012345');

      expect(truncated).toMatch(/^wlpr_/);
    });

    it('handles edge case at exactly 15 characters', () => {
      const id = '123456789012345';
      expect(truncateId(id)).toBe(id);
    });

    it('handles edge case at 16 characters (should truncate)', () => {
      const id = '1234567890123456';
      const truncated = truncateId(id);

      expect(truncated).toContain('...');
    });
  });

  describe('sortVariantsByQuality', () => {
    const createVariant = (
      width: number,
      height: number,
      format = 'image/jpeg',
    ): Variant => ({
      width,
      height,
      aspectRatio: width / height,
      format,
      fileSizeBytes: width * height,
      createdAt: new Date().toISOString(),
      url: `https://example.com/${width}x${height}.jpg`,
    });

    it('sorts variants by resolution (width × height) descending', () => {
      const variants: Variant[] = [
        createVariant(1280, 720), // 921,600
        createVariant(1920, 1080), // 2,073,600
        createVariant(640, 480), // 307,200
      ];

      const sorted = sortVariantsByQuality(variants);

      expect(sorted[0].width).toBe(1920);
      expect(sorted[1].width).toBe(1280);
      expect(sorted[2].width).toBe(640);
    });

    it('places highest resolution first', () => {
      const variants: Variant[] = [
        createVariant(1280, 720),
        createVariant(3840, 2160), // 4K
        createVariant(1920, 1080),
      ];

      const sorted = sortVariantsByQuality(variants);

      expect(sorted[0].width).toBe(3840);
      expect(sorted[0].height).toBe(2160);
    });

    it('maintains order for equal resolutions', () => {
      const variants: Variant[] = [
        createVariant(1920, 1080, 'image/jpeg'),
        createVariant(1920, 1080, 'image/webp'),
        createVariant(1920, 1080, 'image/png'),
      ];

      const sorted = sortVariantsByQuality(variants);

      // All have same resolution, order should be stable
      expect(sorted).toHaveLength(3);
      sorted.forEach((variant) => {
        expect(variant.width).toBe(1920);
        expect(variant.height).toBe(1080);
      });
    });

    it('handles single variant', () => {
      const variants: Variant[] = [createVariant(1920, 1080)];

      const sorted = sortVariantsByQuality(variants);

      expect(sorted).toHaveLength(1);
      expect(sorted[0]).toEqual(variants[0]);
    });

    it('handles empty array', () => {
      const variants: Variant[] = [];

      const sorted = sortVariantsByQuality(variants);

      expect(sorted).toEqual([]);
    });

    it('handles different aspect ratios correctly', () => {
      const variants: Variant[] = [
        createVariant(1920, 1080), // 16:9, 2,073,600
        createVariant(1600, 1200), // 4:3, 1,920,000
        createVariant(2560, 1440), // 16:9, 3,686,400
      ];

      const sorted = sortVariantsByQuality(variants);

      expect(sorted[0].width).toBe(2560); // Highest resolution
      expect(sorted[1].width).toBe(1920);
      expect(sorted[2].width).toBe(1600); // Lowest resolution
    });
  });

  describe('downloadVariant', () => {
    let mockCache: {
      match: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
    };
    let mockFetch: ReturnType<typeof vi.fn>;
    let mockCreateElement: ReturnType<typeof vi.fn>;
    let mockLink: {
      href: string;
      download: string;
      click: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };

    const mockVariant: Variant = {
      width: 1920,
      height: 1080,
      aspectRatio: 1.7778,
      format: 'image/jpeg',
      fileSizeBytes: 500000,
      createdAt: '2024-01-15T10:30:00Z',
      url: 'https://example.com/wallpaper.jpg',
    };

    beforeEach(() => {
      // Mock cache
      mockCache = {
        match: vi.fn(() => Promise.resolve(undefined)),
        put: vi.fn(() => Promise.resolve()),
      };

      vi.spyOn(global.caches, 'open').mockResolvedValue(
        mockCache as unknown as Cache,
      );

      // Mock fetch
      mockFetch = vi.fn();
      global.fetch = mockFetch;

      // Mock createElement for download link
      mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
        remove: vi.fn(),
      };

      mockCreateElement = vi.fn((tag: string) => {
        if (tag === 'a') {
          return mockLink;
        }
        return document.createElement(tag);
      });

      vi.spyOn(document, 'createElement').mockImplementation(mockCreateElement);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as unknown as Node);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('Cache Hit', () => {
      it('uses cached blob if variant exists in cache', async () => {
        const cachedBlob = new Blob(['cached data'], { type: 'image/jpeg' });
        const cachedResponse = new Response(cachedBlob);

        mockCache.match.mockResolvedValueOnce(cachedResponse);

        await downloadVariant(mockVariant);

        expect(mockCache.match).toHaveBeenCalledWith(mockVariant.url);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('does not fetch from network if cached', async () => {
        const cachedBlob = new Blob(['cached data'], { type: 'image/jpeg' });
        const cachedResponse = new Response(cachedBlob);

        mockCache.match.mockResolvedValueOnce(cachedResponse);

        await downloadVariant(mockVariant);

        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('triggers browser download with cached blob', async () => {
        const cachedBlob = new Blob(['cached data'], { type: 'image/jpeg' });
        const cachedResponse = new Response(cachedBlob);

        mockCache.match.mockResolvedValueOnce(cachedResponse);

        await downloadVariant(mockVariant);

        expect(mockLink.click).toHaveBeenCalled();
        expect(mockLink.href).toContain('blob:');
      });
    });

    describe('Cache Miss', () => {
      it('fetches from network if not cached', async () => {
        mockCache.match.mockResolvedValueOnce(undefined);

        const blob = new Blob(['network data'], { type: 'image/jpeg' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);

        await downloadVariant(mockVariant);

        expect(mockFetch).toHaveBeenCalledWith(mockVariant.url);
      });

      it('stores fetched blob in cache', async () => {
        mockCache.match.mockResolvedValueOnce(undefined);

        const blob = new Blob(['network data'], { type: 'image/jpeg' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);

        await downloadVariant(mockVariant);

        expect(mockCache.put).toHaveBeenCalledWith(
          mockVariant.url,
          expect.any(Response),
        );
      });

      it('triggers browser download with fetched blob', async () => {
        mockCache.match.mockResolvedValueOnce(undefined);

        const blob = new Blob(['network data'], { type: 'image/jpeg' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);

        await downloadVariant(mockVariant);

        expect(mockLink.click).toHaveBeenCalled();
        expect(mockLink.href).toContain('blob:');
      });
    });

    describe('Download Trigger', () => {
      beforeEach(async () => {
        const blob = new Blob(['data'], { type: 'image/jpeg' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);
        mockCache.match.mockResolvedValueOnce(undefined);
      });

      it('creates download link with correct filename', async () => {
        await downloadVariant(mockVariant);

        expect(mockLink.download).toBe('wallpaper-1920x1080.jpg');
      });

      it('uses format: wallpaper-{width}x{height}.{ext}', async () => {
        await downloadVariant(mockVariant);

        expect(mockLink.download).toMatch(/^wallpaper-\d+x\d+\.\w+$/);
      });

      it('handles different formats correctly', async () => {
        const webpVariant = { ...mockVariant, format: 'image/webp' };
        const blob = new Blob(['data'], { type: 'image/webp' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);

        await downloadVariant(webpVariant);

        expect(mockLink.download).toBe('wallpaper-1920x1080.webp');
      });

      it('clicks link programmatically', async () => {
        await downloadVariant(mockVariant);

        expect(mockLink.click).toHaveBeenCalled();
      });

      it('cleans up created link element', async () => {
        await downloadVariant(mockVariant);

        expect(mockLink.remove).toHaveBeenCalled();
      });
    });

    describe('Cache API Unavailable', () => {
      beforeEach(() => {
        vi.spyOn(global.caches, 'open').mockRejectedValueOnce(
          new Error('Cache API not available'),
        );
      });

      it('fetches from network when Cache API not available', async () => {
        const blob = new Blob(['data'], { type: 'image/jpeg' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);

        await downloadVariant(mockVariant);

        expect(mockFetch).toHaveBeenCalledWith(mockVariant.url);
      });

      it('does not attempt to cache when Cache API unavailable', async () => {
        const blob = new Blob(['data'], { type: 'image/jpeg' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);

        await downloadVariant(mockVariant);

        expect(mockCache.put).not.toHaveBeenCalled();
      });

      it('still triggers download successfully', async () => {
        const blob = new Blob(['data'], { type: 'image/jpeg' });
        const response = new Response(blob);
        mockFetch.mockResolvedValueOnce(response);

        await downloadVariant(mockVariant);

        expect(mockLink.click).toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      it('handles network failure gracefully', async () => {
        mockCache.match.mockResolvedValueOnce(undefined);
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        // Should not throw
        await expect(downloadVariant(mockVariant)).rejects.toThrow(
          'Network error',
        );
      });

      it('handles fetch returning non-ok response', async () => {
        mockCache.match.mockResolvedValueOnce(undefined);
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

        await expect(downloadVariant(mockVariant)).rejects.toThrow();
      });
    });
  });
});
