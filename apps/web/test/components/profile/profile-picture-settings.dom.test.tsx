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

const picturePolicy = { output: { width: 512, height: 512, mimeType: 'image/webp' as const, colorSpace: 'srgb' as const }, maxOutputBytes: 5242880, acceptedSourceFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], animation: { available: true }, encoding: { staticQuality: 85, animationQuality: 85 } };
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
  it('warns below Zoom when a crop needs enlargement, clears on reset, and still permits Apply', async () => {
    vi.mocked(openPictureSource).mockResolvedValue({ width: 1024, height: 1024, preview: new Blob(['preview']), process: processPicture, dispose: disposePicture });
    vi.mocked(userApi.uploadPicture).mockResolvedValue({ ...profile, version: 2, pictureAssetId: 'saved' });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['source'], 'picture.png', { type: 'image/png' }));
    const zoom = await screen.findByRole('slider', { name: 'Zoom' });
    const warning = 'This crop will be enlarged and may look pixelated.';
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    fireEvent.change(zoom, { target: { value: '3' } });
    expect(screen.getByText(warning)).toBeVisible();
    expect(zoom).toHaveAccessibleDescription(warning);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Picture quality warning. This crop may look pixelated.');
    const updates: MutationRecord[] = [];
    const observer = new MutationObserver((records) => updates.push(...records));
    observer.observe(status, { subtree: true, childList: true, characterData: true });
    try {
      fireEvent.change(zoom, { target: { value: '4' } });
      await act(async () => {});
      expect(updates).toHaveLength(0);
    } finally { observer.disconnect(); }
    await user.click(screen.getByRole('button', { name: 'Reset crop' }));
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    expect(zoom).not.toHaveAttribute('aria-describedby');
    expect(status).toBeEmptyDOMElement();
    fireEvent.change(zoom, { target: { value: '3' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(userApi.uploadPicture).toHaveBeenCalled());
  });

  it('uses refreshed output dimensions and replacement source pixels for quality feedback', async () => {
    const { client } = await renderPage();
    const user = userEvent.setup();
    const picker = screen.getByLabelText('Choose picture');
    await user.upload(picker, new File(['source'], 'picture.png', { type: 'image/png' }));
    const warning = 'This crop will be enlarged and may look pixelated.';
    expect(await screen.findByText(warning)).toBeVisible();
    vi.mocked(userApi.picturePolicy).mockResolvedValue({ ...picturePolicy, output: { ...picturePolicy.output, width: 256, height: 256 } });
    await act(async () => client.invalidateQueries({ queryKey: [...profileQueryKey(profile.id), 'picture-policy'] }));
    await waitFor(() => expect(screen.queryByText(warning)).not.toBeInTheDocument());
    vi.mocked(openPictureSource).mockResolvedValue({ width: 128, height: 256, preview: new Blob(['replacement']), process: processPicture, dispose: disposePicture });
    await user.upload(picker, new File(['replacement'], 'replacement.png', { type: 'image/png' }));
    expect(await screen.findByText(warning)).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('returns from filename-free cropping to selection without closing or changing the saved Profile', async () => {
    const saved = { ...profile, pictureAssetId: 'saved-picture' };
    const { client } = await renderPage(saved);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['source'], 'picture.png', { type: 'image/png' }));
    const dialog = screen.getByRole('dialog', { name: 'Profile picture' });
    await within(dialog).findByRole('slider', { name: 'Zoom' });
    expect(within(dialog).queryByRole('button', { name: 'Choose picture' })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Choose picture')).toHaveAttribute('aria-hidden', 'true');
    expect(within(dialog).queryByText(/Choose, drop, or paste/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/512 × 512 WebP/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Your picture appears/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reset' })).toHaveAttribute('data-variant', 'destructive');
    expect(within(dialog).queryByText('picture.png')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('list', { name: 'Picture editing progress' }).querySelector('[aria-current=step]')).toHaveTextContent('2Frame');
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(dialog).toBeInTheDocument();
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(saved);
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(userApi.removePicture).not.toHaveBeenCalled();
    expect(disposePicture).toHaveBeenCalled();
    expect(screen.queryByRole('slider', { name: 'Zoom' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose picture' })).toHaveFocus();
    expect(within(dialog).getByRole('list', { name: 'Picture editing progress' }).querySelector('[aria-current=step]')).toHaveTextContent('1Choose');
    expect(screen.getByRole('button', { name: 'Choose picture' })).toBeVisible();
  });

  it('fetches and presents effective policy when the dialog opens', async () => {
    vi.mocked(userApi.picturePolicy).mockResolvedValue({ ...picturePolicy, acceptedSourceFormats: ['image/png', 'image/webp'] });
    await renderPage();
    const drop = await screen.findByRole('group', { name: 'Picture source' });
    expect(within(drop).getByText('Drop an image here')).toBeVisible();
    expect(within(drop).getByText('Or paste an image from your clipboard')).toBeVisible();
    expect(within(drop).getByText('PNG or WebP')).toBeVisible();
    expect(screen.queryByText(/512 × 512 WebP/)).not.toBeInTheDocument();
    expect(userApi.picturePolicy).toHaveBeenCalledWith(expect.objectContaining({ tokenProvider: expect.any(Function) }));
  });
  it('shows compact processing and saving feedback before the actions and returns to Frame on upload failure', async () => {
    let finishProcessing!: (picture: Blob) => void;
    let failUpload!: (cause: Error) => void;
    processPicture.mockImplementationOnce(() => new Promise((resolve) => { finishProcessing = resolve; }));
    vi.mocked(userApi.uploadPicture).mockImplementationOnce(() => new Promise((_resolve, reject) => { failUpload = reject; }));
    await renderPage();
    const user = userEvent.setup();
    expect(screen.queryByRole('group', { name: 'Picture feedback' })).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const progress = screen.getByRole('list', { name: 'Picture editing progress' });
    expect(progress.querySelector('[aria-current=step]')).toHaveTextContent('3Save');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Processing picture…');
    expect(status).not.toHaveTextContent('Cancel');
    const actions = screen.getByRole('group', { name: 'Picture actions' });
    expect(screen.getByRole('group', { name: 'Picture feedback' }).compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel picture processing' })).toBeEnabled();
    await act(async () => finishProcessing(canonical));
    expect(screen.getByRole('status')).toHaveTextContent('Saving picture…');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Cancel picture processing' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await act(async () => failUpload(new Error('Upload unavailable')));
    expect(screen.getByRole('alert')).toHaveTextContent('Upload unavailable');
    expect(progress.querySelector('[aria-current=step]')).toHaveTextContent('2Frame');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps initial decode Retry in the alert and allows selecting the same file after failure', async () => {
    vi.mocked(openPictureSource).mockRejectedValueOnce(new Error('Unable to decode this picture. Retry the selection.'));
    vi.mocked(userApi.uploadPicture).mockResolvedValue({ ...profile, version: 2 });
    await renderPage();
    const user = userEvent.setup();
    const file = new File(['png'], 'portrait.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Choose picture'), file);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Picture source' })).toBeVisible();
    await user.upload(screen.getByLabelText('Choose picture'), file);
    expect(await screen.findByRole('group', { name: 'Picture crop' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(openPictureSource).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    vi.mocked(openPictureSource).mockRejectedValueOnce(new Error('Decode failed'));
    await user.upload(screen.getByLabelText('Choose picture'), file);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(userApi.uploadPicture).toHaveBeenCalled());
    expect(openPictureSource).toHaveBeenCalledTimes(4);
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
      const remove = screen.getByRole('button', { name: 'Reset' });
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
    expect(screen.getByRole('group', { name: 'Picture crop' })).toBeInTheDocument();
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
    await waitFor(() => expect(openPictureSource).toHaveBeenLastCalledWith(picture, expect.any(AbortSignal), profile.pictureUploadLimits));
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('1');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(disposePicture).toHaveBeenCalled();
  });

  it.each(['picker', 'drop', 'paste'].flatMap((route) => ['png', 'gif'].map((format) => ({ route, format }))))('fences processing when $route replaces the source with $format and resets the crop', async ({ route, format }) => {
    let finish: ((value: Blob) => void) | undefined;
    let signal: AbortSignal | undefined;
    processPicture.mockImplementationOnce((_crop, _policy, capturedSignal) => { signal = capturedSignal; return new Promise((resolve) => { finish = resolve; }); });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['old'], 'old.gif', { type: 'image/gif' }));
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const replacement = new File(['new'], `new.${format}`, { type: `image/${format}` });
    if (route === 'picker') await user.upload(screen.getByLabelText('Choose picture'), replacement);
    else if (route === 'drop') fireEvent.drop(screen.getByRole('dialog', { name: 'Profile picture' }), { dataTransfer: { files: [replacement] } });
    else fireEvent.paste(document, { clipboardData: { items: [{ kind: 'file', type: replacement.type, getAsFile: () => replacement }] } });
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole('slider', { name: 'Zoom' })).toHaveValue('1');
    await act(async () => finish?.(canonical));
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Picture crop' })).toBeInTheDocument();
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
    expect(screen.getByText('Drop an image here')).toBeInTheDocument();
    fireEvent.paste(document, { clipboardData: imageData });
    expect(await screen.findByRole('group', { name: 'Picture crop' })).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Reset crop' }));
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

  it.each([
    { key: 'ArrowLeft', x: 320, y: 100 },
    { key: 'ArrowRight', x: 280, y: 100 },
    { key: 'ArrowUp', x: 300, y: 120 },
    { key: 'ArrowDown', x: 300, y: 80 },
    { key: 'Home', x: 300, y: 100 },
  ])('applies $key through the focused crop without directional buttons', async ({ key, x, y }) => {
    vi.mocked(userApi.uploadPicture).mockResolvedValue({ ...profile, version: 2 });
    await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['source'], 'picture.png', { type: 'image/png' }));
    const zoom = await screen.findByRole('slider', { name: 'Zoom' });
    fireEvent.change(zoom, { target: { value: '2' } });
    const crop = screen.getByRole('group', { name: 'Picture crop' });
    expect(screen.queryByRole('button', { name: /Move picture (left|right|up|down)/ })).not.toBeInTheDocument();
    crop.focus();
    await user.keyboard(`{${key}}`);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(userApi.uploadPicture).toHaveBeenCalled());
    expect(processPicture).toHaveBeenCalledWith(
      expect.objectContaining({ x, y, size: 200 }), picturePolicy, expect.any(AbortSignal)
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
    expect(screen.getByRole('group', { name: 'Picture crop' })).toBeInTheDocument();
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    await act(async () => { finishOtherCommand?.(); await pending; });
  });

  it('warns about a small source, disables zoom, and still permits Apply', async () => {
    vi.mocked(openPictureSource).mockResolvedValue({ width: 32, height: 48, preview: new Blob(), process: processPicture, dispose: disposePicture });
    await renderPage();
    await userEvent.setup().upload(screen.getByLabelText('Choose picture'), new File(['png'], 'small.png', { type: 'image/png' }));
    expect(await screen.findByRole('slider', { name: 'Zoom' })).toBeDisabled();
    expect(screen.getByText(/smaller than 64/)).toHaveTextContent('This crop will be enlarged and may look pixelated.');
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveAccessibleDescription(/Further zoom is disabled/);
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

  it.each(['cancel', 'escape'])('returns focus to Reset after dismissing its confirmation with %s', async (dismissal) => {
    await renderPage({ ...profile, pictureAssetId: 'original-picture' });
    const user = userEvent.setup();
    const remove = screen.getByRole('button', { name: 'Reset' });
    await user.click(remove);
    const confirmation = screen.getByRole('alertdialog');
    if (dismissal === 'cancel') await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    else await user.keyboard('{Escape}');
    await waitFor(() => expect(remove).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Profile picture' })).toBeInTheDocument();
    expect(userApi.removePicture).not.toHaveBeenCalled();
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

  it('blocks duplicate picture writes and removes the normal Profile refresh action', async () => {
    let finishUpload: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.uploadPicture).mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    const { client } = await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const form = screen.getByRole('button', { name: 'Apply' }).closest('form');
    if (!form) throw new Error('Picture form missing');
    fireEvent.submit(form);
    expect(userApi.uploadPicture).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Refresh Profile' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Choose picture')).toBeDisabled();
    expect(userApi.ensureProfile).not.toHaveBeenCalled();
    const updated = { ...profile, pictureAssetId: 'picture_new', version: 2 };
    await act(async () => finishUpload?.(updated));
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refreshes a conflict without losing the edit and waits for Retry with the authoritative version', async () => {
    vi.mocked(userApi.uploadPicture).mockRejectedValueOnce(new UserApiError('Conflict', 409, { type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/profile-version-conflict.md' }));
    const refreshed = { ...profile, version: 7, pictureAssetId: 'remote_picture' };
    const accepted = { ...refreshed, version: 8, pictureAssetId: 'accepted_picture' };
    vi.mocked(userApi.ensureProfile).mockResolvedValue(refreshed);
    vi.mocked(userApi.uploadPicture).mockResolvedValueOnce(accepted);
    const { client } = await renderPage();
    const user = userEvent.setup();
    const source = new File(['png'], 'portrait.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Choose picture'), source);
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(refreshed));
    expect(screen.getByRole('alert')).toHaveTextContent('Your Profile changed elsewhere');
    const latest = screen.getByRole('group', { name: 'Latest saved picture' });
    expect(within(latest).getByRole('img')).toHaveAttribute('src', '/media/profile-pictures/remote_picture');
    expect(screen.getByRole('group', { name: 'Picture crop' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('2');
    expect(userApi.uploadPicture).toHaveBeenCalledTimes(1);
    expect(userApi.uploadPicture).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedVersion: 1 }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(accepted));
    expect(userApi.uploadPicture).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedVersion: 7 }));
    expect(processPicture.mock.calls.map(([crop]) => crop)).toEqual([expect.objectContaining({ x: 300, y: 100, size: 200, zoom: 2 }), expect.objectContaining({ x: 300, y: 100, size: 200, zoom: 2 })]);
    expect(openPictureSource).toHaveBeenCalledWith(source, expect.any(AbortSignal), profile.pictureUploadLimits);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps valid cache refresh publication separate from a closed and reopened dialog', async () => {
    let finishRefresh: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.uploadPicture).mockRejectedValueOnce(new UserApiError('Conflict', 409, { type: 'https://wallpaperdb.test/problems/profile-version-conflict' }));
    vi.mocked(userApi.ensureProfile).mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const { client } = await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'old.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(finishRefresh).toBeDefined());
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Edit profile picture' }));
    const refreshed = { ...profile, version: 5, pictureAssetId: 'latest_picture' };
    await act(async () => finishRefresh?.(refreshed));
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(refreshed);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Latest saved picture' })).not.toBeInTheDocument();
    expect(screen.getByText('Drop an image here')).toBeInTheDocument();
    expect(userApi.uploadPicture).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('abandons conflict recovery when the owner query is removed and recreated', async () => {
    let finishRefresh: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.uploadPicture).mockRejectedValueOnce(new UserApiError('Conflict', 409, { type: 'https://wallpaperdb.test/problems/profile-version-conflict' }));
    vi.mocked(userApi.ensureProfile).mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const { client, rerender } = await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'old.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(finishRefresh).toBeDefined());
    const replacement = { ...profile, version: 20, pictureAssetId: 'replacement_picture' };
    act(() => {
      client.removeQueries({ queryKey: profileQueryKey(profile.id) });
      client.setQueryData(profileQueryKey(profile.id), replacement);
    });
    rerender(<QueryClientProvider client={client}><ProfileSettingsPage /></QueryClientProvider>);
    await act(async () => finishRefresh?.({ ...profile, version: 5, pictureAssetId: 'obsolete_picture' }));
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(replacement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Edit profile picture' }));
    expect(screen.getByText('Drop an image here')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['navigation', 'sign-out', 'owner switch'])('aborts picture processing across %s without a late upload or feedback', async (transition) => {
    let finish: ((value: Blob) => void) | undefined;
    let signal: AbortSignal | undefined;
    processPicture.mockImplementationOnce((_crop, _policy, capturedSignal) => { signal = capturedSignal; return new Promise((resolve) => { finish = resolve; }); });
    const { client, rerender, unmount } = await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'old.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const other = { ...profile, id: 'other-owner', displayName: 'Other owner' };
    if (transition === 'navigation') unmount();
    else {
      client.setQueryData(profileQueryKey(other.id), other);
      if (transition === 'owner switch')
        vi.mocked(useAuth, { partial: true }).mockReturnValue({ getToken: vi.fn().mockResolvedValue('other-token'), isLoaded: true, isSignedIn: true, userId: other.id });
      else
        vi.mocked(useAuth, { partial: true }).mockReturnValue({ getToken: vi.fn().mockResolvedValue(null), isLoaded: true, isSignedIn: false, userId: null });
      rerender(<QueryClientProvider client={client}><ProfileSettingsPage /></QueryClientProvider>);
    }
    expect(signal?.aborted).toBe(true);
    expect(disposePicture).toHaveBeenCalled();
    await act(async () => finish?.(canonical));
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    if (transition === 'owner switch') expect(client.getQueryData(profileQueryKey(other.id))).toEqual(other);
  });

  it('publishes an accepted picture to its valid owner cache after navigation without obsolete UI feedback', async () => {
    let finish: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.uploadPicture).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { client, unmount } = await renderPage();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose picture'), new File(['png'], 'portrait.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(finish).toBeDefined());
    unmount();
    const accepted = { ...profile, version: 2, pictureAssetId: 'accepted_picture' };
    await act(async () => finish?.(accepted));
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(accepted);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(['png', 'gif'])('presents rules before selection and retains a %s source when processed bytes exceed the limit', async (format) => {
    vi.mocked(userApi.picturePolicy).mockResolvedValue({ ...picturePolicy, maxOutputBytes: 4 });
    await renderPage();
    expect(await screen.findByText('JPEG, PNG, WebP or GIF')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['12345'], `large.${format}`, { type: `image/${format}` })
    );
    processPicture.mockRejectedValue(new Error('Processed picture exceeds the 4 byte limit. Choose another picture.'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Processed picture exceeds the 4 byte limit.');
    expect(screen.getByRole('group', { name: 'Picture crop' })).toBeInTheDocument();
    expect(screen.queryByText(/Up to 4 B/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
  });

  it('keeps an impossible animation edit and saved Profile intact until an explicit Retry succeeds', async () => {
    processPicture.mockRejectedValueOnce(new Error('Processed animation cannot fit the 4 byte limit. Choose another picture.'));
    const { client } = await renderPage();
    const user = userEvent.setup();
    const file = new File(['gif'], 'animation.gif', { type: 'image/gif' });
    await user.upload(screen.getByLabelText('Choose picture'), file);
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('animation cannot fit');
    expect(screen.getByRole('group', { name: 'Picture crop' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('2');
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(profile);
    expect(openPictureSource).toHaveBeenCalledWith(file, expect.any(AbortSignal), profile.pictureUploadLimits);
    const accepted = { ...profile, version: 2, pictureAssetId: 'fitted_picture' };
    vi.mocked(userApi.uploadPicture).mockResolvedValue(accepted);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(accepted));
    expect(processPicture.mock.calls[1][0]).toEqual(processPicture.mock.calls[0][0]);
    expect(processPicture.mock.calls[1][0]).toMatchObject({ x: 300, y: 100, size: 200, zoom: 2 });
    expect(processPicture.mock.calls[1][1]).toEqual(processPicture.mock.calls[0][1]);
    expect(openPictureSource).toHaveBeenCalledTimes(1);
    expect(userApi.uploadPicture).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported picture files before sending an upload', async () => {
    await renderPage();
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['<svg/>'], 'picture.svg', { type: 'image/svg+xml' })
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPEG, PNG, WebP, or GIF picture.');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(userApi.uploadPicture).not.toHaveBeenCalled();
  });

  it('lets a generated-avatar choice cancel a pending import before any picture is available', async () => {
    const updated = { ...profile, version: 2 };
    vi.mocked(userApi.removePicture).mockResolvedValue(updated);
    const { client } = await renderPage({ ...profile, pictureImportStatus: 'pending' });
    const user = userEvent.setup();
    expect(screen.getByText(/importing your account picture/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Use generated avatar' })
    );
    await waitFor(() => expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated));
    expect(userApi.removePicture).toHaveBeenCalledWith({
      expectedVersion: 1,
      expectedProfileId: profile.id,
      tokenProvider: expect.any(Function),
    });
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
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
