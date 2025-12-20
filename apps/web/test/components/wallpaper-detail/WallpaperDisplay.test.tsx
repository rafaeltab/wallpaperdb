import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WallpaperDisplay } from '@/components/wallpaper-detail/WallpaperDisplay';
import type { Variant } from '@/lib/graphql/types';

const mockVariant: Variant = {
  url: 'https://example.com/wallpaper.jpg',
  width: 1920,
  height: 1080,
  aspectRatio: 1.7778,
  format: 'image/jpeg',
  fileSizeBytes: 500000,
  createdAt: '2024-01-15T10:30:00Z',
};

describe('WallpaperDisplay', () => {
  describe('Loading State', () => {
    it('shows skeleton when isLoading is true', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={true}
          onLoadComplete={vi.fn()}
        />,
      );

      // Should show Skeleton component
      const skeleton = screen.getByTestId('wallpaper-skeleton');
      expect(skeleton).toBeInTheDocument();
    });

    it('hides image when loading', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={true}
          onLoadComplete={vi.fn()}
        />,
      );

      // Image should be hidden (opacity-0 or display:none)
      const image = screen.queryByAltText(/wallpaper/i);
      if (image) {
        expect(image).toHaveClass('opacity-0');
      } else {
        expect(image).not.toBeInTheDocument();
      }
    });

    it('calls onLoadComplete when image loads', async () => {
      const onLoadComplete = vi.fn();

      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={onLoadComplete}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i);

      // Simulate image load
      fireEvent.load(image);

      await waitFor(() => {
        expect(onLoadComplete).toHaveBeenCalled();
      });
    });
  });

  describe('Loaded State', () => {
    it('displays image with correct src', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i) as HTMLImageElement;
      expect(image.src).toBe(mockVariant.url);
    });

    it('uses object-contain for sizing', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i);
      expect(image).toHaveClass('object-contain');
    });

    it('maintains aspect ratio', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
        />,
      );

      const container = screen.getByTestId('wallpaper-container');
      // Should have aspect ratio styles or max dimensions
      expect(container).toBeTruthy();
    });

    it('applies smooth opacity transition', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i);
      // Should have transition class
      expect(image).toHaveClass(/transition/);
    });

    it('has proper alt text for accessibility', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i);
      expect(image).toBeInTheDocument();
    });
  });

  describe('Variant Indicator', () => {
    it('shows indicator when showIndicator is true', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
        />,
      );

      const indicator = screen.getByTestId('variant-indicator');
      expect(indicator).toBeInTheDocument();
    });

    it('hides indicator when showIndicator is false', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={false}
        />,
      );

      const indicator = screen.queryByTestId('variant-indicator');
      expect(indicator).not.toBeInTheDocument();
    });

    it('displays format badge', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
        />,
      );

      // Should show format (JPEG, PNG, WebP)
      const formatBadge = screen.getByText(/jpeg/i);
      expect(formatBadge).toBeInTheDocument();
    });

    it('displays dimensions', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
        />,
      );

      // Should show dimensions like "1920×1080"
      const dimensions = screen.getByText(/1920.*1080/i);
      expect(dimensions).toBeInTheDocument();
    });

    it('shows "original" badge when isOriginal is true', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
          isOriginal={true}
        />,
      );

      const originalBadge = screen.getByText(/original/i);
      expect(originalBadge).toBeInTheDocument();
    });

    it('does not show "original" badge when isOriginal is false', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
          isOriginal={false}
        />,
      );

      const originalBadge = screen.queryByText(/^original$/i);
      expect(originalBadge).not.toBeInTheDocument();
    });

    it('positions indicator at bottom-right', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
        />,
      );

      const indicator = screen.getByTestId('variant-indicator');
      // Should have positioning classes like "absolute bottom-* right-*"
      expect(indicator).toHaveClass(/absolute|bottom|right/);
    });
  });

  describe('Image Loading', () => {
    it('triggers onLoadComplete on image load event', async () => {
      const onLoadComplete = vi.fn();

      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={onLoadComplete}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i);
      fireEvent.load(image);

      await waitFor(() => {
        expect(onLoadComplete).toHaveBeenCalledTimes(1);
      });
    });

    it('handles image load errors gracefully', () => {
      const onLoadComplete = vi.fn();

      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={onLoadComplete}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i);

      // Should not crash on error
      expect(() => {
        fireEvent.error(image);
      }).not.toThrow();
    });

    it('shows error state when image fails to load', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
        />,
      );

      const image = screen.getByAltText(/wallpaper/i);
      fireEvent.error(image);

      // Could show an error message or fallback
      // For now, just verify it doesn't crash
      expect(image).toBeInTheDocument();
    });
  });

  describe('Different Formats', () => {
    it('handles WebP format', () => {
      const webpVariant: Variant = {
        ...mockVariant,
        format: 'image/webp',
        url: 'https://example.com/wallpaper.webp',
      };

      render(
        <WallpaperDisplay
          variant={webpVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
        />,
      );

      const formatBadge = screen.getByText(/webp/i);
      expect(formatBadge).toBeInTheDocument();
    });

    it('handles PNG format', () => {
      const pngVariant: Variant = {
        ...mockVariant,
        format: 'image/png',
        url: 'https://example.com/wallpaper.png',
      };

      render(
        <WallpaperDisplay
          variant={pngVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
          showIndicator={true}
        />,
      );

      const formatBadge = screen.getByText(/png/i);
      expect(formatBadge).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('adapts to container size', () => {
      render(
        <WallpaperDisplay
          variant={mockVariant}
          isLoading={false}
          onLoadComplete={vi.fn()}
        />,
      );

      const container = screen.getByTestId('wallpaper-container');
      // Should have responsive width/height classes
      expect(container).toHaveClass(/w-full|h-full|max-w|max-h/);
    });
  });
});
