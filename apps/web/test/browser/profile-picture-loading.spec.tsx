import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { cdp, page } from 'vitest/browser';
import { Profiler } from 'react';
import { profilePictureTrace } from './profile-picture-trace';
import type {} from '@vitest/browser-playwright';
import { ProfilePictureImage } from '../../src/components/profile/profile-picture';
import '../../src/index.css';

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

it.each([undefined, 'flex size-6 shrink-0 items-center justify-center object-cover text-xs font-medium text-white'])(
  'preserves avatar dimensions and its accessible name through delayed success with class %s',
  async (className) => {
    await page.viewport(1280, 800);
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing fixture canvas');
    context.fillStyle = 'coral';
    context.fillRect(0, 0, 32, 32);
    const body = canvas.toDataURL().split(',')[1];
    // Prevent delivery until after the loading presentation has been measured.
    const session = cdp();
    const trace = profilePictureTrace(session, className);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    let receive: (event: { requestId: string; networkId?: string; request?: { url: string }; resourceType?: string }) => void = () => {};
    const paused = new Promise<string>((resolve) => { receive = (event) => { trace.record('Fetch.requestPaused', { requestId: event.requestId, networkId: event.networkId, url: event.request?.url, resourceType: event.resourceType }); resolve(event.requestId); }; });
    session.on('Fetch.requestPaused', receive);
    await session.send('Fetch.enable', { patterns: [{ urlPattern: '*avatar-delayed*' }] });
    try {
      const view = render(<Profiler id="avatar" onRender={(_, phase) => trace.snapshot(`react-${phase}`)}><ProfilePictureImage profile={{ id: 'ada', displayName: 'Ada Lovelace', picture: { id: 'delayed', url: `/avatar-delayed?size=${className ? 'small' : 'large'}` } }} className={className} /></Profiler>);
      trace.snapshot('render-returned');
      const pending = screen.getByRole('img');
      const before = pending.getBoundingClientRect();
      const borderWidth = getComputedStyle(pending).borderWidth;
      expect(before.width).toBe(className ? 24 : 112);
      expect(before.width).toBe(before.height);
      expect(Number.parseFloat(getComputedStyle(pending).borderRadius)).toBeGreaterThanOrEqual(before.width / 2);
      const spinner = pending.querySelector('svg');
      if (!spinner) throw new Error('Missing loading indicator');
      expect(getComputedStyle(spinner).animationName).toBe('spin');
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await expect.poll(() => getComputedStyle(spinner).animationName).toBe('none');
      expect(screen.getByRole('status').textContent).toBe('Loading profile picture');
      const { frameTree } = await session.send('Page.getFrameTree');
      trace.snapshot('before-AX-query');
      const frames = [frameTree, ...(frameTree.childFrames ?? [])];
      const accessibility = await Promise.all(frames.map(({ frame }) => session.send('Accessibility.getFullAXTree', { frameId: frame.id })));
      trace.snapshot('after-AX-query');
      expect(accessibility.some(({ nodes }) => nodes.some((node) => !node.ignored && node.role?.value === 'status'))).toBe(true);
      expect(screen.getByAltText("Ada Lovelace's profile picture").getAttribute('aria-hidden')).toBe('true');
      const attempt = screen.getByAltText<HTMLImageElement>("Ada Lovelace's profile picture");
      trace.snapshot('before-fulfill');
      await session.send('Fetch.fulfillRequest', { requestId: await paused, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body });
      trace.record('fulfilled');
      await expect.element(page.getByRole('img', { name: "Ada Lovelace's profile picture" })).toBeVisible();
      await expect.poll(() => screen.queryByRole('status')).toBeNull();
      expect(screen.getByAltText("Ada Lovelace's profile picture")).toBe(attempt);
      expect(attempt.complete && attempt.naturalWidth > 0).toBe(true);
      expect(getComputedStyle(attempt).opacity).toBe('1');
      const ready = screen.getByRole('img');
      expect(getComputedStyle(ready).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(ready.getBoundingClientRect().width).toBe(before.width);
      expect(ready.getBoundingClientRect().height).toBe(before.height);
      expect(ready.getBoundingClientRect().x).toBe(before.x);
      expect(getComputedStyle(ready).borderWidth).toBe(borderWidth);
      // A terminal failure uses the same dimensions and explains the fallback.
      trace.snapshot('success-assertions-passed');
      vi.useFakeTimers();
      view.rerender(<ProfilePictureImage profile={{ id: 'ada', displayName: 'Ada Lovelace', picture: { id: 'failure', url: '/avatar-delayed?failure' } }} className={className} />);
      await act(async () => vi.advanceTimersByTimeAsync(15000));
      expect(screen.getByRole('img').textContent).toBe('AL');
      expect(screen.getByRole('img').getBoundingClientRect().width).toBe(before.width);
      trace.snapshot('terminal-assertions-passed');
    } finally {
      trace.stop();
      session.off('Fetch.requestPaused', receive);
      await session.send('Fetch.disable');
      await session.send('Network.setCacheDisabled', { cacheDisabled: false });
    }
  }
);
