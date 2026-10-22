import {
  act,
  cleanup,
  configure,
  getConfig,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { UploadQueueToastManager } from '@/components/upload/upload-queue-toast-manager';
import { UploadQueueProvider, useUploadQueue } from '@/contexts/upload-queue-context';
import { type UploadResult, uploadWallpaperWithDetails } from '@/lib/api/ingestor';

const navigate = vi.fn();
const originalAsyncWrapper = getConfig().asyncWrapper;
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate }) }));
vi.mock('@/lib/api/ingestor', () => ({ uploadWallpaperWithDetails: vi.fn() }));

function QueueControls() {
  const { addFiles, state, retryFailed } = useUploadQueue();
  return (
    <>
      <button type="button" onClick={() => addFiles([new File(['picture'], 'wallpaper.jpg')])}>
        Add upload
      </button>
      <button type="button" onClick={() => toast.success('Profile updated')}>
        Save profile
      </button>
      <button type="button" onClick={() => retryFailed()}>
        Retry uploads
      </button>
      <output aria-label="Queue size">{state.files.length}</output>
    </>
  );
}

function QueueApp({ showManager = true }: { showManager?: boolean }) {
  return (
    <ThemeProvider>
      <UploadQueueProvider>
        <QueueControls />
        {showManager && <UploadQueueToastManager />}
        <Toaster />
      </UploadQueueProvider>
    </ThemeProvider>
  );
}

function renderQueue() {
  return render(<QueueApp />);
}

function controlToastTimers() {
  vi.useFakeTimers({
    toFake: [
      'Date',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  // RTL's default async wrapper waits on a zero-delay timer and only advances
  // Jest timers. Keep user-event's async work inside act with Vitest timers.
  configure({ asyncWrapper: async (callback) => act(callback) });
}

async function finishToastExit() {
  // Sonner publishes dismissals over two animation frames, then starts its exit timer.
  await act(async () => {
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  });
  await act(async () => vi.advanceTimersByTimeAsync(200));
}

const uploaded: UploadResult = {
  success: true,
  isDuplicate: false,
  response: {
    wallpaperId: 'wallpaper-1',
    userId: 'user-1',
    uploadState: 'uploaded',
    fileType: 'image',
    mimeType: 'image/jpeg',
    fileSizeBytes: 7,
    width: 100,
    height: 100,
    aspectRatio: 1,
    uploadedAt: '2026-09-15T00:00:00Z',
  },
};

describe('UploadQueueToastManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(uploadWallpaperWithDetails).mockImplementation(() => new Promise(() => {}));
  });

  afterEach(async () => {
    try {
      act(() => toast.dismiss());
      cleanup();
      if (vi.isFakeTimers()) {
        // Drain Sonner's deferred publication and exit callbacks after unmounting.
        await act(async () => vi.runOnlyPendingTimersAsync());
        expect(vi.getTimerCount()).toBe(0);
      }
    } finally {
      configure({ asyncWrapper: originalAsyncWrapper });
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('uses the selected application theme for the shared notification stack', async () => {
    render(
      <ThemeProvider defaultTheme="dark" storageKey="toast-theme-test">
        <Toaster />
      </ThemeProvider>
    );
    act(() => {
      toast.success('Themed profile update');
    });
    const message = await screen.findByText('Themed profile update');
    expect(message.closest('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark');
  });

  it('shares the bottom-right notification stack with profile feedback', async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    const notifications = screen.getByRole('region', { name: /Notifications/ });
    expect(within(notifications).getByText('Uploading 0/1 files')).toBeInTheDocument();
    expect(within(notifications).getByText('Profile updated')).toBeInTheDocument();
    const stack = within(notifications).getByRole('list');
    expect(stack).toHaveAttribute('data-y-position', 'bottom');
    expect(stack).toHaveAttribute('data-x-position', 'right');
    for (const notification of within(stack).getAllByRole('listitem')) {
      expect(notification).toHaveAttribute('data-expanded', 'true');
    }
  });

  it('keeps a new upload when the previous completion toast is dismissed', async () => {
    controlToastTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
    let completeUpload: ((result: UploadResult) => void) | undefined;
    vi.mocked(uploadWallpaperWithDetails).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeUpload = resolve;
        })
    );
    renderQueue();

    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Uploading 0/1 files')).toBeInTheDocument();
    await act(async () => completeUpload?.(uploaded));
    // React publishes the completed queue first; Sonner renders it on its next timer.
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Upload complete')).toBeInTheDocument();
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    const previousToast = dismiss.closest('[data-sonner-toast]');
    expect(previousToast).toBeInTheDocument();
    await user.click(dismiss);
    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(previousToast).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
    expect(screen.getByText('Uploading 0/1 files')).toBeInTheDocument();

    await finishToastExit();
    expect(previousToast).not.toBeInTheDocument();

    expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
    expect(screen.getByText('Uploading 0/1 files')).toBeInTheDocument();
  });

  it('keeps the current completion toast visible when an old dismissal runs', async () => {
    const custom = vi.spyOn(toast, 'custom');
    const user = userEvent.setup();
    vi.mocked(uploadWallpaperWithDetails).mockResolvedValue(uploaded);
    renderQueue();
    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await screen.findByText('Upload complete');
    const renderToast = custom.mock.calls.at(-1)?.[0];
    const oldToast = renderToast?.('old');
    if (!isValidElement<{ onClearCompleted: () => void }>(oldToast)) {
      throw new Error('Expected an upload toast');
    }
    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await waitFor(() => expect(screen.getByText(/2 uploaded/)).toBeInTheDocument());
    act(() => oldToast.props.onClearCompleted());
    expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
    await waitFor(() => {
      const current = custom.mock.calls.at(-1)?.[0]('current');
      if (!isValidElement<{ files: unknown[] }>(current)) throw new Error('Expected toast');
      expect(current.props.files).toHaveLength(1);
      expect(screen.getByText('Upload complete')).toBeInTheDocument();
    });
    custom.mockRestore();
  });

  it('retains dismissed failed entries for retry through the page controls', async () => {
    vi.mocked(uploadWallpaperWithDetails).mockResolvedValue({
      success: false,
      isDuplicate: false,
      error: { type: 'network', message: 'Upload failed' },
    });
    const user = userEvent.setup();
    renderQueue();
    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
    vi.mocked(uploadWallpaperWithDetails).mockResolvedValue(uploaded);
    await user.click(screen.getByRole('button', { name: 'Retry uploads' }));
    await screen.findByText('1 uploaded');
    expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
  });

  it('preserves expanded progress and controls while sharing and leaving the stack', async () => {
    const user = userEvent.setup();
    let completeUpload: ((result: UploadResult) => void) | undefined;
    vi.mocked(uploadWallpaperWithDetails).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeUpload = resolve;
        })
    );
    const view = renderQueue();
    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await user.click(screen.getByTestId('expand-button'));
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await act(async () => completeUpload?.(uploaded));
    expect(await screen.findByText('Uploading 1/2 files')).toBeInTheDocument();
    expect(screen.getAllByText('wallpaper.jpg')).toHaveLength(2);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByText('Uploading 1/2 files'));
    expect(navigate).toHaveBeenCalledWith({ to: '/upload' });

    view.rerender(<QueueApp showManager={false} />);
    await waitFor(() => expect(screen.queryByText('Uploading 1/2 files')).not.toBeInTheDocument());
    expect(screen.getByText('Profile updated')).toBeInTheDocument();
  });

  describe('completion expiry', () => {
    beforeEach(controlToastTimers);

    it('automatically clears successful uploads after five seconds', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
      let completeUpload: ((result: UploadResult) => void) | undefined;
      vi.mocked(uploadWallpaperWithDetails).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completeUpload = resolve;
          })
      );
      renderQueue();
      await user.click(screen.getByRole('button', { name: 'Add upload' }));

      await act(async () => completeUpload?.(uploaded));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText('Upload complete')).toBeInTheDocument();
      expect(screen.getByText('1 uploaded')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(4999));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
      expect(screen.getByText('Upload complete')).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('0');
      await finishToastExit();
      expect(screen.queryByText('Upload complete')).not.toBeInTheDocument();
    });

    it('cancels the previous expiry when a new upload arrives and restarts on completion', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
      let completeSecondUpload: ((result: UploadResult) => void) | undefined;
      vi.mocked(uploadWallpaperWithDetails)
        .mockResolvedValueOnce(uploaded)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              completeSecondUpload = resolve;
            })
        );
      renderQueue();
      await user.click(screen.getByRole('button', { name: 'Add upload' }));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText('1 uploaded')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(4999));

      await user.click(screen.getByRole('button', { name: 'Add upload' }));
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('2');
      expect(screen.getByText('Uploading 1/2 files')).toBeInTheDocument();

      await act(async () => completeSecondUpload?.(uploaded));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText('2 uploaded')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(4999));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('2');
      expect(screen.getByText('Upload complete')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('0');
    });

    it.each([
      {
        label: 'failed',
        result: {
          success: false,
          isDuplicate: false,
          error: { type: 'network' as const, message: 'Upload failed' },
        },
      },
      { label: 'duplicate', result: { ...uploaded, isDuplicate: true } },
    ])('retains a $label upload and its successful sibling past the expiry', async ({
      label,
      result,
    }) => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
      vi.mocked(uploadWallpaperWithDetails)
        .mockResolvedValueOnce(result)
        .mockResolvedValueOnce(uploaded);
      renderQueue();
      await user.click(screen.getByRole('button', { name: 'Add upload' }));
      await user.click(screen.getByRole('button', { name: 'Add upload' }));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText('1 uploaded')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('2');
      expect(screen.getByText('Upload complete')).toBeInTheDocument();
      expect(screen.getByText('1 uploaded')).toBeInTheDocument();
      expect(screen.getByText(`1 ${label}`)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent(
        label === 'failed' ? '1' : '0'
      );
    });

    it('cancels completion expiry when the manager unmounts', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync });
      vi.mocked(uploadWallpaperWithDetails).mockResolvedValue(uploaded);
      const view = renderQueue();
      await user.click(screen.getByRole('button', { name: 'Add upload' }));
      await act(async () => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText('Upload complete')).toBeInTheDocument();
      view.rerender(<QueueApp showManager={false} />);
      await finishToastExit();
      expect(screen.queryByText('Upload complete')).not.toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
    });
  });
});
