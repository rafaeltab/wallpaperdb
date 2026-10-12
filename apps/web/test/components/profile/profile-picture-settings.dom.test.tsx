import { useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileSettingsPage } from '@/components/profile/profile-settings-page';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';
import { openPictureSource } from '@/features/picture-editor/adapters/browser';

vi.mock('@/features/picture-editor/adapters/browser', () => ({ openPictureSource: vi.fn() }));

vi.mock('@clerk/react', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return {
    ...original,
    userApi: {
      ...original.userApi,
      picturePolicy: vi.fn(),
      ensureProfile: vi.fn(),
      uploadPicture: vi.fn(),
      removePicture: vi.fn(),
    },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/profiles/@ada">{children}</a>,
}));

const picturePolicy = { output: { width: 512, height: 512, mimeType: 'image/webp' as const, colorSpace: 'srgb' as const }, maxOutputBytes: 5242880, acceptedSourceFormats: ['image/jpeg', 'image/png', 'image/webp'], animation: { available: false }, encoding: { staticQuality: 85 } };
const canonical = new Blob(['canonical-webp'], { type: 'image/webp' });
const processPicture = vi.fn();
const disposePicture = vi.fn();

const profile: Profile = {
  id: 'user_123',
  handle: 'ada',
  displayName: 'Ada Lovelace',
  biographyMarkdown: '',
  pictureAssetId: null,
  pictureImportStatus: 'complete',
  version: 1,
  pictureUploadLimits: { maxBytes: 5242880, maxPixels: 20000000, maxDecodedBytes: 80000000 },
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:00:00.000Z',
};
async function renderPage(initial = profile, openPicture = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(profileQueryKey(profile.id), initial);
  const view = {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProfileSettingsPage />
      </QueryClientProvider>
    ),
  };
  if (openPicture)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit profile picture' }));
  return view;
}

describe('Profile picture settings', () => {
  it('fetches and presents effective policy when the dialog opens', async () => {
    vi.mocked(userApi.picturePolicy).mockResolvedValue({ ...picturePolicy, maxOutputBytes: 123456 });
    await renderPage();
    expect(await screen.findByText(/512 × 512 WebP/)).toHaveTextContent('120.56 KB');
    expect(userApi.picturePolicy).toHaveBeenCalledWith(expect.objectContaining({ tokenProvider: expect.any(Function) }));
  });
  it('blocks upload and offers retry when effective policy cannot be loaded', async () => {
    vi.mocked(userApi.picturePolicy).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(picturePolicy);
    await renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load picture rules');
    expect(screen.getByLabelText('Choose picture')).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry picture rules' }));
    await waitFor(() => expect(screen.getByLabelText('Choose picture')).toBeEnabled());
  });
  it('allows picture removal while the independent upload-policy request is pending', async () => {
    let resolvePolicy = (_policy: typeof picturePolicy) => {};
    vi.mocked(userApi.picturePolicy).mockReturnValue(new Promise((resolve) => {
      resolvePolicy = resolve;
    }));
    const initial = { ...profile, pictureAssetId: 'existing-picture' };
    const updated = { ...profile, version: 2 };
    vi.mocked(userApi.removePicture).mockResolvedValue(updated);
    const { client } = await renderPage(initial);
    try {
      expect(screen.getByText('Loading picture rules…')).toBeInTheDocument();
      expect(screen.getByLabelText('Choose picture')).toBeDisabled();
      const remove = screen.getByRole('button', { name: 'Remove picture' });
      expect(remove).toBeEnabled();
      const user = userEvent.setup();
      await user.click(remove);
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Use generated avatar',
      }));
      await waitFor(() => expect(userApi.removePicture).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 1, expectedProfileId: profile.id })
      ));
      await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
      expect(screen.queryByRole('dialog', { name: 'Profile picture' })).not.toBeInTheDocument();
    } finally {
      await act(async () => resolvePolicy(picturePolicy));
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userApi.picturePolicy).mockReset().mockResolvedValue(picturePolicy);
    vi.mocked(useAuth, { partial: true }).mockReturnValue({
      getToken: vi.fn().mockResolvedValue('token'),
      isLoaded: true,
      isSignedIn: true,
      userId: profile.id,
    });
    vi.mocked(userApi.ensureProfile).mockReset();
    vi.mocked(userApi.uploadPicture).mockReset();
    vi.mocked(userApi.removePicture).mockReset();
    processPicture.mockReset().mockResolvedValue(canonical);
    disposePicture.mockReset();
    vi.mocked(openPictureSource).mockReset().mockResolvedValue({ width: 800, height: 400, preview: new Blob(['preview']), process: processPicture, dispose: disposePicture });
  });

  it('edits a large local source and uploads only canonical bytes with its captured Profile version', async () => {
    const updated = { ...profile, pictureAssetId: 'saved-picture', version: 3 };
    vi.mocked(userApi.uploadPicture).mockResolvedValue(updated);
    const { client } = await renderPage();
    const user = userEvent.setup();
    const original = new File([new Uint8Array(6000000)], 'large.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Choose picture'), original);
    const zoom = await screen.findByRole('slider', { name: 'Zoom' });
    zoom.focus();
    await user.keyboard('{ArrowRight}');
    act(() => client.setQueryData(profileQueryKey(profile.id), { ...profile, version: 2 }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    const command = vi.mocked(userApi.uploadPicture).mock.calls[0][0];
    expect(command).toMatchObject({ expectedVersion: 1, expectedProfileId: profile.id });
    expect(command.picture).not.toBe(original);
    expect(command.picture.size).toBe(canonical.size);
    expect(command.picture.type).toBe('image/webp');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('drops a local picture into the editor and submits the processed replacement', async () => {
    vi.mocked(userApi.uploadPicture).mockResolvedValue({ ...profile, version: 2, pictureAssetId: 'dropped' });
    await renderPage();
    const picture = new File(['png'], 'dropped.png', { type: 'image/png' });
    fireEvent.drop(screen.getByRole('dialog', { name: 'Profile picture' }), { dataTransfer: { files: [picture] } });
    expect(await screen.findByRole('slider', { name: 'Zoom' })).toHaveValue('1');
    expect(screen.getByText('dropped.png')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(userApi.uploadPicture).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1, picture: expect.objectContaining({ type: 'image/webp', size: canonical.size }) })));
  });

  it('pastes actual image data into the open editor and resets an unsaved crop', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['old'], 'old.png', { type: 'image/png' }));
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    const picture = new File(['new'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(document, { clipboardData: { items: [{ kind: 'file', type: picture.type, getAsFile: () => picture }] } });
    expect(await screen.findByText('pasted.png')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('1');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(disposePicture).toHaveBeenCalled();
  });

  it.each(['picker', 'drop', 'paste'])('fences processing when %s replaces the source and resets the crop', async (route) => {
    let finish: ((value: Blob) => void) | undefined;
    let signal: AbortSignal | undefined;
    processPicture.mockImplementationOnce((_crop, _policy, capturedSignal) => { signal = capturedSignal; return new Promise((resolve) => { finish = resolve; }); });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['old'], 'old.png', { type: 'image/png' }));
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const replacement = new File(['new'], 'new.png', { type: 'image/png' });
    if (route === 'picker') await user.upload(screen.getByLabelText('Choose picture'), replacement);
    else if (route === 'drop') fireEvent.drop(screen.getByRole('dialog', { name: 'Profile picture' }), { dataTransfer: { files: [replacement] } });
    else fireEvent.paste(document, { clipboardData: { items: [{ kind: 'file', type: replacement.type, getAsFile: () => replacement }] } });
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole('slider', { name: 'Zoom' })).toHaveValue('1');
    await act(async () => finish?.(canonical));
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(screen.getByText('new.png')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it.each(['picker', 'drop', 'paste'])('explains unsupported %s sources using the effective policy', async (route) => {
    vi.mocked(userApi.picturePolicy).mockResolvedValue({ ...picturePolicy, acceptedSourceFormats: ['image/jpeg'] });
    await renderPage();
    await waitFor(() => expect(screen.getByLabelText('Choose picture')).toBeEnabled());
    const unsupported = new File(['png'], 'unsupported.png', { type: 'image/png' });
    if (route === 'picker') await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Choose picture'), unsupported);
    else if (route === 'drop') fireEvent.drop(screen.getByRole('dialog', { name: 'Profile picture' }), { dataTransfer: { files: [unsupported] } });
    else fireEvent.paste(document, { clipboardData: { items: [{ kind: 'file', type: unsupported.type, getAsFile: () => unsupported }] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a JPEG picture.');
    expect(openPictureSource).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('ignores clipboard markup, text and URLs, and releases image handling on close and unmount', async () => {
    const { unmount } = await renderPage(profile, false);
    const picture = new File(['png'], 'clipboard.png', { type: 'image/png' });
    const imageData = { items: [{ kind: 'file', type: picture.type, getAsFile: () => picture }] };
    expect(fireEvent.paste(document, { clipboardData: imageData })).toBe(true);
    expect(openPictureSource).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit profile picture' }));
    for (const type of ['text/html', 'text/plain', 'text/uri-list']) {
      expect(fireEvent.paste(document, { clipboardData: { items: [{ kind: 'string', type, getAsFile: () => null }], getData: () => '<img src="https://elsewhere.test/image.png">' } })).toBe(true);
    }
    fireEvent.drop(screen.getByRole('dialog', { name: 'Profile picture' }), { dataTransfer: { files: [], getData: () => 'https://elsewhere.test/image.png' } });
    expect(openPictureSource).not.toHaveBeenCalled();
    expect(screen.getByText('No picture selected')).toBeInTheDocument();
    fireEvent.paste(document, { clipboardData: imageData });
    expect(await screen.findByText('clipboard.png')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose picture')).not.toHaveAttribute('capture');
    await user.keyboard('{Escape}');
    vi.mocked(openPictureSource).mockClear();
    expect(fireEvent.paste(document, { clipboardData: imageData })).toBe(true);
    expect(openPictureSource).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Edit profile picture' }));
    unmount();
    expect(fireEvent.paste(document, { clipboardData: imageData })).toBe(true);
    expect(openPictureSource).not.toHaveBeenCalled();
  });

  it.each([{ deltaMode: 0, unit: 1 }, { deltaMode: 1, unit: 16 }])('uses $deltaMode wheel units with the accessible slider, Reset, and the minimum source crop', async ({ deltaMode, unit }) => {
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'wheel.png', { type: 'image/png' }));
    const zoom = await screen.findByRole('slider', { name: 'Zoom' });
    const crop = screen.getByRole('group', { name: 'Picture crop' });
    const event = new WheelEvent('wheel', { deltaY: -10000 / unit, deltaMode, cancelable: true });
    fireEvent(crop, event);
    expect(event.defaultPrevented).toBe(true);
    expect(zoom).toHaveValue('6.25');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(zoom).toHaveValue('1');
    fireEvent.wheel(crop, { deltaY: -346.57359028 / unit, deltaMode });
    expect(Number(zoom.getAttribute('value'))).toBeCloseTo(2);
    fireEvent.wheel(crop, { deltaY: 10000 / unit, deltaMode });
    expect(zoom).toHaveValue('1');
  });

  it('opens picture controls from the avatar and returns focus when closed', async () => {
    await renderPage(profile, false);
    const user = userEvent.setup();
    expect(screen.queryByLabelText('Choose picture')).not.toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit profile picture' });
    await user.click(edit);
    const dialog = screen.getByRole('dialog', { name: 'Profile picture' });
    expect(within(dialog).getByLabelText('Choose picture')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(edit).toHaveFocus();
  });

  it('applies keyboard repositioning through the picture command', async () => {
    vi.mocked(userApi.uploadPicture).mockResolvedValue({ ...profile, version: 2 });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['source'], 'picture.png', { type: 'image/png' }));
    await user.click(await screen.findByRole('button', { name: 'Move picture left' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(userApi.uploadPicture).toHaveBeenCalled());
    expect(processPicture).toHaveBeenCalledWith(
      expect.objectContaining({ x: 240, y: 0, size: 400 }),
      picturePolicy,
      expect.any(AbortSignal)
    );
  });

  it.each(['minimum', 'maximum', 'low resolution'])('leaves clamped wheel input available for scrolling at %s zoom', async (boundary) => {
    if (boundary === 'low resolution')
      vi.mocked(openPictureSource).mockResolvedValue({ width: 32, height: 48, preview: new Blob(), process: processPicture, dispose: disposePicture });
    await renderPage();
    await userEvent.setup().upload(screen.getByLabelText('Choose picture'), new File(['source'], 'picture.png', { type: 'image/png' }));
    const crop = await screen.findByRole('group', { name: 'Picture crop' });
    if (boundary === 'maximum') fireEvent.wheel(crop, { deltaY: -10000 });
    const event = new WheelEvent('wheel', { deltaY: boundary === 'minimum' ? 10000 : -10000, cancelable: true });
    fireEvent(crop, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('retains its edit and reports that a competing Profile command blocked submission after processing', async () => {
    let finishProcessing: ((value: Blob) => void) | undefined;
    processPicture.mockImplementation(() => new Promise((resolve) => { finishProcessing = resolve; }));
    const { client } = await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    let finishOtherCommand: (() => void) | undefined;
    const otherCommand = client.getMutationCache().build(client, { mutationKey: profileQueryKey(profile.id), mutationFn: () => new Promise<void>((resolve) => { finishOtherCommand = resolve; }) });
    let pending: Promise<void>;
    act(() => { pending = otherCommand.execute(undefined); });
    await act(async () => finishProcessing?.(canonical));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your Profile is busy');
    expect(screen.getByText('portrait.png')).toBeInTheDocument();
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    await act(async () => { finishOtherCommand?.(); await pending; });
  });

  it('cancels processing in the same dialog, ignores a late result, and permits the retained crop to be applied again', async () => {
    let finish: ((value: Blob) => void) | undefined;
    let signal: AbortSignal | undefined;
    processPicture.mockImplementationOnce((_crop, _policy, capturedSignal) => { signal = capturedSignal; return new Promise((resolve) => { finish = resolve; }); });
    vi.mocked(userApi.uploadPicture).mockResolvedValue({ ...profile, version: 2, pictureAssetId: 'saved' });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Cancel picture processing' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => finish?.(canonical));
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(userApi.uploadPicture).toHaveBeenCalled());
    expect(processPicture.mock.calls[1][0]).toMatchObject({ x: 300, y: 100, size: 200 });
  });

  it('immediately replaces a source and ignores its late decode without opening a confirmation', async () => {
    let finish: ((value: Awaited<ReturnType<typeof openPictureSource>>) => void) | undefined;
    let signal: AbortSignal | undefined;
    vi.mocked(openPictureSource).mockImplementationOnce((_file, capturedSignal) => { signal = capturedSignal; return new Promise((resolve) => { finish = resolve; }); });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'old.png', { type: 'image/png' }));
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'new.png', { type: 'image/png' }));
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole('slider', { name: 'Zoom' })).toHaveValue('1');
    const abandonedDispose = vi.fn();
    await act(async () => finish?.({ width: 10, height: 10, preview: new Blob(), process: processPicture, dispose: abandonedDispose }));
    expect(abandonedDispose).toHaveBeenCalled();
    expect(screen.getByText('new.png')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/smaller than 64/)).not.toBeInTheDocument();
  });

  it('retains the file after a decode failure and retries its decode when Apply is chosen', async () => {
    vi.mocked(openPictureSource).mockRejectedValueOnce(new Error('Unable to decode this picture.'));
    vi.mocked(userApi.uploadPicture).mockResolvedValue({ ...profile, version: 2, pictureAssetId: 'saved' });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to decode');
    expect(screen.getByText('portrait.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(userApi.uploadPicture).toHaveBeenCalled());
  });

  it('retains the crop after a processing failure and releases its preview when the edit is abandoned', async () => {
    processPicture.mockRejectedValueOnce(new Error('Encoder unavailable'));
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Encoder unavailable');
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('2');
    await user.keyboard('{Escape}');
    expect(disposePicture).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
  });

  it('fences late processing after closing and reopening the dialog', async () => {
    let finish: ((value: Blob) => void) | undefined;
    processPicture.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'old.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Edit profile picture' }));
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'new.png', { type: 'image/png' }));
    await act(async () => finish?.(canonical));
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(screen.getByText('new.png')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Profile picture' })).toBeVisible();
  });

  it('warns about a small source, disables zoom, and still permits Apply', async () => {
    vi.mocked(openPictureSource).mockResolvedValue({ width: 32, height: 48, preview: new Blob(), process: processPicture, dispose: disposePicture });
    await renderPage();
    await userEvent.setup().upload(screen.getByLabelText('Choose picture'), new File(['png'], 'small.png', { type: 'image/png' }));
    expect(await screen.findByRole('slider', { name: 'Zoom' })).toBeDisabled();
    expect(screen.getByText(/smaller than 64/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('aborts UI-owned processing on unmount and prevents its late result from starting an upload', async () => {
    let finish: ((value: Blob) => void) | undefined;
    let signal: AbortSignal | undefined;
    processPicture.mockImplementationOnce((_crop, _policy, capturedSignal) => { signal = capturedSignal; return new Promise((resolve) => { finish = resolve; }); });
    const { unmount } = await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(disposePicture).toHaveBeenCalled();
    await act(async () => finish?.(canonical));
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'escape'])('returns focus to Remove picture after dismissing its confirmation with %s', async (dismissal) => {
    await renderPage({ ...profile, pictureAssetId: 'original-picture' });
    const user = userEvent.setup();
    const remove = screen.getByRole('button', { name: 'Remove picture' });
    await user.click(remove);
    const confirmation = screen.getByRole('alertdialog');
    if (dismissal === 'cancel') await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    else await user.keyboard('{Escape}');
    await waitFor(() => expect(remove).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Profile picture' })).toBeInTheDocument();
    expect(userApi.removePicture).not.toHaveBeenCalled();
  });

  it('keeps the selected picture after failure and closes the dialog after a successful retry', async () => {
    const updated = { ...profile, pictureAssetId: 'saved-picture', version: 2 };
    vi.mocked(userApi.uploadPicture)
      .mockRejectedValueOnce(new Error('Upload unavailable'))
      .mockResolvedValueOnce(updated);
    await renderPage();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['png'], 'portrait.png', { type: 'image/png' })
    );
    expect(screen.getByText('portrait.png')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Selected avatar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload unavailable');
    expect(screen.getByText('portrait.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute(
      'src',
      '/media/profile-pictures/saved-picture'
    );
    expect(toast.success).toHaveBeenLastCalledWith('Profile picture saved');
  });

  it('does not overwrite a recreated owner cache with a picture response from an earlier session', async () => {
    let finish: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.uploadPicture).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { client, unmount } = await renderPage();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['png'], 'portrait.png', { type: 'image/png' })
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    unmount();
    client.removeQueries({ queryKey: profileQueryKey(profile.id) });
    const newSession = { ...profile, version: 5 };
    client.setQueryData(profileQueryKey(profile.id), newSession);
    await act(async () => finish?.({ ...profile, version: 2, pictureAssetId: 'late-picture' }));
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(newSession);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps owner refreshes from racing a picture write and reports a failed refresh', async () => {
    let finishUpload: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.uploadPicture).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        })
    );
    vi.mocked(userApi.ensureProfile).mockRejectedValue(new Error('Offline'));
    const { client } = await renderPage();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['png'], 'portrait.png', { type: 'image/png' })
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Refresh Profile' })).toBeDisabled();
    expect(screen.getByLabelText('Choose picture')).toBeDisabled();
    expect(userApi.ensureProfile).not.toHaveBeenCalled();
    const updated = { ...profile, pictureAssetId: 'picture_new', version: 2 };
    await act(async () => finishUpload?.(updated));
    await user.click(screen.getByRole('button', { name: 'Edit profile picture' }));
    await user.click(screen.getByRole('button', { name: 'Refresh Profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to refresh your Profile. Try again.'
    );
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
  });

  it('explains stale picture commands and refreshes the owner before selecting another upload', async () => {
    vi.mocked(userApi.uploadPicture).mockRejectedValue(
      new UserApiError('Conflict', 409, {
        type: 'https://wallpaperdb.test/problems/profile-version-conflict',
      })
    );
    const updated = { ...profile, version: 2, pictureAssetId: 'remote_picture' };
    vi.mocked(userApi.ensureProfile).mockResolvedValue(updated);
    const { client } = await renderPage();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['png'], 'portrait.png', { type: 'image/png' })
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your Profile changed elsewhere. Refresh Profile before trying again.'
    );
    await user.click(screen.getByRole('button', { name: 'Refresh Profile' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('shows effective output constraints and retains a source when processed bytes exceed the limit', async () => {
    vi.mocked(userApi.picturePolicy).mockResolvedValue({ ...picturePolicy, maxOutputBytes: 4 });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['12345'], 'large.png', { type: 'image/png' })
    );
    processPicture.mockRejectedValue(new Error('Processed picture exceeds the 4 byte limit. Choose another picture.'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Processed picture exceeds the 4 byte limit.');
    expect(screen.getByText('large.png')).toBeInTheDocument();
    expect(screen.getByText(/Up to 4 B/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
  });

  it('rejects unsupported picture files before sending an upload', async () => {
    await renderPage();
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['<svg/>'], 'picture.svg', { type: 'image/svg+xml' })
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPEG, PNG, or WebP picture.');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
  });

  it('lets a generated-avatar choice cancel a pending import before any picture is available', async () => {
    const updated = { ...profile, version: 2 };
    vi.mocked(userApi.removePicture).mockResolvedValue(updated);
    const { client } = await renderPage({ ...profile, pictureImportStatus: 'pending' });
    const user = userEvent.setup();
    expect(screen.getByText(/importing your account picture/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel picture import' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Use generated avatar' })
    );
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.removePicture).toHaveBeenCalledWith({
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.queryByRole('button', { name: 'Cancel picture import' })).not.toBeInTheDocument();
  });

  it('confirms picture removal with the version seen when the dialog opened and keeps cancellation local', async () => {
    const initial = { ...profile, pictureAssetId: 'picture_old' };
    const updated = { ...profile, version: 3 };
    vi.mocked(userApi.removePicture).mockResolvedValue(updated);
    const { client } = await renderPage(initial);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove picture' }));
    let dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/generated avatar/i);
    expect(dialog).toHaveTextContent(/pending picture import/i);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(userApi.removePicture).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove picture' }));
    dialog = screen.getByRole('alertdialog');
    act(() =>
      client.setQueryData(profileQueryKey(profile.id), {
        ...initial,
        version: 2,
        pictureAssetId: 'newer_unseen',
      })
    );
    await user.click(within(dialog).getByRole('button', { name: 'Use generated avatar' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.removePicture).toHaveBeenCalledWith({
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveTextContent(
      'AL'
    );
  });

  it('uploads the selected file with its captured version and immediately adopts the authoritative picture', async () => {
    const updated = { ...profile, pictureAssetId: 'picture_new', version: 3 };
    vi.mocked(userApi.uploadPicture).mockResolvedValue(updated);
    const { client } = await renderPage();
    const user = userEvent.setup();
    const picture = new File(['png'], 'portrait.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Choose picture'), picture);
    act(() => client.setQueryData(profileQueryKey(profile.id), { ...profile, version: 2 }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.uploadPicture).toHaveBeenCalledWith({
      picture: expect.objectContaining({ type: 'image/webp', size: canonical.size }),
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute(
      'src',
      '/media/profile-pictures/picture_new'
    );
    expect(toast.success).toHaveBeenLastCalledWith('Profile picture saved');
  });
});
