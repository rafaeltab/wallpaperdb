import { uploadWallpaperWithDetails } from '@/lib/api/wallpaper';
import { createUploadQueue } from '../index';

export function createBrowserUploadQueue() {
  const keys = new WeakMap<File, string>();
  return createUploadQueue<File>({
    upload(file) {
      const controller = new AbortController();
      return {
        result: uploadWallpaperWithDetails(
          file,
          keys.get(file) ??
            (() => {
              const key = crypto.randomUUID();
              keys.set(file, key);
              return key;
            })(),
          controller.signal
        ),
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
