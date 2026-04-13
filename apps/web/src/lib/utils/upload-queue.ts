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
