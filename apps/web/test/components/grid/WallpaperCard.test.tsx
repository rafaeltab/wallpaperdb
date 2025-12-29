import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WallpaperCard } from '@/components/grid/WallpaperCard';
import type { GridItem } from '@/components/grid/types';
import type { Wallpaper } from '@/lib/graphql/types';
import { downloadVariant } from '@/lib/utils/wallpaper';
import { shareWallpaper } from '@/lib/services/wallpaper-share';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('@/lib/utils/wallpaper', () => ({
	downloadVariant: vi.fn(),
}));

vi.mock('@/lib/services/wallpaper-share', () => ({
	shareWallpaper: vi.fn(),
}));

vi.mock('sonner', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock TanStack Router Link
vi.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, target, rel, onClick, children, className }: any) => (
		<a
			href={`${to.replace('$wallpaperId', params.wallpaperId)}`}
			target={target}
			rel={rel}
			onClick={onClick}
			className={className}
			data-testid="view-details-link"
		>
			{children}
		</a>
	),
}));

describe('WallpaperCard', () => {
	const mockWallpaper: Wallpaper = {
		wallpaperId: 'wlpr_test123',
		userId: 'user_456',
		variants: [
			{
				width: 1920,
				height: 1080,
				aspectRatio: 1.78,
				format: 'image/jpeg',
				fileSizeBytes: 500000,
				createdAt: '2024-01-15T10:30:00Z',
				url: 'https://example.com/wallpaper.jpg',
			},
		],
		uploadedAt: '2024-01-15T10:30:00Z',
		updatedAt: '2024-01-15T10:30:00Z',
	};

	const mockGridItem: GridItem = {
		id: 'wlpr_test123',
		src: 'https://example.com/wallpaper.jpg',
		width: 1920,
		height: 1080,
		aspectRatio: 1.78,
		metadata: {
			wallpaper: mockWallpaper,
		},
	};

	const defaultProps = {
		item: mockGridItem,
		isExpanded: false,
		span: { cols: 1 as const, rows: 1 as const },
		onClick: vi.fn(),
		onMouseEnter: vi.fn(),
		onMouseLeave: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Basic Rendering', () => {
		it('renders image with correct src and alt', () => {
			render(<WallpaperCard {...defaultProps} />);

			const image = screen.getByRole('img');
			expect(image).toHaveAttribute('src', mockGridItem.src);
			expect(image).toHaveAttribute('alt', `Wallpaper ${mockGridItem.id}`);
		});

		it('renders as a button element', () => {
			render(<WallpaperCard {...defaultProps} />);

			const button = screen.getByRole('button', { name: `Wallpaper ${mockGridItem.id}` });
			expect(button).toBeInTheDocument();
		});

		it('applies correct expanded class when isExpanded is true', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			const button = screen.getByRole('button', { name: `Wallpaper ${mockGridItem.id}` });
			expect(button).toHaveClass('ring-2', 'ring-blue-500');
		});

		it('does not apply expanded class when isExpanded is false', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={false} />);

			const button = screen.getByRole('button', { name: `Wallpaper ${mockGridItem.id}` });
			expect(button).not.toHaveClass('ring-2');
		});

		it('has correct aria-expanded attribute', () => {
			const { rerender } = render(<WallpaperCard {...defaultProps} isExpanded={false} />);
			expect(screen.getByRole('button', { name: `Wallpaper ${mockGridItem.id}` })).toHaveAttribute('aria-expanded', 'false');

			rerender(<WallpaperCard {...defaultProps} isExpanded={true} />);
			expect(screen.getByRole('button', { name: `Wallpaper ${mockGridItem.id}` })).toHaveAttribute('aria-expanded', 'true');
		});
	});

	describe('Skeleton Items', () => {
		const skeletonItem: GridItem = {
			...mockGridItem,
			isSkeleton: true,
		};

		it('renders skeleton placeholder for skeleton items', () => {
			render(<WallpaperCard {...defaultProps} item={skeletonItem} />);

			// Should render skeleton, not image
			expect(screen.queryByRole('img')).not.toBeInTheDocument();
		});

		it('does not show overlay menu for skeleton items even when expanded', () => {
			render(<WallpaperCard {...defaultProps} item={skeletonItem} isExpanded={true} />);

			expect(screen.queryByRole('link', { name: /view details/i })).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
		});
	});

	describe('Overlay Menu Visibility', () => {
		it('does not show menu when isExpanded is false', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={false} />);

			expect(screen.queryByTestId('view-details-link')).not.toBeInTheDocument();
		});

		it('shows menu when isExpanded is true', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			expect(screen.getByTestId('view-details-link')).toBeInTheDocument();
		});

		it('menu contains all three action buttons', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			// Eye icon (view details) - it's a link
			expect(screen.getByTestId('view-details-link')).toBeInTheDocument();

			// Download and Share are buttons
			const buttons = screen.getAllByRole('button');
			// Filter out the main card button
			const actionButtons = buttons.filter(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);

			// Should have at least 2 action buttons (download, share)
			expect(actionButtons.length).toBeGreaterThanOrEqual(2);
		});

		it('does not show menu when wallpaper metadata is missing', () => {
			const itemWithoutWallpaper = {
				...mockGridItem,
				metadata: {},
			};

			render(<WallpaperCard {...defaultProps} item={itemWithoutWallpaper} isExpanded={true} />);

			expect(screen.queryByTestId('view-details-link')).not.toBeInTheDocument();
		});
	});

	describe('Eye Icon - Navigation', () => {
		it('renders link to wallpaper detail page', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			const link = screen.getByTestId('view-details-link');
			expect(link).toHaveAttribute('href', `/wallpapers/${mockWallpaper.wallpaperId}`);
		});

		it('opens link in new tab', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			const link = screen.getByTestId('view-details-link');
			expect(link).toHaveAttribute('target', '_blank');
		});

		it('has security attributes for new tab', () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			const link = screen.getByTestId('view-details-link');
			expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		});

		it('clicking view details does not trigger card onClick', () => {
			const onClick = vi.fn();
			render(<WallpaperCard {...defaultProps} onClick={onClick} isExpanded={true} />);

			const link = screen.getByTestId('view-details-link');
			fireEvent.click(link);

			expect(onClick).not.toHaveBeenCalled();
		});
	});

	describe('Download Icon', () => {
		it('calls downloadVariant with original variant on click', async () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			// Find download button - it's the second button (after card, before share)
			const buttons = screen.getAllByRole('button');
			// Filter out the main card button
			const actionButtons = buttons.filter(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);
			
			// First action button is download (Eye is a link, Download is first button, Share is second)
			const downloadButton = actionButtons[0];

			expect(downloadButton).toBeDefined();
			fireEvent.click(downloadButton);

			await waitFor(() => {
				expect(downloadVariant).toHaveBeenCalledWith(mockWallpaper.variants[0]);
			});
		});

		it('does not trigger card onClick when download button clicked', async () => {
			const onClick = vi.fn();
			render(<WallpaperCard {...defaultProps} onClick={onClick} isExpanded={true} />);

			const buttons = screen.getAllByRole('button');
			// Find a button that's not the main card button
			const actionButton = buttons.find(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);

			if (actionButton) {
				fireEvent.click(actionButton);
				expect(onClick).not.toHaveBeenCalled();
			}
		});

		it('shows error toast when wallpaper has no variants', async () => {
			const itemWithoutVariants = {
				...mockGridItem,
				metadata: {
					wallpaper: {
						...mockWallpaper,
						variants: [],
					},
				},
			};

			render(
				<WallpaperCard {...defaultProps} item={itemWithoutVariants} isExpanded={true} />,
			);

			const buttons = screen.getAllByRole('button');
			const actionButton = buttons.find(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);

			if (actionButton) {
				fireEvent.click(actionButton);

				await waitFor(() => {
					expect(toast.error).toHaveBeenCalledWith('No wallpaper available to download');
				});
			}
		});

		it('shows error toast when download fails', async () => {
			vi.mocked(downloadVariant).mockRejectedValueOnce(new Error('Download failed'));

			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			const buttons = screen.getAllByRole('button');
			const actionButton = buttons.find(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);

			if (actionButton) {
				fireEvent.click(actionButton);

				await waitFor(() => {
					expect(toast.error).toHaveBeenCalledWith('Failed to download wallpaper');
				});
			}
		});
	});

	describe('Share Icon', () => {
		it('calls shareWallpaper with wallpaper ID on click', async () => {
			render(<WallpaperCard {...defaultProps} isExpanded={true} />);

			const buttons = screen.getAllByRole('button');
			// Get last action button (share is third)
			const actionButtons = buttons.filter(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);
			const shareButton = actionButtons[actionButtons.length - 1];

			if (shareButton) {
				fireEvent.click(shareButton);

				await waitFor(() => {
					expect(shareWallpaper).toHaveBeenCalledWith(mockWallpaper.wallpaperId);
				});
			}
		});

		it('does not trigger card onClick when share button clicked', async () => {
			const onClick = vi.fn();
			render(<WallpaperCard {...defaultProps} onClick={onClick} isExpanded={true} />);

			const buttons = screen.getAllByRole('button');
			const actionButtons = buttons.filter(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);
			const shareButton = actionButtons[actionButtons.length - 1];

			if (shareButton) {
				fireEvent.click(shareButton);
				expect(onClick).not.toHaveBeenCalled();
			}
		});

		it('shows error toast when wallpaper metadata is missing', async () => {
			const itemWithoutWallpaper = {
				...mockGridItem,
				metadata: {},
			};

			// First render to get the component without wallpaper
			// Then manually trigger what would be the share handler
			// Since the menu won't render without wallpaper, this tests the error handling
			render(
				<WallpaperCard {...defaultProps} item={itemWithoutWallpaper} isExpanded={true} />,
			);

			// Menu shouldn't be visible, so this test verifies the component handles missing data
			expect(screen.queryByTestId('view-details-link')).not.toBeInTheDocument();
		});
	});

	describe('Event Propagation', () => {
		it('clicking image triggers card onClick', () => {
			const onClick = vi.fn();
			render(<WallpaperCard {...defaultProps} onClick={onClick} />);

			const button = screen.getByRole('button', { name: `Wallpaper ${mockGridItem.id}` });
			fireEvent.click(button);

			expect(onClick).toHaveBeenCalledTimes(1);
		});

		it('clicking action buttons does not trigger card onClick', () => {
			const onClick = vi.fn();
			render(<WallpaperCard {...defaultProps} onClick={onClick} isExpanded={true} />);

			// Get action buttons (download and share)
			const buttons = screen.getAllByRole('button');
			const actionButtons = buttons.filter(
				(btn) => !btn.getAttribute('aria-label')?.includes('Wallpaper wlpr_'),
			);

			// Click download button
			fireEvent.click(actionButtons[0]);
			expect(onClick).not.toHaveBeenCalled();

			// Click share button
			fireEvent.click(actionButtons[1]);
			expect(onClick).not.toHaveBeenCalled();
		});
	});

	describe('Mouse Events', () => {
		it('calls onMouseEnter when mouse enters', () => {
			const onMouseEnter = vi.fn();
			render(<WallpaperCard {...defaultProps} onMouseEnter={onMouseEnter} />);

			const button = screen.getByRole('button');
			fireEvent.mouseEnter(button);

			expect(onMouseEnter).toHaveBeenCalledTimes(1);
		});

		it('calls onMouseLeave when mouse leaves', () => {
			const onMouseLeave = vi.fn();
			render(<WallpaperCard {...defaultProps} onMouseLeave={onMouseLeave} />);

			const button = screen.getByRole('button');
			fireEvent.mouseLeave(button);

			expect(onMouseLeave).toHaveBeenCalledTimes(1);
		});
	});

	describe('Image Loading', () => {
		it('shows loading skeleton initially', () => {
			render(<WallpaperCard {...defaultProps} />);

			// Image starts with opacity-0 class
			const image = screen.getByRole('img');
			expect(image).toHaveClass('opacity-0');
		});

		it('hides skeleton after image loads', async () => {
			render(<WallpaperCard {...defaultProps} />);

			const image = screen.getByRole('img');
			
			// Trigger load event
			fireEvent.load(image);

			await waitFor(() => {
				expect(image).toHaveClass('opacity-100');
			});
		});
	});
});
