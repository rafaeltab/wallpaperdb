import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareWallpaper } from '@/lib/services/wallpaper-share';
import { toast } from 'sonner';

// Mock sonner
vi.mock('sonner', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

describe('wallpaper-share service', () => {
	const mockWallpaperId = 'wlpr_test123';
	const mockOrigin = 'https://example.com';
	const expectedUrl = `${mockOrigin}/wallpapers/${mockWallpaperId}`;

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

		// Mock window.location.origin using vi.stubGlobal
		vi.stubGlobal('location', { origin: mockOrigin });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Native Share API', () => {
		it('uses native share when navigator.share is available', async () => {
			const mockShare = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'share', {
				value: mockShare,
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(mockShare).toHaveBeenCalledWith({
				title: 'Wallpaper',
				text: 'Check out this wallpaper',
				url: expectedUrl,
			});
		});

		it('does not show toast when native share succeeds', async () => {
			const mockShare = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'share', {
				value: mockShare,
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(toast.success).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		});

		it('falls back to clipboard when native share is cancelled', async () => {
			const mockShare = vi.fn().mockRejectedValue(new Error('User cancelled'));
			const mockWriteText = vi.fn().mockResolvedValue(undefined);

			Object.defineProperty(navigator, 'share', {
				value: mockShare,
				writable: true,
				configurable: true,
			});

			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(mockWriteText).toHaveBeenCalledWith(expectedUrl);
			expect(toast.success).toHaveBeenCalledWith('Link copied to clipboard');
		});

		it('falls back to clipboard when native share fails', async () => {
			const mockShare = vi.fn().mockRejectedValue(new Error('Share failed'));
			const mockWriteText = vi.fn().mockResolvedValue(undefined);

			Object.defineProperty(navigator, 'share', {
				value: mockShare,
				writable: true,
				configurable: true,
			});

			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(mockWriteText).toHaveBeenCalledWith(expectedUrl);
		});
	});

	describe('Clipboard Fallback', () => {
		beforeEach(() => {
			// Remove native share
			Object.defineProperty(navigator, 'share', {
				value: undefined,
				writable: true,
				configurable: true,
			});
		});

		it('copies to clipboard when native share unavailable', async () => {
			const mockWriteText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(mockWriteText).toHaveBeenCalledWith(expectedUrl);
		});

		it('shows success toast on successful clipboard copy', async () => {
			const mockWriteText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(toast.success).toHaveBeenCalledWith('Link copied to clipboard');
		});

		it('shows error toast on clipboard failure', async () => {
			const mockWriteText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(toast.error).toHaveBeenCalledWith('Failed to copy link');
		});

		it('handles clipboard not available', async () => {
			Object.defineProperty(navigator, 'clipboard', {
				value: undefined,
				writable: true,
				configurable: true,
			});

			await shareWallpaper(mockWallpaperId);

			expect(toast.error).toHaveBeenCalledWith('Failed to copy link');
		});
	});

	describe('URL Generation', () => {
		beforeEach(() => {
			const mockWriteText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});
			Object.defineProperty(navigator, 'share', {
				value: undefined,
				writable: true,
				configurable: true,
			});
		});

		it('generates correct URL format', async () => {
			const mockWriteText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper('wlpr_abc123');

			expect(mockWriteText).toHaveBeenCalledWith(
				'https://example.com/wallpapers/wlpr_abc123',
			);
		});

		it('uses current origin', async () => {
			vi.stubGlobal('location', { origin: 'https://wallpaperdb.com' });

			const mockWriteText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper('wlpr_test');

			expect(mockWriteText).toHaveBeenCalledWith(
				'https://wallpaperdb.com/wallpapers/wlpr_test',
			);
		});

		it('works with different wallpaper IDs', async () => {
			const mockWriteText = vi.fn().mockResolvedValue(undefined);
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				writable: true,
				configurable: true,
			});

			await shareWallpaper('wlpr_01JFABC123');

			expect(mockWriteText).toHaveBeenCalledWith(
				'https://example.com/wallpapers/wlpr_01JFABC123',
			);
		});
	});
});
