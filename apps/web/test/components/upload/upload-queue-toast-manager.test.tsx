import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { UploadQueueToastManager } from '@/components/upload/upload-queue-toast-manager';
import { UploadQueueProvider, useUploadQueue } from '@/contexts/upload-queue-context';
import { type UploadResult, uploadWallpaperWithDetails } from '@/lib/api/ingestor';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate }) }));
vi.mock('@/lib/api/ingestor', () => ({ uploadWallpaperWithDetails: vi.fn() }));

function QueueControls() {
  const { addFiles, state } = useUploadQueue();
  return (
    <>
      <button type="button" onClick={() => addFiles([new File(['picture'], 'wallpaper.jpg')])}>
        Add upload
      </button>
      <button type="button" onClick={() => toast.success('Profile updated')}>
        Save profile
      </button>
      <output aria-label="Queue size">{state.files.length}</output>
    </>
  );
}

function QueueApp({ showManager = true }: { showManager?: boolean }) {
  return (
    <UploadQueueProvider>
      <QueueControls />
      {showManager && <UploadQueueToastManager />}
      <Toaster />
    </UploadQueueProvider>
  );
}

function renderQueue() {
  return render(<QueueApp />);
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

  afterEach(() => {
    act(() => toast.dismiss());
    cleanup();
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
    const user = userEvent.setup();
    vi.mocked(uploadWallpaperWithDetails).mockResolvedValueOnce(uploaded);
    renderQueue();

    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await user.click(screen.getByRole('button', { name: 'Add upload' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));

    expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
    expect(screen.getByText('Uploading 0/1 files')).toBeInTheDocument();
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
    await waitFor(() =>
      expect(screen.queryByText('Uploading 1/2 files')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Profile updated')).toBeInTheDocument();
  });

  it('automatically clears successful uploads after five seconds', async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('1');
    await waitFor(
      () => expect(screen.getByRole('status', { name: 'Queue size' })).toHaveTextContent('0'),
      { timeout: 6000 }
    );
    await waitFor(() =>
      expect(screen.queryByText('Upload complete')).not.toBeInTheDocument()
    );
  });
});
