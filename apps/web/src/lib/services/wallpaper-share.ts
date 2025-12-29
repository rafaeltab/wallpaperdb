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
  const url = `${window.location.origin}/wallpapers/${wallpaperId}`;

  // Try native share on mobile first
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Wallpaper',
        text: 'Check out this wallpaper',
        url,
      });
      return;
    } catch {
      // User cancelled or share failed, fall through to clipboard
    }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  } catch {
    toast.error('Failed to copy link');
  }
}
