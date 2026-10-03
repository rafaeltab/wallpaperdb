import { uploadWallpaperWithDetails } from '@/lib/api/ingestor';
import { createUploadQueue } from '../index';

export function createBrowserUploadQueue() {
  return createUploadQueue<File>({
    upload(file) {
      const controller = new AbortController();
      return {
        result: uploadWallpaperWithDetails(file, 'user_demo_001', controller.signal),
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
