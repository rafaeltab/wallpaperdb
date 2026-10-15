import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { ProfilePictureSettings } from '../../src/components/profile/profile-picture-settings';
import { profileQueryKey } from '../../src/features/profile-management/adapters/query';
import { userApi, type Profile } from '../../src/lib/api/user';
import { openPictureSource } from '../../src/features/picture-editor/adapters/browser';
import '../../src/index.css';

vi.mock('../../src/features/picture-editor/adapters/browser', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/features/picture-editor/adapters/browser')>();
  return { ...original, openPictureSource: vi.fn(original.openPictureSource) };
});

const profile: Profile = {
  id: 'picture-editor-owner', handle: 'ada', displayName: 'Ada Lovelace', biographyMarkdown: '',
  pictureAssetId: null, pictureImportStatus: 'pending', version: 1,
  pictureUploadLimits: { maxBytes: 5242880, maxPixels: 16000000, maxDecodedBytes: 536870912 },
  createdAt: '2026-07-12T12:00:00.000Z', updatedAt: '2026-07-12T12:00:00.000Z',
};
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.mocked(openPictureSource).mockReset();
  vi.spyOn(userApi, 'picturePolicy').mockResolvedValue({
    output: { width: 512, height: 512, mimeType: 'image/webp', colorSpace: 'srgb' },
    maxOutputBytes: 5242880, acceptedSourceFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    animation: { available: true }, encoding: { staticQuality: 85, animationQuality: 85 },
  });
});
afterEach(async () => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  await page.viewport(1280, 800);
});

function mount(initial = profile) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(profileQueryKey(initial.id), initial);
  render(<QueryClientProvider client={client}><ProfilePictureSettings profile={initial} tokenProvider={async () => null} /></QueryClientProvider>);
}
async function png(width = 800, height = 400) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Missing fixture canvas');
  context.fillStyle = 'red'; context.fillRect(0, 0, width / 2, height);
  context.fillStyle = 'blue'; context.fillRect(width / 2, 0, width / 2, height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Fixture encoding failed')), 'image/png'));
  return new File([blob], 'picture.png', { type: 'image/png' });
}
async function choose(file: File) {
  mount();
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  const input = page.getByLabelText('Choose picture', { exact: true });
  await expect.element(input).toBeEnabled();
  await userEvent.upload(input, file);
  await expect.element(page.getByRole('img', { name: 'Selected avatar' })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
}
function crop() { return screen.getByRole('group', { name: 'Picture crop' }); }
function image() { return screen.getByRole<HTMLImageElement>('img', { name: 'Selected avatar' }); }
function zoom() { return screen.getByRole<HTMLInputElement>('slider', { name: 'Zoom' }); }

it.each(['corrupt', 'over-budget'])('replaces a %s source through the picker without reopening the dialog', async (failure) => {
  const owner = { ...profile, pictureUploadLimits: { ...profile.pictureUploadLimits, maxDecodedBytes: 4 * 1024 * 1024 } };
  const upload = vi.spyOn(userApi, 'uploadPicture').mockResolvedValue({ ...owner, version: 2, pictureAssetId: 'replacement' });
  const bytes = failure === 'corrupt'
    ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    : Uint8Array.from(('47494638396100020002800000000000ffffff' +
      '2c0000000001000100000202440100'.repeat(5) + '3b').match(/../g)!, (byte) => parseInt(byte, 16));
  mount(owner);
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  const picker = page.getByLabelText('Choose picture', { exact: true });
  await expect.element(picker).toBeEnabled();
  await userEvent.upload(picker, new File([bytes], 'invalid.' + (failure === 'corrupt' ? 'png' : 'gif'), { type: failure === 'corrupt' ? 'image/png' : 'image/gif' }));
  await expect.element(page.getByRole('alert')).toBeVisible();
  if (failure === 'over-budget') expect(screen.getByRole('alert').textContent).toContain('decoded byte limit');
  expect(upload).not.toHaveBeenCalled();
  const chooseButton = screen.getByText('Choose picture', { selector: 'button' });
  await expect.element(chooseButton).toBeVisible();
  await userEvent.click(chooseButton);
  await userEvent.upload(picker, await png());
  await expect.element(page.getByRole('img', { name: 'Selected avatar' })).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose picture' })).toBeNull();
  await userEvent.click(page.getByRole('button', { name: 'Apply', exact: true }));
  await expect.poll(() => upload.mock.calls.length).toBe(1);
  expect(upload.mock.calls[0][0]).toMatchObject({ picture: expect.objectContaining({ type: 'image/webp' }), expectedVersion: 1 });
  await expect.element(page.getByRole('dialog', { name: 'Profile picture', exact: true })).not.toBeInTheDocument();
});

it.each([{ width: 1280, height: 800 }, { width: 360, height: 800 }])('keeps circular avatars and the edit control on their edge at $width pixels', async ({ width, height }) => {
  await page.viewport(width, height);
  mount();
  const avatar = screen.getByRole('img', { name: "Ada Lovelace's profile picture" });
  const box = avatar.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.width).toBe(box.height);
  expect(Number.parseFloat(getComputedStyle(avatar).borderTopLeftRadius)).toBeGreaterThanOrEqual(box.width / 2);
  const edit = screen.getByRole('button', { name: 'Edit profile picture' }).getBoundingClientRect();
  const distance = Math.hypot(edit.x + edit.width / 2 - box.x - box.width / 2, edit.y + edit.height / 2 - box.y - box.height / 2);
  expect(distance).toBeGreaterThan(box.width * 0.4);
  expect(distance).toBeLessThanOrEqual(box.width / 2 + 2);
});

it('hides selection guidance after a real file is chosen and lets Back discard it inside the dialog', async () => {
  await choose(await png());
  expect(screen.queryByText('Choose picture', { selector: 'button' })).toBeNull();
  expect(screen.queryByText(/Choose, drop, or paste/)).toBeNull();
  expect(screen.queryByText(/512 × 512 WebP/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Reset' }).getAttribute('data-variant')).toBe('destructive');
  expect(screen.queryByText('picture.png')).toBeNull();
  await userEvent.click(page.getByRole('button', { name: 'Back', exact: true }));
  expect(screen.getByRole('dialog', { name: 'Profile picture' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByText('Choose picture', { selector: 'button' }));
  await expect.element(screen.getByText('Choose picture', { selector: 'button' })).toBeVisible();
  expect(screen.queryByRole('img', { name: 'Selected avatar' })).toBeNull();
});

it.each([{ width: 1280, height: 800 }, { width: 360, height: 800 }])('shows source context around the crop and supports keyboard framing at $width pixels', async ({ width, height }) => {
  await page.viewport(width, height);
  await choose(await png());
  const stage = crop().getBoundingClientRect();
  const boundary = screen.getByTestId('picture-crop-boundary').getBoundingClientRect();
  expect(boundary.width).toBeLessThan(stage.width * 0.8);
  expect(boundary.x).toBeGreaterThan(stage.x);
  expect(image().getBoundingClientRect().width / boundary.width).toBeCloseTo(2, 1);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  expect(screen.queryByRole('button', { name: /Move picture (left|right|up|down)/ })).toBeNull();
  crop().focus();
  const before = image().getBoundingClientRect().x;
  await userEvent.keyboard('{ArrowLeft}');
  await expect.poll(() => image().getBoundingClientRect().x).toBeLessThan(before);
  await userEvent.keyboard('{ArrowRight}');
  await expect.poll(() => image().getBoundingClientRect().x).toBeCloseTo(before, -1);
  zoom().focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(Number(zoom().value)).toBeGreaterThan(1);
  await userEvent.click(page.getByRole('button', { name: 'Reset crop', exact: true }));
  expect(zoom().value).toBe('1');
});

it('keeps file-drag feedback across nested children, ignores text drags, and clears it on leave, drop, and reopening', async () => {
  mount({ ...profile, pictureImportStatus: 'complete' });
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  const dialog = screen.getByRole('dialog', { name: 'Profile picture' });
  const picker = screen.getByText('Choose picture', { selector: 'button' });
  const text = new DataTransfer();
  text.setData('text/uri-list', 'https://example.test/picture.png');
  dialog.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: text }));
  expect(screen.queryByText('Drop to edit picture')).toBeNull();
  const files = new DataTransfer();
  files.items.add(await png());
  dialog.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: files }));
  await expect.element(page.getByText('Drop to edit picture', { exact: true })).toBeVisible();
  picker.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: files }));
  dialog.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: files }));
  expect(screen.getByText('Drop to edit picture')).toBeTruthy();
  picker.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: files }));
  await expect.element(page.getByText('Drop an image here', { exact: true })).toBeVisible();
  dialog.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: files }));
  const dropping = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files });
  dialog.dispatchEvent(dropping);
  expect(dropping.defaultPrevented).toBe(true);
  await expect.element(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await userEvent.click(page.getByRole('button', { name: 'Back', exact: true }));
  await expect.element(page.getByText('Drop an image here', { exact: true })).toBeVisible();
  dialog.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: files }));
  await userEvent.keyboard('{Escape}');
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  await expect.element(page.getByText('Drop an image here', { exact: true })).toBeVisible();
});

it.each([{ width: 1280, height: 800 }, { width: 360, height: 640 }])('places wrapping initial-selection errors beside Retry and keeps exactly 16 pixels before actions at $width pixels', async ({ width, height }) => {
  await page.viewport(width, height);
  mount({ ...profile, pictureImportStatus: 'complete' });
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  const picker = page.getByLabelText('Choose picture', { exact: true });
  await expect.element(picker).toBeEnabled();
  const source = screen.getByRole('group', { name: 'Picture source' });
  const actions = screen.getByRole('group', { name: 'Picture actions' });
  const idleHeight = screen.getByRole('dialog').getBoundingClientRect().height;
  expect(screen.queryByRole('group', { name: 'Picture feedback' })).toBeNull();
  expect(actions.getBoundingClientRect().top - source.getBoundingClientRect().bottom).toBe(16);
  await userEvent.upload(picker, new File(['invalid'], 'invalid.png', { type: 'image/png' }));
  await expect.element(page.getByRole('alert')).toBeVisible();
  const alert = screen.getByRole('alert');
  const message = alert.querySelector('[data-slot="alert-description"]')!;
  const retry = screen.getByRole('button', { name: 'Retry' });
  expect(retry.closest('[role=alert]')).toBe(alert);
  const messageBox = message.getBoundingClientRect(), retryBox = retry.getBoundingClientRect();
  expect(retryBox.left).toBeGreaterThanOrEqual(messageBox.right);
  expect(Math.abs((retryBox.top + retryBox.height / 2) - (messageBox.top + messageBox.height / 2))).toBeLessThan(1);
  const feedback = screen.getByRole('group', { name: 'Picture feedback' });
  expect(actions.getBoundingClientRect().top - feedback.getBoundingClientRect().bottom).toBe(16);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  const dialog = screen.getByRole('dialog');
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  actions.scrollIntoView();
  expect(actions.getBoundingClientRect().bottom).toBeLessThanOrEqual(dialog.getBoundingClientRect().bottom);
  await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  await expect.element(picker).toBeEnabled();
  expect(screen.getByRole('dialog').getBoundingClientRect().height).toBe(idleHeight);
});

it('keeps status spacing, stops the spinner under reduced motion, and shrinks after cancellation', async () => {
  let finishProcessing!: (picture: Blob) => void;
  let failUpload!: (cause: Error) => void;
  const file = await png();
  const url = URL.createObjectURL(file);
  vi.mocked(openPictureSource).mockResolvedValueOnce({
    width: 800, height: 400, preview: file,
    process: () => new Promise((resolve) => { finishProcessing = resolve; }),
    dispose: () => URL.revokeObjectURL(url),
  });
  const upload = vi.spyOn(userApi, 'uploadPicture').mockImplementationOnce(() => new Promise((_resolve, reject) => { failUpload = reject; }));
  mount({ ...profile, pictureImportStatus: 'complete' });
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  const picker = page.getByLabelText('Choose picture', { exact: true });
  await expect.element(picker).toBeEnabled();
  await userEvent.upload(picker, file);
  await expect.element(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  const dialog = screen.getByRole('dialog');
  const idleHeight = dialog.getBoundingClientRect().height;
  await userEvent.click(page.getByRole('button', { name: 'Apply', exact: true }));
  const status = screen.getByRole('status');
  const spinner = status.parentElement!.querySelector('svg')!;
  const actions = screen.getByRole('group', { name: 'Picture actions' });
  const feedback = screen.getByRole('group', { name: 'Picture feedback' });
  expect(actions.getBoundingClientRect().top - feedback.getBoundingClientRect().bottom).toBe(16);
  expect(getComputedStyle(spinner).animationName).toBe('spin');
  const session = cdp();
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    await expect.poll(() => getComputedStyle(spinner).animationName).toBe('none');
    expect(status.textContent).toBe('Processing picture…');
    await userEvent.click(page.getByRole('button', { name: 'Cancel picture processing', exact: true }));
    expect(screen.queryByRole('group', { name: 'Picture feedback' })).toBeNull();
    expect(dialog.getBoundingClientRect().height).toBe(idleHeight);
    finishProcessing(new Blob(['late']));
    await expect.element(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
    expect(upload).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole('button', { name: 'Apply', exact: true }));
    finishProcessing(new Blob(['processed']));
    await expect.element(page.getByRole('status')).toHaveTextContent('Saving picture…');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    const savingFeedback = screen.getByRole('group', { name: 'Picture feedback' });
    expect(actions.getBoundingClientRect().top - savingFeedback.getBoundingClientRect().bottom).toBe(16);
    failUpload(new Error('The picture could not be uploaded. Your crop is retained. Retry when the connection is available.'));
    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
    const errorFeedback = screen.getByRole('group', { name: 'Picture feedback' });
    expect(actions.getBoundingClientRect().top - errorFeedback.getBoundingClientRect().bottom).toBe(16);
  } finally {
    await session.send('Emulation.setEmulatedMedia', { features: [] });
  }
});

it('traps keyboard focus and restores the opener on close', async () => {
  await choose(await png());
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await userEvent.click(close);
  await userEvent.click(page.getByRole('button', { name: 'Edit profile picture', exact: true }));
  await expect.element(page.getByRole('heading', { name: 'Profile picture' })).toHaveFocus();
  const dialog = screen.getByRole('dialog');
  await userEvent.tab({ shift: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await userEvent.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
  await expect.element(page.getByRole('button', { name: 'Edit profile picture', exact: true })).toHaveFocus();
});

it('clamps native dragging without selecting the dialog title or file name', async () => {
  await choose(await png());
  const stage = crop().getBoundingClientRect();
  expect(getComputedStyle(crop()).userSelect).toBe('none');
  await userEvent.dragAndDrop(crop(), screen.getByRole('heading', { name: 'Profile picture' }));
  expect(window.getSelection()?.toString()).toBe('');
  await userEvent.click(page.getByRole('button', { name: 'Reset crop', exact: true }));
  await userEvent.dragAndDrop(crop(), crop(), { sourcePosition: { x: stage.width / 2, y: stage.height / 2 }, targetPosition: { x: stage.width - 2, y: stage.height / 2 } });
  expect(window.getSelection()?.toString()).toBe('');
  await expect.poll(() => image().getBoundingClientRect().x).toBeCloseTo(stage.x + stage.width * 0.125, -1);
});

it('zooms with the wheel and lets a bounded crop yield scrolling to the dialog', async () => {
  await page.viewport(1280, 480);
  await choose(await png());
  const dialog = screen.getByRole('dialog', { name: 'Profile picture' });
  expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight);
  await userEvent.hover(crop());
  const initialScroll = dialog.scrollTop;
  await userEvent.wheel(crop(), { delta: { y: 80 } });
  await expect.poll(() => dialog.scrollTop).toBeGreaterThan(initialScroll);
  expect(zoom().value).toBe('1');
  await userEvent.wheel(crop(), { delta: { y: -10000 } });
  await expect.poll(() => zoom().value).toBe('6.25');
  await userEvent.hover(crop());
  const lowerScroll = dialog.scrollTop;
  await userEvent.wheel(crop(), { delta: { y: -80 } });
  await expect.poll(() => dialog.scrollTop).toBeLessThan(lowerScroll);
  expect(zoom().value).toBe('6.25');
});

it('resizes the crop with a real two-finger pinch', async () => {
  await choose(await png());
  const box = crop().getBoundingClientRect();
  const offset = window.frameElement?.getBoundingClientRect();
  const x = box.x + box.width / 2 + (offset?.x ?? 0);
  const y = box.y + box.height / 2 + (offset?.y ?? 0);
  const session = cdp();
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: x - 20, y }, { id: 2, x: x + 20, y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x - 40, y }, { id: 2, x: x + 40, y }] });
    await expect.poll(() => zoom().value).toBe('2');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
});

it('keeps the GIF preview playing after dragging and zooming', async () => {
  const response = await fetch(new URL('../fixtures/profile-disposal.gif', import.meta.url));
  expect(response.ok).toBe(true);
  await choose(new File([await response.blob()], 'picture.gif', { type: 'image/gif' }));
  zoom().focus();
  await userEvent.keyboard('{End}');
  const stage = crop().getBoundingClientRect();
  await userEvent.dragAndDrop(crop(), crop(), { sourcePosition: { x: stage.width / 2, y: stage.height / 2 }, targetPosition: { x: stage.width - 2, y: stage.height / 2 } });
  const colors = new Set<string>();
  await expect.poll(async () => {
    const screenshot = await page.screenshot({ element: crop(), save: false, animations: 'allow' });
    const blob = await (await fetch(screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing screenshot canvas');
      context.drawImage(bitmap, 0, 0);
      const [red, green, blue] = context.getImageData(Math.floor(bitmap.width / 4), Math.floor(bitmap.height / 2), 1, 1).data;
      if (red > 220 && green < 40 && blue < 40) colors.add('red');
      if (green > 220 && red < 40 && blue < 40) colors.add('green');
      if (red > 220 && green > 220 && blue > 220) colors.add('white');
      if (red > 220 && green > 220 && blue < 40) colors.add('yellow');
      return colors.size;
    } finally { bitmap.close(); }
  }, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
});
