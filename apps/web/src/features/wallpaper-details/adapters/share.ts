import { shareWallpaperLink } from '@/features/wallpaper-details';
import { toast } from 'sonner';

/**
 * Share a wallpaper's detail page URL
 *
 * Uses native share API when available (mobile devices),
 * falls back to clipboard with toast notification.
 *
 * @param wallpaperId - The wallpaper ID
 * @returns Promise<void>
 */
export async function shareWallpaper(wallpaperId: string): Promise<void> {
  const basePath = import.meta.env.VITE_BASE_PATH || '';
  const url = `${window.location.origin}${basePath}/wallpapers/${wallpaperId}`;

  const result = await shareWallpaperLink(url, {
    share: navigator.share
      ? (url) => navigator.share({ title: 'Wallpaper', text: 'Check out this wallpaper', url })
      : undefined,
    copy: (url) => navigator.clipboard.writeText(url),
  });
  if (result === 'copied') toast.success('Link copied to clipboard');
  if (result === 'failed') toast.error('Failed to copy link');
}
