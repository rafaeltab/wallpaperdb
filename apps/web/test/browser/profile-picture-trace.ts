import { vi } from 'vitest';
import type { cdp } from 'vitest/browser';

// Temporary #443 diagnostics. Observes the existing assertions without settling requests.
export function profilePictureTrace(session: ReturnType<typeof cdp>, className?: string) {
  const now = performance.now.bind(performance);
  const start = now();
  const events: unknown[] = [];
  const identities = new WeakMap<HTMLImageElement, number>();
  let nextIdentity = 0;
  const record = (kind: string, detail?: unknown) => {
    events.push({ ms: now() - start, kind, detail });
  };
  const imageState = (image: HTMLImageElement) => {
    let identity = identities.get(image);
    if (identity === undefined) {
      identity = ++nextIdentity;
      identities.set(image, identity);
    }
    return { identity, src: image.getAttribute('src'), complete: image.complete,
      naturalWidth: image.naturalWidth, connected: image.isConnected,
      hidden: image.getAttribute('aria-hidden') };
  };
  const snapshot = (kind: string) => record(kind, {
    images: [...document.querySelectorAll('img')].map(imageState),
    status: document.querySelector('output')?.textContent,
    wrapper: document.querySelector('[role="img"]')?.outerHTML,
  });
  const imageEvent = (event: Event) => {
    if (event.target instanceof HTMLImageElement) record(event.type, imageState(event.target));
  };
  document.addEventListener('error', imageEvent, true);
  document.addEventListener('load', imageEvent, true);
  const observer = new MutationObserver(() => snapshot('dom-mutation'));
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['src', 'class', 'aria-hidden'] });
  const realDecode = HTMLImageElement.prototype.decode;
  const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function (this: HTMLImageElement) {
    record('decode-start', imageState(this));
    const result = realDecode.call(this);
    void result.then(() => record('decode-resolved', imageState(this)),
      (error: unknown) => record('decode-rejected', { image: imageState(this), error: String(error) }));
    return result;
  });
  const requests = new Set<string>();
  const request = (event: { requestId: string; request: { url: string }; timestamp: number }) => {
    if (event.request.url.includes('avatar-delayed')) {
      requests.add(event.requestId);
      record('Network.requestWillBeSent', { requestId: event.requestId,
        url: event.request.url, timestamp: event.timestamp });
    }
  };
  const failed = (event: { requestId: string; errorText: string }) => {
    if (requests.has(event.requestId)) record('Network.loadingFailed', event);
  };
  const response = (event: { requestId: string; response: { status: number; url: string } }) => {
    if (requests.has(event.requestId)) record('Network.responseReceived', {
      requestId: event.requestId, status: event.response.status, url: event.response.url,
    });
  };
  session.on('Network.requestWillBeSent', request);
  session.on('Network.loadingFailed', failed);
  session.on('Network.responseReceived', response);
  return {
    record, snapshot,
    stop() {
      snapshot('trace-end');
      observer.disconnect();
      decode.mockRestore();
      document.removeEventListener('error', imageEvent, true);
      document.removeEventListener('load', imageEvent, true);
      session.off('Network.requestWillBeSent', request);
      session.off('Network.loadingFailed', failed);
      session.off('Network.responseReceived', response);
      console.log('[DEBUG-443]', JSON.stringify({ className, events }));
    },
  };
}
