import type { UploadResult } from '@/features/upload-queue';
import { uploadFirstSource } from '@/features/wallpaper-creation';
import { browserCreationApi } from '@/features/wallpaper-creation/adapters/http';
export type { UploadResult } from '@/features/upload-queue';
/** The queue owns the stable request key and the originating session lifetime. */
export async function uploadWallpaperWithDetails(
  file: File,
  key: string | { readonly wallpaperId: string },
  signal: AbortSignal
): Promise<UploadResult> {
  try {
    const result = await uploadFirstSource(
      browserCreationApi(),
      { value: file, size: file.size },
      key,
      signal
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
        type: 'server',
        message:
          error instanceof Error
            ? error.message
            : 'Wallpaper creation could not be confirmed. Check recent creations.',
      },
    };
  }
}

export const resumeWallpaperWithDetails = (file: File, wallpaperId: string, signal: AbortSignal) =>
  uploadWallpaperWithDetails(file, { wallpaperId }, signal);
