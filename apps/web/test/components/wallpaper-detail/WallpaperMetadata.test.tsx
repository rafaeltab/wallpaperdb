import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WallpaperMetadata } from '@/components/wallpaper-detail/WallpaperMetadata';
import type { Wallpaper } from '@/lib/graphql/types';

const mockWallpaper: Wallpaper = {
  wallpaperId: 'wlpr_01234567890123456789012345',
  userId: 'user_123',
  uploadedAt: '2024-01-15T10:30:00Z',
  updatedAt: '2024-01-15T10:30:00Z',
  variants: [
    {
      width: 1920,
      height: 1080,
      aspectRatio: 1.7778,
      format: 'image/jpeg',
      fileSizeBytes: 500000,
      createdAt: '2024-01-15T10:30:00Z',
      url: 'https://example.com/1920x1080.jpg',
    },
    {
      width: 1280,
      height: 720,
      aspectRatio: 1.7778,
      format: 'image/webp',
      fileSizeBytes: 200000,
      createdAt: '2024-01-15T10:30:10Z',
      url: 'https://example.com/1280x720.webp',
    },
  ],
};

describe('WallpaperMetadata', () => {
  beforeEach(() => {
    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
      writable: true,
      configurable: true,
    });
  });

  describe('Information Card', () => {
    it('displays wallpaper ID', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show the wallpaper ID (possibly truncated)
      expect(screen.getByText(/wlpr_/i)).toBeInTheDocument();
    });

    it('displays upload date (formatted)', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show formatted upload date
      expect(screen.getByText(/uploaded/i)).toBeInTheDocument();
      // Date should be formatted (not ISO string)
      expect(screen.queryByText('2024-01-15T10:30:00Z')).not.toBeInTheDocument();
    });

    it('displays updated date (formatted)', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show formatted updated date
      expect(screen.getByText(/updated/i)).toBeInTheDocument();
    });

    it('displays user ID', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show user ID
      expect(screen.getByText(/user_123/i)).toBeInTheDocument();
    });

    it('shows copy button for wallpaper ID', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const copyButton = screen.getByRole('button', { name: /copy/i });
      expect(copyButton).toBeInTheDocument();
    });

    it('copies ID to clipboard on click', async () => {
      const mockWriteText = vi.fn(() => Promise.resolve());
      navigator.clipboard.writeText = mockWriteText;

      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const copyButton = screen.getByRole('button', { name: /copy/i });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(mockWallpaper.wallpaperId);
      });
    });

    it('shows success feedback after copying', async () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const copyButton = screen.getByRole('button', { name: /copy/i });
      fireEvent.click(copyButton);

      // Should show toast or change button text to "Copied!"
      await waitFor(() => {
        expect(
          screen.getByText(/copied/i) || screen.getByRole('status'),
        ).toBeTruthy();
      });
    });
  });

  describe('Current Display Card', () => {
    it('displays dimensions badge', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show dimensions like "1920×1080"
      expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();
    });

    it('displays format badge', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show format badge (JPEG)
      expect(screen.getByText(/jpeg/i)).toBeInTheDocument();
    });

    it('displays aspect ratio badge', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show aspect ratio like "16:9" or "1.78"
      expect(screen.getByText(/16:9|1\.78/)).toBeInTheDocument();
    });

    it('displays file size', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show formatted file size
      expect(screen.getByText(/KB|MB/i)).toBeInTheDocument();
    });

    it('updates when selectedVariantIndex changes', () => {
      const { rerender } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // First variant is JPEG
      expect(screen.getByText(/jpeg/i)).toBeInTheDocument();

      // Change to second variant (WebP)
      rerender(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={1}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should now show WebP
      expect(screen.getByText(/webp/i)).toBeInTheDocument();
    });

    it('shows correct dimensions for selected variant', () => {
      const { rerender } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // First variant is 1920×1080
      expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();

      // Change to second variant (1280×720)
      rerender(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={1}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should now show 1280×720
      expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
    });
  });

  describe('Variant List Integration', () => {
    it('renders VariantList component', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should have a list of variants
      const list = screen.getByRole('list');
      expect(list).toBeInTheDocument();
    });

    it('passes variants prop correctly', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should show all variants
      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(2);
    });

    it('passes selectedVariantIndex prop', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={1}
          onVariantSelect={vi.fn()}
        />,
      );

      // Second variant should be marked as selected/viewing
      const viewingBadges = screen.getAllByText(/viewing|selected/i);
      expect(viewingBadges).toBeTruthy();
    });

    it('calls onVariantSelect when variant changed', () => {
      const onVariantSelect = vi.fn();

      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={onVariantSelect}
        />,
      );

      // Click to select different variant
      const setDisplayButtons = screen.getAllByRole('button', {
        name: /set as display|view/i,
      });

      fireEvent.click(setDisplayButtons[1]);

      expect(onVariantSelect).toHaveBeenCalledWith(1);
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('renders keyboard shortcuts section', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const shortcutsSection = screen.getByText(/keyboard shortcuts/i);
      expect(shortcutsSection).toBeInTheDocument();
    });

    it('is collapsed by default (details element)', () => {
      const { container } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const details = container.querySelector('details');
      expect(details).toBeInTheDocument();
      expect(details?.open).toBe(false);
    });

    it('expands when clicked', () => {
      const { container } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const summary = screen.getByText(/keyboard shortcuts/i);
      fireEvent.click(summary);

      const details = container.querySelector('details');
      expect(details?.open).toBe(true);
    });

    it('displays all shortcut keys with kbd elements', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Expand shortcuts
      const summary = screen.getByText(/keyboard shortcuts/i);
      fireEvent.click(summary);

      // Should have kbd elements for I, D, S, Escape, ←, →
      const kbdElements = screen.getAllByRole('kbd');
      expect(kbdElements.length).toBeGreaterThanOrEqual(6);
    });

    it('shows descriptions for each shortcut', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Expand shortcuts
      const summary = screen.getByText(/keyboard shortcuts/i);
      fireEvent.click(summary);

      // Should describe what each shortcut does
      expect(screen.getByText(/toggle.*panel/i)).toBeInTheDocument();
      expect(screen.getByText(/download/i)).toBeInTheDocument();
      expect(screen.getByText(/share/i)).toBeInTheDocument();
    });

    it('uses small, muted styling', () => {
      const { container } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const details = container.querySelector('details');
      // Should have small text and muted colors
      expect(details).toHaveClass(/text-sm|text-muted/);
    });
  });

  describe('Accessibility', () => {
    it('uses SheetHeader with title', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      const heading = screen.getByRole('heading', {
        name: /wallpaper details/i,
      });
      expect(heading).toBeInTheDocument();
    });

    it('uses semantic heading hierarchy', () => {
      const { container } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should have h2, h3, etc. in proper order
      const headings = container.querySelectorAll('h1, h2, h3, h4');
      expect(headings.length).toBeGreaterThan(0);
    });

    it('has proper ARIA labels', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // All interactive elements should have accessible names
      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        expect(button).toHaveAccessibleName();
      });
    });

    it('uses semantic sections with proper labels', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should have clear section labels
      expect(screen.getByText(/information/i)).toBeInTheDocument();
      expect(screen.getByText(/current display|viewing/i)).toBeInTheDocument();
      expect(screen.getByText(/variants|available/i)).toBeInTheDocument();
    });
  });

  describe('Scrollable Content', () => {
    it('has scrollable container for long content', () => {
      const { container } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // SheetContent should have overflow styles
      const content = container.querySelector('[class*="overflow"]');
      expect(content).toBeTruthy();
    });
  });

  describe('Card Structure', () => {
    it('uses Card components for sections', () => {
      render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Should have multiple Card components
      const cards = screen.getAllByRole('article');
      expect(cards.length).toBeGreaterThanOrEqual(2);
    });

    it('has CardHeader and CardContent for each card', () => {
      const { container } = render(
        <WallpaperMetadata
          wallpaper={mockWallpaper}
          selectedVariantIndex={0}
          onVariantSelect={vi.fn()}
        />,
      );

      // Each card should have header and content sections
      const cardHeaders = container.querySelectorAll('[class*="card-header"]');
      const cardContents = container.querySelectorAll('[class*="card-content"]');

      expect(cardHeaders.length).toBeGreaterThan(0);
      expect(cardContents.length).toBeGreaterThan(0);
    });
  });
});
