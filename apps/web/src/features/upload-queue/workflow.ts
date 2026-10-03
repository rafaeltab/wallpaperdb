import {
  MAX_FILES_PER_BATCH,
  type QueuedFile,
  type UploadQueueDependencies,
  type UploadQueueSnapshot,
  type UploadQueueState,
  type UploadResult,
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

function retryDelay(retryAfter: number | undefined) {
  const seconds =
    retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
  return Math.min(seconds * 1000, 2_147_483_647);
}

export function createUploadQueue<TFile>(dependencies: UploadQueueDependencies<TFile>) {
  let state = initialState<TFile>();
  let current = snapshot(state);
  let nextId = 0;
  let enabled = false;
  let active: { id: string; cancel: () => void } | undefined;
  let cancelTimer: (() => void) | undefined;
  let rateLimitedId: string | undefined;
  const listeners = new Set<() => void>();

  function publish() {
    current = snapshot(state);
    for (const listener of listeners) listener();
  }

  function updateFile(id: string, change: Partial<QueuedFile<TFile>>) {
    state = {
      ...state,
      files: state.files.map((file) => (file.id === id ? { ...file, ...change } : file)),
    };
  }

  function clearTimer() {
    cancelTimer?.();
    cancelTimer = undefined;
  }

  function retryRateLimitedFile() {
    if (rateLimitedId) updateFile(rateLimitedId, { status: 'pending', error: undefined });
    rateLimitedId = undefined;
  }

  function resumeQueue() {
    clearTimer();
    const remaining = (state.pausedUntil ?? 0) - dependencies.clock.now();
    state = { ...state, isStopped: false, isPaused: remaining > 0 };
    if (remaining > 0) {
      if (enabled) cancelTimer = dependencies.clock.schedule(remaining, resumeQueue);
    } else {
      state = { ...state, pausedUntil: null };
      retryRateLimitedFile();
    }
    publish();
    processNext();
  }

  function settle(id: string, result: UploadResult) {
    if (result.success && result.response) {
      updateFile(id, {
        status: result.isDuplicate ? 'duplicate' : 'success',
        response: result.response,
        error: undefined,
      });
    } else {
      const error = result.error ?? { type: 'server', message: 'Upload returned no result' };
      updateFile(id, { status: 'failed', error });
      if (error.type === 'rate_limit') {
        rateLimitedId = id;
        const delay = retryDelay(error.retryAfter);
        state = {
          ...state,
          isPaused: !state.isStopped,
          pausedUntil: dependencies.clock.now() + delay,
        };
        clearTimer();
        if (enabled && !state.isStopped)
          cancelTimer = dependencies.clock.schedule(delay, resumeQueue);
      }
    }
    state = { ...state, isProcessing: false };
    if (
      state.isStopped &&
      !state.files.some((file) => file.status === 'pending' || file.status === 'uploading')
    ) {
      state = initialState<TFile>();
      rateLimitedId = undefined;
    }
    publish();
    processNext();
  }

  async function upload(file: TFile, attempt: NonNullable<typeof active>) {
    let result: UploadResult;
    try {
      const task = dependencies.upload(file);
      attempt.cancel = task.cancel;
      result = await task.result;
    } catch (error) {
      result = {
        success: false,
        isDuplicate: false,
        error: {
          type: 'network',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
    // Cancelled requests may settle even when their transport ignores cancellation.
    if (active !== attempt) return;
    active = undefined;
    settle(attempt.id, result);
  }

  function processNext() {
    if (!enabled || active || state.isPaused || state.isStopped) return;
    const next = state.files.find((file) => file.status === 'pending');
    if (!next) return;
    const attempt = { id: next.id, cancel: () => {} };
    active = attempt;
    updateFile(next.id, { status: 'uploading' });
    state = { ...state, isProcessing: true };
    publish();
    if (active === attempt) void upload(next.file, attempt);
  }

  function cancelActive() {
    const request = active;
    active = undefined;
    request?.cancel();
    return request;
  }

  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // Activation owns uploads and timers. Its cleanup is reversible for React StrictMode.
    activate() {
      enabled = true;
      if (state.isPaused && !state.isStopped) resumeQueue();
      else processNext();
      return () => {
        enabled = false;
        clearTimer();
        const request = cancelActive();
        if (request) {
          updateFile(request.id, { status: 'pending' });
          state = { ...state, isProcessing: false };
          publish();
        }
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
      processNext();
    },
    clearCompleted(ids?: readonly string[]) {
      state = {
        ...state,
        files: state.files.filter(
          (file) =>
            (ids && !ids.includes(file.id)) ||
            (file.status !== 'success' && file.status !== 'duplicate')
        ),
      };
      if (!state.files.length) {
        clearTimer();
        rateLimitedId = undefined;
        state = initialState<TFile>();
      }
      publish();
    },
    retryFailed() {
      state = {
        ...state,
        files: state.files.map((file) =>
          file.status === 'failed' ? { ...file, status: 'pending', error: undefined } : file
        ),
      };
      publish();
      processNext();
    },
    cancelAll() {
      clearTimer();
      cancelActive();
      rateLimitedId = undefined;
      state = initialState<TFile>();
      publish();
    },
    stopQueue() {
      clearTimer();
      state = { ...state, isStopped: true, isPaused: false };
      publish();
    },
    resumeQueue,
  };
}
