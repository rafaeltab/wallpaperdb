import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WallpaperDetailPage } from '@/routes/wallpapers.$wallpaperId';
import type { Wallpaper } from '@/lib/graphql/types';
import * as graphqlClient from '@/lib/graphql/client';
import * as wallpaperUtils from '@/lib/utils/wallpaper';

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useParams: vi.fn(() => ({ wallpaperId: 'wlpr_test123' })),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createMockWallpaper(wallpaperId: string): Wallpaper {
  return {
    wallpaperId,
    userId: 'user_123',
    uploadedAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
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
}

describe('WallpaperDetailPage', () => {
  let queryClient: QueryClient;
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockDownloadVariant: ReturnType<typeof vi.fn>;
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockRequest = vi.fn();
    mockDownloadVariant = vi.fn();

    vi.spyOn(graphqlClient, 'request').mockImplementation(mockRequest);
    vi.spyOn(wallpaperUtils, 'downloadVariant').mockImplementation(
      mockDownloadVariant,
    );

    // Mock localStorage
    mockStorage = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
      (key) => mockStorage[key] || null,
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key, value) => {
        mockStorage[key] = value;
      },
    );

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
      writable: true,
      configurable: true,
    });

    // Mock share
    Object.defineProperty(navigator, 'share', {
      value: vi.fn(() => Promise.resolve()),
      writable: true,
      configurable: true,
    });
  });

  describe('Data Loading', () => {
    it('shows skeleton while loading', () => {
      mockRequest.mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      // Should show loading skeleton
      const skeleton = screen.getByLabelText(/loading/i);
      expect(skeleton).toBeInTheDocument();
    });

    it('fetches wallpaper by ID from route params', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledWith(
          expect.any(String),
          { wallpaperId: 'wlpr_test123' },
        );
      });
    });

    it('displays wallpaper when loaded', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const image = screen.getByAltText(/wallpaper/i);
        expect(image).toBeInTheDocument();
      });
    });
  });

  describe('Error States', () => {
    describe('404 Not Found', () => {
      it('shows Alert when wallpaper not found', async () => {
        mockRequest.mockResolvedValueOnce({ getWallpaper: null });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const alert = screen.getByRole('alert');
          expect(alert).toBeInTheDocument();
          expect(alert).toHaveTextContent(/not found/i);
        });
      });

      it('displays "Back to Gallery" button', async () => {
        mockRequest.mockResolvedValueOnce({ getWallpaper: null });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const backButton = screen.getByRole('link', {
            name: /back to gallery/i,
          });
          expect(backButton).toBeInTheDocument();
        });
      });

      it('navigates to gallery on button click', async () => {
        mockRequest.mockResolvedValueOnce({ getWallpaper: null });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const backButton = screen.getByRole('link', {
            name: /back to gallery/i,
          });
          expect(backButton).toHaveAttribute('href', '/');
        });
      });
    });

    describe('Validation Error', () => {
      it('shows error message for invalid ID', async () => {
        mockRequest.mockRejectedValueOnce({
          response: {
            errors: [{ message: 'wallpaperId must start with "wlpr_"' }],
          },
        });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const alert = screen.getByRole('alert');
          expect(alert).toHaveTextContent(/wallpaperId must start/i);
        });
      });

      it('displays error alert with message', async () => {
        mockRequest.mockRejectedValueOnce({
          response: {
            errors: [{ message: 'Validation error' }],
          },
        });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const alert = screen.getByRole('alert');
          expect(alert).toBeInTheDocument();
        });
      });
    });

    describe('Network Error', () => {
      it('shows network error alert', async () => {
        mockRequest.mockRejectedValueOnce(new Error('Network error'));

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const alert = screen.getByRole('alert');
          expect(alert).toHaveTextContent(/error|failed/i);
        });
      });

      it('displays retry button', async () => {
        mockRequest.mockRejectedValueOnce(new Error('Network error'));

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const retryButton = screen.getByRole('button', { name: /retry/i });
          expect(retryButton).toBeInTheDocument();
        });
      });

      it('refetches on retry click', async () => {
        mockRequest
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({
            getWallpaper: createMockWallpaper('wlpr_test123'),
          });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const retryButton = screen.getByRole('button', { name: /retry/i });
          fireEvent.click(retryButton);
        });

        await waitFor(() => {
          const image = screen.getByAltText(/wallpaper/i);
          expect(image).toBeInTheDocument();
        });
      });
    });
  });

  describe('Panel Behavior', () => {
    describe('Desktop', () => {
      beforeEach(() => {
        // Mock desktop viewport
        Object.defineProperty(window, 'matchMedia', {
          writable: true,
          value: vi.fn().mockImplementation((query) => ({
            matches: query.includes('max-width') ? false : true,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          })),
        });
      });

      it('opens panel on right side by default', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const panel = screen.getByRole('dialog');
          expect(panel).toBeInTheDocument();
          expect(panel).toHaveClass(/right/);
        });
      });

      it('persists panel state to localStorage', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          expect(mockStorage['wallpaper-detail-panel-open']).toBeDefined();
        });
      });

      it('restores panel state from localStorage', async () => {
        mockStorage['wallpaper-detail-panel-open'] = JSON.stringify(false);
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const panel = screen.queryByRole('dialog');
          // Panel should be closed based on localStorage
          expect(panel?.getAttribute('data-state')).toBe('closed');
        });
      });

      it('toggles panel when toggle button clicked', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const toggleButton = screen.getByRole('button', { name: /toggle/i });
          fireEvent.click(toggleButton);
        });

        // Panel state should update
        expect(mockStorage['wallpaper-detail-panel-open']).toBeDefined();
      });
    });

    describe('Mobile', () => {
      beforeEach(() => {
        // Mock mobile viewport
        Object.defineProperty(window, 'matchMedia', {
          writable: true,
          value: vi.fn().mockImplementation((query) => ({
            matches: query.includes('max-width') ? true : false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          })),
        });
      });

      it('closes panel by default on mobile', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const panel = screen.queryByRole('dialog');
          expect(panel?.getAttribute('data-state')).toBe('closed');
        });
      });

      it('shows "View Details" peek button when closed', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const peekButton = screen.getByRole('button', {
            name: /view details/i,
          });
          expect(peekButton).toBeInTheDocument();
        });
      });

      it('opens panel from bottom when peek button clicked', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const peekButton = screen.getByRole('button', {
            name: /view details/i,
          });
          fireEvent.click(peekButton);
        });

        const panel = screen.getByRole('dialog');
        expect(panel).toHaveClass(/bottom/);
      });
    });
  });

  describe('Variant Selection', () => {
    it('starts with original variant (index 0)', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        // First variant (1920x1080 JPEG) should be displayed
        expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();
        expect(screen.getByText(/jpeg/i)).toBeInTheDocument();
      });
    });

    it('updates display when variant selected', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const variantButtons = screen.getAllByRole('button', {
          name: /set as display/i,
        });
        fireEvent.click(variantButtons[1]); // Select second variant
      });

      // Should now show second variant (1280x720 WebP)
      await waitFor(() => {
        expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
        expect(screen.getByText(/webp/i)).toBeInTheDocument();
      });
    });

    it('resets image loading state on variant change', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const image = screen.getByAltText(/wallpaper/i);
        fireEvent.load(image); // Mark as loaded
      });

      // Change variant
      const variantButtons = screen.getAllByRole('button', {
        name: /set as display/i,
      });
      fireEvent.click(variantButtons[1]);

      // Should show loading state again
      await waitFor(() => {
        const skeleton = screen.queryByTestId('wallpaper-skeleton');
        expect(skeleton).toBeInTheDocument();
      });
    });

    it('updates "Viewing" indicator', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(screen.getByText(/viewing.*1920.*1080/i)).toBeInTheDocument();
      });

      // Change variant
      const variantButtons = screen.getAllByRole('button', {
        name: /set as display/i,
      });
      fireEvent.click(variantButtons[1]);

      await waitFor(() => {
        expect(screen.getByText(/viewing.*1280.*720/i)).toBeInTheDocument();
      });
    });
  });

  describe('Download Dropdown', () => {
    it('shows "Download original" as button text', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', {
          name: /download original/i,
        });
        expect(downloadButton).toBeInTheDocument();
      });
    });

    it('lists all variants in dropdown', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', {
          name: /download original/i,
        });
        fireEvent.click(downloadButton);
      });

      // Should show all variants
      await waitFor(() => {
        expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();
        expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
      });
    });

    it('shows "(original)" suffix on first variant', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', {
          name: /download original/i,
        });
        fireEvent.click(downloadButton);
      });

      const originalLabel = screen.getAllByText(/original/i);
      expect(originalLabel.length).toBeGreaterThan(0);
    });

    it('shows "viewing" badge on current variant', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', {
          name: /download original/i,
        });
        fireEvent.click(downloadButton);
      });

      const viewingBadge = screen.getByText(/viewing/i);
      expect(viewingBadge).toBeInTheDocument();
    });

    it('downloads variant when dropdown item clicked', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', {
          name: /download original/i,
        });
        fireEvent.click(downloadButton);
      });

      const menuItems = screen.getAllByRole('menuitem');
      fireEvent.click(menuItems[0]);

      expect(mockDownloadVariant).toHaveBeenCalledWith(
        mockWallpaper.variants[0],
      );
    });

    it('formats variant info correctly (format + resolution + size)', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', {
          name: /download original/i,
        });
        fireEvent.click(downloadButton);
      });

      // Should show format, resolution, and file size
      expect(screen.getByText(/jpeg/i)).toBeInTheDocument();
      expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();
      expect(screen.getByText(/KB|MB/i)).toBeInTheDocument();
    });
  });

  describe('Share Functionality', () => {
    describe('Desktop', () => {
      beforeEach(() => {
        // Mock desktop (navigator.share not typically available)
        delete (navigator as any).share;
      });

      it('copies URL to clipboard when share clicked', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const shareButton = screen.getByRole('button', { name: /share/i });
          fireEvent.click(shareButton);
        });

        expect(navigator.clipboard.writeText).toHaveBeenCalled();
      });

      it('shows toast notification on copy', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const shareButton = screen.getByRole('button', { name: /share/i });
          fireEvent.click(shareButton);
        });

        // Should show success toast
        await waitFor(() => {
          const toast = screen.getByText(/copied/i);
          expect(toast).toBeInTheDocument();
        });
      });
    });

    describe('Mobile', () => {
      beforeEach(() => {
        // Mock mobile (navigator.share available)
        Object.defineProperty(navigator, 'share', {
          value: vi.fn(() => Promise.resolve()),
          writable: true,
          configurable: true,
        });
      });

      it('calls navigator.share with title, text, url', async () => {
        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const shareButton = screen.getByRole('button', { name: /share/i });
          fireEvent.click(shareButton);
        });

        expect(navigator.share).toHaveBeenCalledWith({
          title: expect.any(String),
          text: expect.any(String),
          url: expect.any(String),
        });
      });

      it('falls back to clipboard copy if share fails', async () => {
        (navigator.share as any).mockRejectedValueOnce(
          new Error('User cancelled'),
        );

        const mockWallpaper = createMockWallpaper('wlpr_test123');
        mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

        render(<WallpaperDetailPage />, {
          wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
          const shareButton = screen.getByRole('button', { name: /share/i });
          fireEvent.click(shareButton);
        });

        // Should fall back to clipboard
        await waitFor(() => {
          expect(navigator.clipboard.writeText).toHaveBeenCalled();
        });
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('toggles panel on "I" key', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'i', code: 'KeyI' });
      });

      // Panel state should toggle
      expect(mockStorage['wallpaper-detail-panel-open']).toBeDefined();
    });

    it('downloads current variant on "D" key', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'd', code: 'KeyD' });
      });

      expect(mockDownloadVariant).toHaveBeenCalledWith(
        mockWallpaper.variants[0],
      );
    });

    it('shares on "S" key', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        fireEvent.keyDown(document, { key: 's', code: 'KeyS' });
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('closes panel on "Escape" key (if open)', async () => {
      mockStorage['wallpaper-detail-panel-open'] = JSON.stringify(true);

      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      });

      // Panel should be closed
      expect(JSON.parse(mockStorage['wallpaper-detail-panel-open'])).toBe(
        false,
      );
    });

    it('selects previous variant on "←" key', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      // First select second variant
      await waitFor(() => {
        const variantButtons = screen.getAllByRole('button', {
          name: /set as display/i,
        });
        fireEvent.click(variantButtons[1]);
      });

      // Then go back with arrow key
      fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft' });

      // Should be back to first variant
      await waitFor(() => {
        expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();
      });
    });

    it('selects next variant on "→" key', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight' });
      });

      // Should move to second variant
      await waitFor(() => {
        expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
      });
    });

    it('wraps around at boundaries (first/last variant)', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      // At first variant, pressing left should wrap to last
      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft' });
      });

      // Should wrap to last variant (1280x720)
      await waitFor(() => {
        expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
      });
    });

    it('does not interfere when typing in input fields', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      const { container } = render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      // Create and focus an input
      const input = document.createElement('input');
      container.appendChild(input);
      input.focus();

      fireEvent.keyDown(input, { key: 'd', code: 'KeyD' });

      // Should not trigger download
      expect(mockDownloadVariant).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('has semantic HTML (header, main)', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      const { container } = render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(container.querySelector('header')).toBeInTheDocument();
        expect(container.querySelector('main')).toBeInTheDocument();
      });
    });

    it('has ARIA labels on icon-only buttons', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        buttons.forEach((button) => {
          expect(button).toHaveAccessibleName();
        });
      });
    });

    it('supports keyboard navigation (tab order)', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const focusableElements = screen.getAllByRole('button');
        focusableElements.forEach((element) => {
          expect(element).not.toHaveAttribute('tabindex', '-1');
        });
      });
    });

    it('has visible focus indicators', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      const { container } = render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        // Focus styles should be present
        const buttons = container.querySelectorAll('button');
        buttons.forEach((button) => {
          expect(button).toHaveClass(/focus/);
        });
      });
    });
  });

  describe('Image Loading', () => {
    it('shows loading state while image loads', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const skeleton = screen.getByTestId('wallpaper-skeleton');
        expect(skeleton).toBeInTheDocument();
      });
    });

    it('transitions smoothly when image loaded', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const image = screen.getByAltText(/wallpaper/i);
        fireEvent.load(image);
      });

      const image = screen.getByAltText(/wallpaper/i);
      expect(image).toHaveClass(/transition/);
    });

    it('resets loading on variant change', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const image = screen.getByAltText(/wallpaper/i);
        fireEvent.load(image);
      });

      // Change variant
      const variantButtons = screen.getAllByRole('button', {
        name: /set as display/i,
      });
      fireEvent.click(variantButtons[1]);

      // Should show loading skeleton again
      await waitFor(() => {
        const skeleton = screen.queryByTestId('wallpaper-skeleton');
        expect(skeleton).toBeInTheDocument();
      });
    });
  });

  describe('Viewing Indicator', () => {
    it('displays current variant format', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(screen.getByText(/jpeg/i)).toBeInTheDocument();
      });
    });

    it('displays current variant dimensions', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(screen.getByText(/1920.*1080/)).toBeInTheDocument();
      });
    });

    it('shows "original" badge for first variant', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const originalBadges = screen.getAllByText(/original/i);
        expect(originalBadges.length).toBeGreaterThan(0);
      });
    });

    it('updates when variant changes', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const variantButtons = screen.getAllByRole('button', {
          name: /set as display/i,
        });
        fireEvent.click(variantButtons[1]);
      });

      // Should update to show second variant
      await waitFor(() => {
        expect(screen.getByText(/webp/i)).toBeInTheDocument();
        expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
      });
    });

    it('is centered below image', async () => {
      const mockWallpaper = createMockWallpaper('wlpr_test123');
      mockRequest.mockResolvedValueOnce({ getWallpaper: mockWallpaper });

      const { container } = render(<WallpaperDetailPage />, {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const indicator = container.querySelector('[data-testid="viewing-indicator"]');
        expect(indicator).toHaveClass(/center|mx-auto/);
      });
    });
  });
});
