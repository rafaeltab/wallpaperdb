import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { cdp, page } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { ProfilePictureImage } from '../../src/components/profile/profile-picture';
import '../../src/index.css';

type LoadingDiagnosticPause = {
  requestId: string;
  request?: { url: string };
  frameId?: string;
  resourceType?: string;
  networkId?: string;
  responseErrorReason?: string;
  responseStatusCode?: number;
};

function createLoadingDiagnostic(size: 'small' | 'large') {
  type Kind =
    | 'inserted'
    | 'removed'
    | 'load'
    | 'error'
    | 'decodeCalled'
    | 'decodeFulfilled'
    | 'decodeRejected'
    | 'decodeThrew'
    | 'paused';
  type Phase =
    | 'setup'
    | 'render-return'
    | 'before-alt-lookup'
    | 'before-fulfill'
    | 'body-failed'
    | 'assertions-passed-before-cleanup';
  const source = `/avatar-delayed?size=${size}`;
  const alt = "Ada Lovelace's profile picture";
  const counts: Record<Kind, number> = {
    inserted: 0,
    removed: 0,
    load: 0,
    error: 0,
    decodeCalled: 0,
    decodeFulfilled: 0,
    decodeRejected: 0,
    decodeThrew: 0,
    paused: 0,
  };
  const events: {
    kind: Kind;
    phase: Phase;
    fixtureMatch?: boolean | null;
    imageType?: boolean | null;
    responseStage?: boolean;
    networkIdPresent?: boolean;
    frameId?: string;
  }[] = [];
  const snapshots: {
    phase: Phase;
    imagePresent: boolean;
    firstImageConnected: boolean | null;
    complete: boolean | null;
    positiveNaturalWidth: boolean | null;
    ariaHiddenMatches: boolean | null;
    loadingWrapper: boolean;
    statusPresent: boolean;
  }[] = [];
  const frameIds = new Set<string>();
  const testFrameIds = new Set<string>();
  let frameTreeObserved = false;
  let firstImage: HTMLImageElement | undefined;
  let observer: MutationObserver | undefined;
  let restoreDecode: (() => void) | undefined;
  let absoluteSource: string | undefined;
  let phase: Phase = 'setup';
  let result: 'not-completed' | 'body-failed' | 'assertions-passed-before-cleanup' =
    'not-completed';
  let observationFailure = false;
  let overflow = false;
  let omitted = 0;
  let frameOmitted = 0;
  let closed = false;
  let emitted = false;
  let observationStartAttempted = false;
  const guard = (action: () => void) => {
    try {
      action();
    } catch {
      observationFailure = true;
    }
  };
  const record = (kind: Kind, detail: Omit<(typeof events)[number], 'kind' | 'phase'> = {}) => {
    guard(() => {
      if (closed) return;
      if (counts[kind] < 65535) counts[kind] += 1;
      else overflow = true;
      if (events.length < 16) events.push({ kind, phase, ...detail });
      else if (omitted < 65535) omitted += 1;
      else overflow = true;
    });
  };
  const fixture = (value: unknown): value is HTMLImageElement => {
    let matches = false;
    guard(() => {
      matches =
        value instanceof HTMLImageElement &&
        value.getAttribute('alt') === alt &&
        value.getAttribute('src') === source;
    });
    return matches;
  };
  const imageEvent = (event: Event) => {
    guard(() => {
      if (!fixture(event.target)) return;
      firstImage ??= event.target;
      if (event.type === 'load') record('load');
      if (event.type === 'error') record('error');
    });
  };
  const visit = (node: Node, kind: 'inserted' | 'removed') => {
    guard(() => {
      if (fixture(node)) {
        firstImage ??= node;
        record(kind);
      }
      if (node instanceof Element)
        for (const image of node.querySelectorAll('img')) {
          if (fixture(image)) {
            firstImage ??= image;
            record(kind);
          }
        }
    });
  };
  const snapshot = (next: Phase) => {
    guard(() => {
      phase = next;
      if (snapshots.length >= 4) {
        observationFailure = true;
        return;
      }
      const image = Array.from(document.querySelectorAll('img')).find(fixture);
      firstImage ??= image;
      const reference = image ?? firstImage;
      snapshots.push({
        phase,
        imagePresent: Boolean(image),
        firstImageConnected: firstImage?.isConnected ?? null,
        complete: reference?.complete ?? null,
        positiveNaturalWidth: reference ? reference.naturalWidth > 0 : null,
        ariaHiddenMatches: reference ? reference.getAttribute('aria-hidden') === 'true' : null,
        loadingWrapper: Array.from(document.querySelectorAll('[role="img"]')).some(
          (element) =>
            element.getAttribute('aria-label') === alt && Boolean(element.querySelector('svg'))
        ),
        statusPresent: Array.from(document.querySelectorAll('[aria-live="polite"]')).some(
          (element) => element.textContent === 'Loading profile picture'
        ),
      });
    });
  };
  return {
    start() {
      observationStartAttempted = true;
      guard(() => {
        absoluteSource = new URL(source, document.baseURI).href;
      });
      guard(() => {
        document.addEventListener('load', imageEvent, true);
      });
      guard(() => {
        document.addEventListener('error', imageEvent, true);
      });
      guard(() => {
        observer = new MutationObserver((records) => {
          guard(() => {
            for (const change of records) {
              for (const node of change.addedNodes) visit(node, 'inserted');
              for (const node of change.removedNodes) visit(node, 'removed');
            }
          });
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
      guard(() => {
        const original = HTMLImageElement.prototype.decode;
        const spy = vi.spyOn(HTMLImageElement.prototype, 'decode');
        restoreDecode = () => spy.mockRestore();
        spy.mockImplementation(function (this: HTMLImageElement) {
          const selected = fixture(this);
          if (selected) record('decodeCalled');
          let promise: Promise<void>;
          try {
            promise = original.call(this);
          } catch (error) {
            if (selected) record('decodeThrew');
            throw error;
          }
          if (selected)
            guard(() => {
              void promise.then(
                () => record('decodeFulfilled'),
                () => record('decodeRejected')
              );
            });
          return promise;
        });
      });
    },
    paused(event: LoadingDiagnosticPause) {
      guard(() => {
        record('paused', {
          fixtureMatch:
            absoluteSource === undefined || event.request === undefined
              ? null
              : event.request.url === absoluteSource,
          imageType: event.resourceType === undefined ? null : event.resourceType === 'Image',
          responseStage:
            event.responseErrorReason !== undefined || event.responseStatusCode !== undefined,
          networkIdPresent: event.networkId !== undefined,
          frameId: event.frameId,
        });
      });
    },
    frames(value: readonly { frame: { id: string; name?: string } }[]) {
      guard(() => {
        frameTreeObserved = true;
        for (const { frame } of value) {
          if (frameIds.size >= 16) {
            if (frameOmitted < 65535) frameOmitted += 1;
            else overflow = true;
            continue;
          }
          frameIds.add(frame.id);
          if (frame.name === 'vitest-iframe') testFrameIds.add(frame.id);
        }
      });
    },
    snapshot,
    passed() {
      result = 'assertions-passed-before-cleanup';
    },
    failed() {
      result = 'body-failed';
    },
    finish() {
      if (emitted) return;
      // Diagnostic cleanup and reporting must not replace test or original cleanup failures.
      guard(() => {
        for (const change of observer?.takeRecords() ?? []) {
          for (const node of change.addedNodes) visit(node, 'inserted');
          for (const node of change.removedNodes) visit(node, 'removed');
        }
      });
      snapshot(
        result === 'body-failed'
          ? 'body-failed'
          : result === 'assertions-passed-before-cleanup'
            ? 'assertions-passed-before-cleanup'
            : phase
      );
      closed = true;
      guard(() => {
        observer?.disconnect();
      });
      guard(() => {
        document.removeEventListener('load', imageEvent, true);
      });
      guard(() => {
        document.removeEventListener('error', imageEvent, true);
      });
      guard(() => {
        restoreDecode?.();
      });
      guard(() => {
        if (emitted) return;
        emitted = true;
        const samples = events.map((event) => ({
          kind: event.kind,
          phase: event.phase,
          ...(event.kind === 'paused'
            ? {
                fixtureMatch: event.fixtureMatch,
                imageType: event.imageType,
                responseStage: event.responseStage,
                networkIdPresent: event.networkIdPresent,
                frameInExistingTree:
                  !frameTreeObserved ||
                  event.frameId === undefined ||
                  (frameOmitted > 0 && !frameIds.has(event.frameId))
                    ? null
                    : frameIds.has(event.frameId),
                frameMatchesNamedTestFrame:
                  testFrameIds.size === 0 ||
                  event.frameId === undefined ||
                  (frameOmitted > 0 && !testFrameIds.has(event.frameId))
                    ? null
                    : testFrameIds.has(event.frameId),
              }
            : {}),
        }));
        console.info(
          '[profile-loading-diagnostic-v1]',
          JSON.stringify({
            case: size,
            result,
            counts,
            samples,
            snapshots,
            frameTreeObserved,
            namedTestFrameObserved: testFrameIds.size > 0,
            frameOmitted,
            omitted,
            truncated: frameOmitted > 0 || omitted > 0 || overflow,
            overflow,
            observationFailure,
            observationStartAttempted,
            observationWindowClosed: closed,
          })
        );
      });
    },
  };
}

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

it.each([
  undefined,
  'flex size-6 shrink-0 items-center justify-center object-cover text-xs font-medium text-white',
])(
  'preserves avatar dimensions and its accessible name through delayed success with class %s',
  async (className) => {
    const diagnostic = createLoadingDiagnostic(className ? 'small' : 'large');
    try {
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
      await session.send('Network.setCacheDisabled', { cacheDisabled: true });
      let receive: (event: LoadingDiagnosticPause) => void = () => {};
      const paused = new Promise<string>((resolve) => {
        receive = (event) => {
          diagnostic.paused(event);
          resolve(event.requestId);
        };
      });
      session.on('Fetch.requestPaused', receive);
      await session.send('Fetch.enable', { patterns: [{ urlPattern: '*avatar-delayed*' }] });
      try {
        diagnostic.start();
        const view = render(
          <ProfilePictureImage
            profile={{
              id: 'ada',
              displayName: 'Ada Lovelace',
              picture: {
                id: 'delayed',
                url: `/avatar-delayed?size=${className ? 'small' : 'large'}`,
              },
            }}
            className={className}
          />
        );
        diagnostic.snapshot('render-return');
        const pending = screen.getByRole('img');
        const before = pending.getBoundingClientRect();
        const borderWidth = getComputedStyle(pending).borderWidth;
        expect(before.width).toBe(className ? 24 : 112);
        expect(before.width).toBe(before.height);
        expect(Number.parseFloat(getComputedStyle(pending).borderRadius)).toBeGreaterThanOrEqual(
          before.width / 2
        );
        const spinner = pending.querySelector('svg');
        if (!spinner) throw new Error('Missing loading indicator');
        expect(getComputedStyle(spinner).animationName).toBe('spin');
        await session.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await expect.poll(() => getComputedStyle(spinner).animationName).toBe('none');
        expect(screen.getByRole('status').textContent).toBe('Loading profile picture');
        const { frameTree } = await session.send('Page.getFrameTree');
        const frames = [frameTree, ...(frameTree.childFrames ?? [])];
        diagnostic.frames(frames);
        const accessibility = await Promise.all(
          frames.map(({ frame }) =>
            session.send('Accessibility.getFullAXTree', { frameId: frame.id })
          )
        );
        expect(
          accessibility.some(({ nodes }) =>
            nodes.some((node) => !node.ignored && node.role?.value === 'status')
          )
        ).toBe(true);
        diagnostic.snapshot('before-alt-lookup');
        expect(
          screen.getByAltText("Ada Lovelace's profile picture").getAttribute('aria-hidden')
        ).toBe('true');
        const attempt = screen.getByAltText<HTMLImageElement>("Ada Lovelace's profile picture");
        diagnostic.snapshot('before-fulfill');
        await session.send('Fetch.fulfillRequest', {
          requestId: await paused,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
          body,
        });
        await expect
          .element(page.getByRole('img', { name: "Ada Lovelace's profile picture" }))
          .toBeVisible();
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
        vi.useFakeTimers();
        view.rerender(
          <ProfilePictureImage
            profile={{
              id: 'ada',
              displayName: 'Ada Lovelace',
              picture: { id: 'failure', url: '/avatar-delayed?failure' },
            }}
            className={className}
          />
        );
        await act(async () => vi.advanceTimersByTimeAsync(15000));
        expect(screen.getByRole('img').textContent).toBe('AL');
        expect(screen.getByRole('img').getBoundingClientRect().width).toBe(before.width);
        diagnostic.passed();
      } catch (error) {
        diagnostic.failed();
        throw error;
      } finally {
        diagnostic.finish();
        session.off('Fetch.requestPaused', receive);
        await session.send('Fetch.disable');
        await session.send('Network.setCacheDisabled', { cacheDisabled: false });
      }
    } catch (error) {
      diagnostic.failed();
      throw error;
    } finally {
      diagnostic.finish();
    }
  }
);
