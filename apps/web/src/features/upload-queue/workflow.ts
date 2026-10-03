import {
  MAX_FILES_PER_BATCH,
  type UploadQueueDependencies,
  type UploadQueueSnapshot,
  type UploadQueueState,
} from './contract';

function initialState<TFile>(): UploadQueueState<TFile> {
  return { files: [], isProcessing: false, isPaused: false, isStopped: false, pausedUntil: null };
}

function snapshot<TFile>(state: UploadQueueState<TFile>): UploadQueueSnapshot<TFile> {
  const counts = {
    total: state.files.length,
    pending: 0,
    uploading: 0,
    success: 0,
    failed: 0,
    duplicate: 0,
  };
  for (const file of state.files) counts[file.status]++;
  const completed = counts.success + counts.failed + counts.duplicate;
  return {
    state,
    counts,
    progress: counts.total === 0 ? 0 : Math.round((completed / counts.total) * 100),
  };
}

export function createUploadQueue<TFile>(dependencies: UploadQueueDependencies<TFile>) {
  let state = initialState<TFile>();
  let current = snapshot(state);
  let nextId = 0;
  let enabled = false;
  const listeners = new Set<() => void>();

  function publish() {
    current = snapshot(state);
    for (const listener of listeners) listener();
  }

  async function processNext() {
    if (!enabled || state.isProcessing) return;
    const next = state.files.find((file) => file.status === 'pending');
    if (!next) return;
    state = {
      ...state,
      isProcessing: true,
      files: state.files.map((file) =>
        file.id === next.id ? { ...file, status: 'uploading' } : file
      ),
    };
    publish();
    const result = await dependencies.upload(next.file).result;
    state = {
      ...state,
      isProcessing: false,
      files: state.files.map((file) =>
        file.id === next.id ? { ...file, status: 'success', response: result.response } : file
      ),
    };
    publish();
    void processNext();
  }

  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      enabled = true;
      void processNext();
      return () => {
        enabled = false;
      };
    },
    addFiles(files: TFile[]) {
      state = {
        ...state,
        files: [
          ...state.files,
          ...files
            .slice(0, MAX_FILES_PER_BATCH - state.files.length)
            .map((file) => ({ id: `file_${++nextId}`, file, status: 'pending' as const })),
        ],
      };
      publish();
      void processNext();
    },
  };
}
