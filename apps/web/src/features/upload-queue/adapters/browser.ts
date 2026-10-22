import { uploadFirstSource } from '@/features/wallpaper-creation';
import { browserCreationApi } from '@/features/wallpaper-creation/adapters/http';
import { createUploadQueue } from '../index';

export function createBrowserUploadQueue() {
  const keys = new WeakMap<File, string>();
  const api = browserCreationApi();
  return createUploadQueue<File>({
    upload(file) {
      const controller = new AbortController();
      return {
        result: (async () => {
          let key = keys.get(file);
          if (!key) {
            key = crypto.randomUUID();
            keys.set(file, key);
          }
          try {
            const result = await uploadFirstSource(
              api,
              { value: file, size: file.size },
              key,
              controller.signal
            );
            return {
              success: result.kind === 'published',
              pending: result.kind === 'pending',
              isDuplicate: false,
              response: {
                wallpaperId: result.wallpaper.wallpaperId,
                uploadState: result.wallpaper.state,
                assetId: result.wallpaper.assetId,
                sourceId: result.wallpaper.sourceId,
              },
            };
          } catch (error) {
            return {
              success: false,
              isDuplicate: false,
              error: {
                type: 'server' as const,
                message:
                  error instanceof Error
                    ? error.message
                    : 'Wallpaper creation could not be confirmed. Check recent creations.',
              },
            };
          }
        })(),
        cancel: () => controller.abort(),
      };
    },
    clock: {
      now: () => Date.now(),
      schedule(delayMs, callback) {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
      },
    },
  });
}
