import { shareWallpaperLink } from '@/features/wallpaper-details';

/**
 * Share a wallpaper's detail page URL
 *
 * Uses native share API when available (mobile devices),
 * falls back to clipboard. The caller owns completion feedback.
 *
 * @param wallpaperId - The wallpaper ID
 */
export function shareWallpaper(wallpaperId: string) {
  const basePath = import.meta.env.VITE_BASE_PATH || '';
  const url = `${window.location.origin}${basePath}/wallpapers/${wallpaperId}`;

  return shareWallpaperLink(url, {
    share: navigator.share
      ? (url) => navigator.share({ title: 'Wallpaper', text: 'Check out this wallpaper', url })
      : undefined,
    copy: (url) => navigator.clipboard.writeText(url),
  });
}
