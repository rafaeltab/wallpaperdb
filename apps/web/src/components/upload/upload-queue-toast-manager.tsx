import { queuePresentation } from '@/features/upload-queue';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useUploadQueue } from '@/contexts/upload-queue-context';
import { UploadQueueToast } from './upload-queue-toast';

const AUTO_DISMISS_DELAY = 5000; // 5 seconds

export function UploadQueueToastManager() {
  const { state, counts, progress, clearCompleted, retryFailed, stopQueue, resumeQueue } =
    useUploadQueue();
  const router = useRouter();
  const toastPrefix = useId();
  const toastGeneration = useRef(0);
  const toastId = useRef<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { hasFiles, isUploading, autoDismiss } = queuePresentation(state);

  const currentFiles = useRef(state.files);
  currentFiles.current = state.files;

  const handleDismiss = useCallback(() => {
    const dismissedIds = new Set(state.files.map((file) => file.id));
    const hasRemainingFiles = currentFiles.current.some(
      (file) =>
        !dismissedIds.has(file.id) || file.status === 'pending' || file.status === 'uploading'
    );
    if (!hasRemainingFiles) {
      setIsVisible(false);
      setIsExpanded(false);
    }
    // Sonner owns the exit animation. Clear now so a later upload cannot be cancelled.
    clearCompleted(state.files.map((file) => file.id));
  }, [clearCompleted, state.files]);

  // Show toast when files are added
  useEffect(() => {
    if (hasFiles) {
      setIsVisible(true);
    }
  }, [hasFiles]);

  useEffect(() => {
    if (isUploading) {
      setIsVisible(true);
    }
  }, [isUploading]);

  // Auto-dismiss when complete and no failures/duplicates
  useEffect(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }

    if (autoDismiss) {
      autoDismissTimerRef.current = setTimeout(() => {
        handleDismiss();
      }, AUTO_DISMISS_DELAY);
    }

    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
      }
    };
  }, [autoDismiss, handleDismiss]);

  useEffect(() => {
    if (!isVisible || !hasFiles) {
      if (toastId.current !== null) {
        toast.dismiss(toastId.current);
        toastId.current = null;
      }
      return;
    }

    // A new batch gets a new identity even while the previous toast is exiting.
    toastId.current ??= `${toastPrefix}-${toastGeneration.current++}`;
    toast.custom(
      () => (
        <UploadQueueToast
          files={state.files}
          counts={counts}
          progress={progress}
          isPaused={state.isPaused}
          isStopped={state.isStopped}
          pausedUntil={state.pausedUntil}
          isExpanded={isExpanded}
          onExpandedChange={setIsExpanded}
          onStopQueue={stopQueue}
          onResumeQueue={resumeQueue}
          onRetryFailed={retryFailed}
          onClearCompleted={handleDismiss}
          onNavigateToUpload={() => router.navigate({ to: '/upload' })}
        />
      ),
      {
        id: toastId.current,
        duration: Infinity,
        dismissible: false,
        className: 'w-full',
      }
    );
  }, [
    isVisible,
    isExpanded,
    hasFiles,
    toastPrefix,
    state.files,
    state.isPaused,
    state.isStopped,
    state.pausedUntil,
    counts,
    progress,
    stopQueue,
    resumeQueue,
    retryFailed,
    handleDismiss,
    router,
  ]);

  useEffect(
    () => () => {
      if (toastId.current !== null) {
        toast.dismiss(toastId.current);
        toastId.current = null;
      }
    },
    []
  );

  return null;
}
