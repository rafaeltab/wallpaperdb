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
