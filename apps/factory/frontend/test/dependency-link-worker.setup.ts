import { vi } from 'vitest';
import { computeItemDependencyLinks } from '../src/canvas/item-dependency-links';
import type { ItemDependencyLinkRequest } from '../src/canvas/item-dependency-link-executor';

// jsdom has no Web Workers. Production uses the bundled worker; lifecycle tests
// separately control completion, failure and disposal at the executor interface.
class DependencyLinkWorker extends EventTarget {
  postMessage({ id, input }: ItemDependencyLinkRequest) {
    this.dispatchEvent(
      new MessageEvent('message', { data: { id, links: computeItemDependencyLinks(input) } })
    );
  }
  terminate() {}
}
vi.stubGlobal('Worker', DependencyLinkWorker);
