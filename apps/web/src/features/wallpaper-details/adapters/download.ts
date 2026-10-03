import { downloadWallpaper } from '..';
import type { Variant } from '@/lib/graphql/types';
export function downloadVariant(variant: Variant): Promise<void> {
  return downloadWallpaper<Blob>(variant, {
    async openCache() {
      const cache = await caches.open('wallpaper-variants');
      return {
        async read(url) {
          const response = await cache.match(url);
          return response?.blob();
        },
        async write(url, payload) {
          await cache.put(url, new Response(payload.slice()));
        },
      };
    },
    async fetchPayload(url) {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Failed to fetch variant: ${response.status} ${response.statusText}`);
      return response.blob();
    },
    save(payload, filename) {
      const url = URL.createObjectURL(payload);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });
}
