import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import type { Wallpaper } from '@/lib/graphql/types';

const wallpaper: Wallpaper = {
  wallpaperId: 'landscape',
  profileId: 'owner',
  uploadedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  variants: [{
    width: 1920, height: 1080, aspectRatio: 1920 / 1080,
    format: 'image/jpeg', fileSizeBytes: 100, createdAt: '2026-01-01T00:00:00Z',
    url: 'https://example.com/landscape.jpg',
  }],
};

afterEach(cleanup);

describe('WallpaperGrid pagination', () => {
  it('keeps loading placeholders outside the gallery until dimensions are known', () => {
    const { container, rerender } = render(<WallpaperGrid wallpapers={[wallpaper]} />);
    const existingCard = screen.getByRole('button', { name: 'Wallpaper landscape' });

    rerender(<WallpaperGrid wallpapers={[wallpaper]} isLoadingMore />);

    expect(container.querySelector('[data-item-id^="skeleton-"]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading more wallpapers');
    expect(screen.getByRole('button', { name: 'Wallpaper landscape' })).toBe(existingCard);

    rerender(<WallpaperGrid wallpapers={[wallpaper]} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Wallpaper landscape' })).toBe(existingCard);
  });
});
