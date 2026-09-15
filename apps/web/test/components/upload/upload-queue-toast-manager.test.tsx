import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { UploadQueueToastManager } from '@/components/upload/upload-queue-toast-manager';
import { UploadQueueProvider, useUploadQueue } from '@/contexts/upload-queue-context';
import { uploadWallpaperWithDetails } from '@/lib/api/ingestor';

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

function renderQueue() {
  return render(
    <UploadQueueProvider>
      <QueueControls />
      <UploadQueueToastManager />
      <Toaster />
    </UploadQueueProvider>
  );
}

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
  });
});
