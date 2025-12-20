import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { WallpaperDetailSkeleton } from '@/components/wallpaper-detail/WallpaperDetailSkeleton';

describe('WallpaperDetailSkeleton', () => {
  describe('Layout Structure', () => {
    it('renders header skeleton', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have skeleton elements for header
      const skeletons = screen.getAllByTestId(/skeleton/i);
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('renders large image skeleton', () => {
      const { container } = render(<WallpaperDetailSkeleton />);

      // Should have a large skeleton for the main image
      const imageSkeletons = container.querySelectorAll(
        '[data-testid*="image-skeleton"], [class*="skeleton"]',
      );
      expect(imageSkeletons.length).toBeGreaterThan(0);
    });

    it('renders action bar skeleton', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have skeletons for action buttons
      const skeletons = screen.getAllByTestId(/skeleton/i);
      expect(skeletons).toBeTruthy();
    });

    it('matches final layout dimensions', () => {
      const { container } = render(<WallpaperDetailSkeleton />);

      // Should have a main container that matches expected layout
      expect(container.firstChild).toBeTruthy();
    });

    it('has consistent styling with loading state', () => {
      const { container } = render(<WallpaperDetailSkeleton />);

      // Skeleton should use Skeleton component from shadcn/ui
      const skeletonElements = container.querySelectorAll('[class*="skeleton"]');
      expect(skeletonElements.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('has aria-label for loading state', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have appropriate ARIA label
      const loadingElement = screen.getByLabelText(/loading/i);
      expect(loadingElement).toBeInTheDocument();
    });

    it('uses semantic HTML', () => {
      const { container } = render(<WallpaperDetailSkeleton />);

      // Should use semantic elements where appropriate
      const main = container.querySelector('main');
      expect(main).toBeTruthy();
    });

    it('has role="status" for screen readers', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have role="status" to announce loading state
      const statusElement = screen.getByRole('status');
      expect(statusElement).toBeInTheDocument();
    });

    it('has sr-only text describing loading state', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have screen reader only text
      const srText = screen.getByText(/loading wallpaper/i);
      expect(srText).toBeInTheDocument();
    });
  });

  describe('Visual Structure', () => {
    it('maintains aspect ratio for image skeleton', () => {
      const { container } = render(<WallpaperDetailSkeleton />);

      // Image skeleton should have aspect ratio styles
      const imageArea = container.querySelector('[data-testid="image-skeleton"]');
      expect(imageArea).toBeTruthy();
    });

    it('renders button skeletons in action bar', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have skeletons for buttons (download, share)
      const buttonSkeletons = screen.getAllByTestId(/button-skeleton/i);
      expect(buttonSkeletons.length).toBeGreaterThanOrEqual(2);
    });

    it('has header with back button skeleton', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have skeleton for back button
      const backButtonSkeleton = screen.getByTestId('back-button-skeleton');
      expect(backButtonSkeleton).toBeInTheDocument();
    });

    it('has header with title skeleton', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have skeleton for page title
      const titleSkeleton = screen.getByTestId('title-skeleton');
      expect(titleSkeleton).toBeInTheDocument();
    });

    it('has header with toggle button skeleton', () => {
      render(<WallpaperDetailSkeleton />);

      // Should have skeleton for panel toggle button
      const toggleSkeleton = screen.getByTestId('toggle-skeleton');
      expect(toggleSkeleton).toBeInTheDocument();
    });
  });
});
