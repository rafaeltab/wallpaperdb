export const MAX_FILES_PER_BATCH = 200;

export type FileStatus = 'pending' | 'uploading' | 'success' | 'failed' | 'duplicate';
export type UploadErrorType = 'rate_limit' | 'validation' | 'server' | 'network';

export interface UploadError {
  type: UploadErrorType;
  message: string;
  retryAfter?: number;
}

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

export interface UploadResult {
  success: boolean;
  isDuplicate: boolean;
  response?: UploadResponse;
  error?: UploadError;
}

export interface QueuedFile<TFile> {
  id: string;
  file: TFile;
  status: FileStatus;
  error?: UploadError;
  response?: UploadResponse;
}

export interface UploadQueueState<TFile> {
  files: QueuedFile<TFile>[];
  isProcessing: boolean;
  isPaused: boolean;
  isStopped: boolean;
  pausedUntil: number | null;
}

export interface UploadQueueSnapshot<TFile> {
  state: UploadQueueState<TFile>;
  counts: Record<FileStatus | 'total', number>;
  progress: number;
}

export interface UploadQueueDependencies<TFile> {
  upload: (file: TFile) => { result: Promise<UploadResult>; cancel: () => void };
  clock: {
    now: () => number;
    schedule: (delayMs: number, callback: () => void) => () => void;
  };
}
