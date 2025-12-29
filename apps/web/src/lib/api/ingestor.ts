const INGESTOR_URL = import.meta.env.VITE_INGESTOR_URL || 'http://localhost:3001';

export interface UploadResponse {
  wallpaperId: string;
  userId: string;
  uploadState: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  aspectRatio: number;
  uploadedAt: string;
}

// Error types for structured error handling
export type UploadErrorType = 'rate_limit' | 'validation' | 'server' | 'network';

export interface UploadError {
  type: UploadErrorType;
  message: string;
  retryAfter?: number;
}

// Structured upload result
export interface UploadResult {
  success: boolean;
  isDuplicate: boolean;
  response?: UploadResponse;
  error?: UploadError;
}

// Default retry-after for rate limits when header is missing
const DEFAULT_RETRY_AFTER = 60;

/**
 * Upload a wallpaper with detailed error handling.
 * Returns a structured result with success/failure info and error types.
 */
export async function uploadWallpaperWithDetails(
  file: File,
  userId: string
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('userId', userId);

  try {
    const response = await fetch(`${INGESTOR_URL}/upload`, {
      method: 'POST',
      body: formData,
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

  const response = await fetch(`${INGESTOR_URL}/upload`, {
    method: 'POST',
    body: formData,
    // Future: Add auth headers
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Upload failed');
  }

  return response.json();
}
