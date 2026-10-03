import type { UploadResponse, UploadResult } from '@/features/upload-queue';
import { getAuthToken } from '@/lib/auth/token-provider';

const INGESTOR_URL = import.meta.env.VITE_INGESTOR_URL || '/ingestor';

export type {
  UploadError,
  UploadErrorType,
  UploadResponse,
  UploadResult,
} from '@/features/upload-queue';

// Default retry-after for rate limits when header is missing
const DEFAULT_RETRY_AFTER = 60;

/**
 * Upload a wallpaper with detailed error handling.
 * Returns a structured result with success/failure info and error types.
 */
export async function uploadWallpaperWithDetails(
  file: File,
  userId: string,
  signal?: AbortSignal
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('userId', userId);

  try {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${INGESTOR_URL}/upload`, {
      method: 'POST',
      signal,
      body: formData,
      headers,
    });

    if (response.ok) {
      const data = await response.json();
      const isDuplicate = data.status === 'already_uploaded';
      return {
        success: true,
        isDuplicate,
        response: data,
      };
    }

    // Handle error responses
    let errorDetail = 'Upload failed';
    try {
      const errorData = await response.json();
      errorDetail = errorData.detail || errorDetail;
    } catch {
      // JSON parse failed, use default message
    }

    // Determine error type based on status code
    const status = response.status;

    if (status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfter = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10)
        : DEFAULT_RETRY_AFTER;

      return {
        success: false,
        isDuplicate: false,
        error: {
          type: 'rate_limit',
          message: errorDetail,
          retryAfter,
        },
      };
    }

    if (status === 400 || status === 413) {
      return {
        success: false,
        isDuplicate: false,
        error: {
          type: 'validation',
          message: errorDetail,
        },
      };
    }

    // 5xx or other errors
    return {
      success: false,
      isDuplicate: false,
      error: {
        type: 'server',
        message: errorDetail,
      },
    };
  } catch (error) {
    // Network error or other unexpected error
    return {
      success: false,
      isDuplicate: false,
      error: {
        type: 'network',
        message: error instanceof Error ? error.message : 'Network error',
      },
    };
  }
}

/**
 * Simple upload function for backwards compatibility.
 * Throws on error.
 */
export async function uploadWallpaper(file: File, userId: string): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('userId', userId);

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${INGESTOR_URL}/upload`, {
    method: 'POST',
    body: formData,
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Upload failed');
  }

  return response.json();
}
