import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mockUseSearch = vi.fn(() => ({}));
const mockNavigate = vi.fn();

function setScreenSize(width: number, height: number) {
  Object.defineProperty(window, 'screen', {
    configurable: true,
    value: {
      ...window.screen,
      width,
      height,
    },
  });
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => mockUseSearch(),
  }),
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/hooks/useWallpaperInfiniteQuery', () => ({
  useWallpaperInfiniteQuery: vi.fn(),
}));

vi.mock('@/components/browse-filter-panel-context', () => ({
  useBrowseFilterPanel: vi.fn(),
}));

vi.mock('@/components/WallpaperGrid', () => ({
  WallpaperGrid: () => <div data-testid="wallpaper-grid" />,
}));

vi.mock('@/components/LoadMoreTrigger', () => ({
  LoadMoreTrigger: () => null,
}));

vi.mock('@/components/grid', () => ({
  WallpaperGridSkeleton: () => <div data-testid="wallpaper-grid-skeleton" />,
}));

import { useBrowseFilterPanel } from '@/components/browse-filter-panel-context';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import { HomePage } from '@/routes/index';

describe('HomePage browse filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setScreenSize(1920, 1080);
    mockUseSearch.mockReturnValue({ after: undefined, format: undefined, aspectRatio: undefined });
    (useBrowseFilterPanel as Mock).mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      toggle: vi.fn(),
    });
    (useWallpaperInfiniteQuery as Mock).mockReturnValue({
      data: {
        pages: [
          {
            edges: [
              {
                node: {
                  wallpaperId: 'wlpr_123',
                  userId: 'user_1',
                  variants: [
                    {
                      width: 1920,
                      height: 1080,
                      aspectRatio: 1.78,
                      format: 'image/png',
                      fileSizeBytes: 100,
                      createdAt: '2025-01-01T00:00:00.000Z',
                      url: 'https://example.com/wallpaper.png',
                    },
                  ],
                  uploadedAt: '2025-01-01T00:00:00.000Z',
                  updatedAt: '2025-01-01T00:00:00.000Z',
                },
              },
            ],
          },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    });
  });

  it('passes the selected URL-backed format into wallpaper search', () => {
    mockUseSearch.mockReturnValue({ after: undefined, format: 'png', aspectRatio: undefined });

    render(<HomePage />);

    expect(useWallpaperInfiniteQuery).toHaveBeenCalledWith({
      filter: { variants: { format: 'image/png' } },
      initialCursor: null,
    });
  });

  it('passes the selected URL-backed aspect ratio into wallpaper search', () => {
    mockUseSearch.mockReturnValue({ after: undefined, format: undefined, aspectRatio: '21-9' });

    render(<HomePage />);

    expect(useWallpaperInfiniteQuery).toHaveBeenCalledWith({
      filter: { variants: { aspectRatio: 21 / 9 } },
      initialCursor: null,
    });
  });

  it('resolves the device aspect ratio before querying wallpapers', () => {
    mockUseSearch.mockReturnValue({ after: undefined, format: undefined, aspectRatio: 'device' });

    render(<HomePage />);

    expect(useWallpaperInfiniteQuery).toHaveBeenCalledWith({
      filter: { variants: { aspectRatio: 16 / 9 } },
      initialCursor: null,
    });
  });

  it('shows the active format as a neutral badge when the panel is collapsed', () => {
    mockUseSearch.mockReturnValue({ after: undefined, format: 'png', aspectRatio: undefined });

    render(<HomePage />);

    expect(screen.getByText('Format: PNG')).toBeInTheDocument();
    expect(screen.queryByText('JPEG')).not.toBeInTheDocument();
  });

  it('shows the resolved device aspect ratio as a neutral badge when the panel is collapsed', () => {
    mockUseSearch.mockReturnValue({ after: undefined, format: undefined, aspectRatio: 'device' });

    render(<HomePage />);

    expect(screen.getByText('Aspect ratio: Device 16:9')).toBeInTheDocument();
  });

  it('updates the route search state when a format is selected', async () => {
    const user = userEvent.setup();

    mockUseSearch.mockReturnValue({ after: 'cursor_123', format: undefined, aspectRatio: undefined });
    (useBrowseFilterPanel as Mock).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: 'PNG' }));

    expect(mockNavigate).toHaveBeenCalledWith({
      search: expect.any(Function),
      to: '/',
    });

    const navigateCall = mockNavigate.mock.calls[0][0];
    expect(navigateCall.search({ after: 'cursor_123', format: undefined, aspectRatio: undefined })).toEqual({
      after: undefined,
      format: 'png',
      aspectRatio: undefined,
    });
  });

  it('updates the route search state when an aspect ratio is selected', async () => {
    const user = userEvent.setup();

    mockUseSearch.mockReturnValue({ after: 'cursor_123', format: 'png', aspectRatio: undefined });
    (useBrowseFilterPanel as Mock).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);

    await user.click(screen.getByRole('button', { name: '16:10' }));

    const navigateCall = mockNavigate.mock.calls[0][0];
    expect(navigateCall.search({ after: 'cursor_123', format: 'png', aspectRatio: undefined })).toEqual({
      after: undefined,
      format: 'png',
      aspectRatio: '16-10',
    });
  });

  it('updates the device label when the active display context changes', async () => {
    mockUseSearch.mockReturnValue({ after: undefined, format: undefined, aspectRatio: 'device' });
    (useBrowseFilterPanel as Mock).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      toggle: vi.fn(),
    });

    render(<HomePage />);

    expect(screen.getByRole('button', { name: 'Device 16:9' })).toBeInTheDocument();

    setScreenSize(1080, 1920);
    window.dispatchEvent(new Event('resize'));

    expect(await screen.findByRole('button', { name: 'Device 9:16' })).toBeInTheDocument();
  });
});
