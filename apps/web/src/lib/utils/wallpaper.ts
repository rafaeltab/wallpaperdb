import type { Variant } from '@/lib/graphql/types';

/**
 * Format bytes to human-readable file size (e.g., "2.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format aspect ratio to readable format (e.g., "16:9" or "1.78")
 */
export function formatAspectRatio(ratio: number): string {
  const commonRatios: Record<string, string> = {
    '1.00': '1:1',
    '1.33': '4:3',
    '1.50': '3:2',
    '1.78': '16:9',
    '2.33': '21:9',
  };

  const rounded = ratio.toFixed(2);
  return commonRatios[rounded] || rounded;
}

/**
 * Format ISO date to readable format (e.g., "Dec 20, 2024, 3:45 PM")
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });
}

/**
 * Truncate ID for display (e.g., "wlpr_01JFABC...")
 */
export function truncateId(id: string): string {
  if (id.length <= 15) {
    return id;
  }
  return `${id.slice(0, 12)}...`;
}

/**
 * Sort variants by quality (resolution descending, highest first)
 */
export function sortVariantsByQuality(variants: Variant[]): Variant[] {
  return [...variants].sort((a, b) => {
    const resolutionA = a.width * a.height;
    const resolutionB = b.width * b.height;
    return resolutionB - resolutionA;
  });
}

/**
 * Download variant using Cache API for local-first performance
 */
export async function downloadVariant(variant: Variant): Promise<void> {
  let blob: Blob;
  let cache: Cache | null = null;

  try {
    // Try Cache API first
    cache = await caches.open('wallpaper-variants');
    const cachedResponse = await cache.match(variant.url);

    if (cachedResponse) {
      // Use cached blob
      blob = await cachedResponse.blob();
      // No need to fetch, return early after download
      // Fall through to download trigger
    } else {
      // Cache miss, fetch from network
      const response = await fetch(variant.url);

      if (!response.ok) {
        throw new Error(`Failed to fetch variant: ${response.status} ${response.statusText}`);
      }

      blob = await response.blob();

      // Cache for future use
      await cache.put(variant.url, new Response(blob.slice()));
    }
  } catch (error) {
    // Cache API not available or fetch failed
    // If cache failed initially, try fetch without caching
    if (!cache) {
      const response = await fetch(variant.url);

      if (!response.ok) {
        throw new Error(`Failed to fetch variant: ${response.status} ${response.statusText}`);
      }

      blob = await response.blob();
    } else {
      // Cache was available but fetch or caching failed, re-throw
      throw error;
    }
  }

  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  // Format: wallpaper-{width}x{height}.{ext}
  const ext = variant.format.split('/')[1];
  // Handle "jpeg" -> "jpg" conversion
  const fileExt = ext === 'jpeg' ? 'jpg' : ext;
  link.download = `wallpaper-${variant.width}x${variant.height}.${fileExt}`;

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
