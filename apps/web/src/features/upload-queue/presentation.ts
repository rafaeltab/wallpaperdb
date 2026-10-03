import type { FileStatus } from './contract';
export function acceptedUploads<T extends { type: string; size: number }>(
  selected: readonly T[],
  maxFiles?: number
): { files: T[]; rejectionMessage: string | null } {
  const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const maxBytes = 50 * 1024 * 1024;
  const unsupported = selected.some((file) => !supported.has(file.type));
  const oversized = selected.some((file) => supported.has(file.type) && file.size > maxBytes);
  const files = selected.filter((file) => supported.has(file.type) && file.size <= maxBytes);
  return {
    files: maxFiles === undefined ? files : files.slice(0, Math.max(0, maxFiles)),
    rejectionMessage:
      [
        unsupported && 'Only JPEG, PNG, and WebP images are supported.',
        oversized && 'Images must be 50 MiB or smaller.',
      ]
        .filter(Boolean)
        .join(' ') || null,
  };
}
export function queuePresentation(state: {
  files: readonly { status: FileStatus }[];
  isPaused: boolean;
  isStopped: boolean;
}) {
  const hasFiles = state.files.length > 0;
  const isUploading = state.files.some(
    (file) => file.status === 'pending' || file.status === 'uploading'
  );
  const isComplete = hasFiles && !isUploading && !state.isPaused && !state.isStopped;
  const hasFailures = state.files.some((file) => file.status === 'failed');
  const hasFailuresOrDuplicates =
    hasFailures || state.files.some((file) => file.status === 'duplicate');
  return {
    hasFiles,
    isUploading,
    isComplete,
    isRunning: isUploading && !state.isPaused && !state.isStopped,
    hasFailures,
    hasFailuresOrDuplicates,
    autoDismiss: isComplete && !hasFailuresOrDuplicates,
  };
}

export function formatTimeRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export interface QueueStatusTextParams {
  isStopped: boolean;
  isPaused: boolean;
  isUploading: boolean;
  isComplete: boolean;
  hasFiles: boolean;
  completedCount: number;
  totalCount: number;
  timeRemaining: string | null;
}

export function getQueueStatusText(params: QueueStatusTextParams): string {
  const {
    isStopped,
    isPaused,
    isUploading,
    isComplete,
    hasFiles,
    completedCount,
    totalCount,
    timeRemaining,
  } = params;

  if (isStopped) return 'Stopped';
  if (isPaused) {
    if (timeRemaining) return `Paused (resuming in ${timeRemaining})`;
    return 'Paused (rate limited)';
  }
  if (isUploading) return `Uploading ${completedCount}/${totalCount}...`;
  if (isComplete) return 'Upload complete';
  if (hasFiles) return 'Ready to upload';
  return '';
}
