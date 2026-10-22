import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  QueuedFile as QueueFile,
  UploadQueueState as QueueState,
} from '@/features/upload-queue';
import { createBrowserUploadQueue } from '@/features/upload-queue/adapters/browser';

export type {
  FileStatus,
  UploadError,
  UploadErrorType,
  UploadResponse,
} from '@/features/upload-queue';
export { MAX_FILES_PER_BATCH } from '@/features/upload-queue';
export type QueuedFile = QueueFile<File>;
export type UploadQueueState = QueueState<File>;

type BrowserUploadQueue = ReturnType<typeof createBrowserUploadQueue>;
type UploadQueueContextValue = ReturnType<BrowserUploadQueue['getSnapshot']> &
  Pick<
    BrowserUploadQueue,
    'addFiles' | 'clearCompleted' | 'retryFailed' | 'cancelAll' | 'stopQueue' | 'resumeQueue'
  >;

const UploadQueueContext = createContext<UploadQueueContextValue | undefined>(undefined);

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(createBrowserUploadQueue);
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => queue.activate(), [queue]);

  const value: UploadQueueContextValue = {
    ...snapshot,
    addFiles: queue.addFiles,
    clearCompleted: queue.clearCompleted,
    retryFailed: queue.retryFailed,
    cancelAll: queue.cancelAll,
    stopQueue: queue.stopQueue,
    resumeQueue: queue.resumeQueue,
  };

  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>;
}

export function useUploadQueue() {
  const context = useContext(UploadQueueContext);
  if (!context) throw new Error('useUploadQueue must be used within an UploadQueueProvider');
  return context;
}
