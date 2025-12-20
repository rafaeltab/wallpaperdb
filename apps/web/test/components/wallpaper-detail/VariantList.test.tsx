import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariantList } from '@/components/wallpaper-detail/VariantList';
import type { Variant } from '@/lib/graphql/types';
import * as wallpaperUtils from '@/lib/utils/wallpaper';

const mockVariants: Variant[] = [
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
  {
    width: 640,
    height: 480,
    aspectRatio: 1.3333,
    format: 'image/png',
    fileSizeBytes: 150000,
    createdAt: '2024-01-15T10:30:20Z',
    url: 'https://example.com/640x480.png',
  },
];

describe('VariantList', () => {
  let mockDownloadVariant: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDownloadVariant = vi.fn();
    vi.spyOn(wallpaperUtils, 'downloadVariant').mockImplementation(
      mockDownloadVariant,
    );
  });

  describe('Rendering', () => {
    it('renders all variants', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      // Should have list items for each variant
      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(3);
    });

    it('displays format badge for each variant', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      // Should show JPEG, WebP, PNG badges
      expect(screen.getByText(/jpeg/i)).toBeInTheDocument();
      expect(screen.getByText(/webp/i)).toBeInTheDocument();
      expect(screen.getByText(/png/i)).toBeInTheDocument();
    });

    it('displays "Original" badge on first variant', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      // First variant should have "Original" badge
      const originalBadges = screen.getAllByText(/original/i);
      expect(originalBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('displays resolution for each variant', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      // Should show dimensions like "1920×1080"
      expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();
      expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
      expect(screen.getByText(/640.*480/)).toBeInTheDocument();
    });

    it('displays file size for each variant', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      // Should show formatted file sizes
      const fileSizes = screen.getAllByText(/KB|MB/i);
      expect(fileSizes.length).toBeGreaterThanOrEqual(3);
    });

    it('shows separators between items', () => {
      const { container } = render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      // Should have Separator components between variants
      const separators = container.querySelectorAll('[role="separator"]');
      expect(separators.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Selection', () => {
    it('highlights selected variant with default badge', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={1}
          onSelect={vi.fn()}
        />,
      );

      // Second variant should be marked as selected
      const viewingBadges = screen.getAllByText(/viewing|selected/i);
      expect(viewingBadges).toBeTruthy();
    });

    it('calls onSelect when "Set as Display" clicked', () => {
      const onSelect = vi.fn();

      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={onSelect}
        />,
      );

      // Click "Set as Display" button on second variant
      const setDisplayButtons = screen.getAllByText(/set as display|view/i);
      fireEvent.click(setDisplayButtons[1]);

      expect(onSelect).toHaveBeenCalled();
    });

    it('passes correct index to onSelect', () => {
      const onSelect = vi.fn();

      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={onSelect}
        />,
      );

      const setDisplayButtons = screen.getAllByRole('button', {
        name: /set as display|view/i,
      });

      // Click second variant (index 1)
      fireEvent.click(setDisplayButtons[1]);

      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('does not call onSelect when already selected variant is clicked', () => {
      const onSelect = vi.fn();

      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={onSelect}
        />,
      );

      // Find the currently selected variant's button (should be disabled or handled differently)
      const buttons = screen.getAllByRole('button');
      const selectedButton = buttons.find((btn) =>
        btn.textContent?.includes('Selected'),
      );

      if (selectedButton) {
        fireEvent.click(selectedButton);
        // Should either not call or be disabled
        expect(
          onSelect).not.toHaveBeenCalled() || expect(selectedButton).toBeDisabled();
      }
    });
  });

  describe('Download', () => {
    it('shows download button for each variant', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i,
      });
      expect(downloadButtons).toHaveLength(3);
    });

    it('triggers downloadVariant on click', async () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i,
      });

      fireEvent.click(downloadButtons[0]);

      expect(mockDownloadVariant).toHaveBeenCalledWith(mockVariants[0]);
    });

    it('downloads correct variant when multiple download buttons exist', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const downloadButtons = screen.getAllByRole('button', {
        name: /download/i,
      });

      // Download second variant
      fireEvent.click(downloadButtons[1]);

      expect(mockDownloadVariant).toHaveBeenCalledWith(mockVariants[1]);
    });
  });

  describe('Tooltips', () => {
    it('shows tooltip on hover with full details', async () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const listItems = screen.getAllByRole('listitem');
      fireEvent.mouseOver(listItems[0]);

      // Tooltip should appear with details
      // Note: Tooltip content might be in a portal, so we might need to wait
      const tooltipContent = await screen.findByRole('tooltip', {
        timeout: 1000,
      });
      expect(tooltipContent).toBeInTheDocument();
    });

    it('includes dimensions in tooltip', async () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const listItems = screen.getAllByRole('listitem');
      fireEvent.mouseOver(listItems[0]);

      const tooltip = await screen.findByRole('tooltip', { timeout: 1000 });
      expect(tooltip).toHaveTextContent(/1920.*1080/);
    });

    it('includes format in tooltip', async () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const listItems = screen.getAllByRole('listitem');
      fireEvent.mouseOver(listItems[0]);

      const tooltip = await screen.findByRole('tooltip', { timeout: 1000 });
      expect(tooltip).toHaveTextContent(/jpeg/i);
    });

    it('includes file size in tooltip', async () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const listItems = screen.getAllByRole('listitem');
      fireEvent.mouseOver(listItems[0]);

      const tooltip = await screen.findByRole('tooltip', { timeout: 1000 });
      expect(tooltip).toHaveTextContent(/KB|MB/i);
    });
  });

  describe('Accessibility', () => {
    it('has aria-labels on buttons', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        // Each button should have accessible name
        expect(button).toHaveAccessibleName();
      });
    });

    it('uses semantic list structure', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const list = screen.getByRole('list');
      expect(list).toBeInTheDocument();

      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(3);
    });

    it('has proper heading for variant list', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const heading = screen.getByRole('heading', { name: /variants|available sizes/i });
      expect(heading).toBeInTheDocument();
    });

    it('indicates selected state for screen readers', () => {
      render(
        <VariantList
          variants={mockVariants}
          selectedIndex={1}
          onSelect={vi.fn()}
        />,
      );

      // Selected item should have aria-current or similar
      const selectedItem = screen.getByRole('listitem', { current: true });
      expect(selectedItem).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('handles empty variants array gracefully', () => {
      render(
        <VariantList variants={[]} selectedIndex={0} onSelect={vi.fn()} />,
      );

      // Should show empty state or not crash
      const list = screen.queryByRole('list');
      expect(list).toBeTruthy();
    });

    it('shows message when no variants available', () => {
      render(
        <VariantList variants={[]} selectedIndex={0} onSelect={vi.fn()} />,
      );

      const emptyMessage = screen.getByText(/no variants/i);
      expect(emptyMessage).toBeInTheDocument();
    });
  });

  describe('Single Variant', () => {
    it('renders correctly with only one variant', () => {
      const singleVariant = [mockVariants[0]];

      render(
        <VariantList
          variants={singleVariant}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const listItems = screen.getAllByRole('listitem');
      expect(listItems).toHaveLength(1);
    });

    it('shows original badge for single variant', () => {
      const singleVariant = [mockVariants[0]];

      render(
        <VariantList
          variants={singleVariant}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );

      const originalBadge = screen.getByText(/original/i);
      expect(originalBadge).toBeInTheDocument();
    });
  });
});
