import { createItemDependencyLinkRouter, type ItemDependencyLink } from './item-dependency-links';
import type {
  ItemDependencyLinkRequest,
  ItemDependencyLinkResponse,
} from './item-dependency-link-executor';

const route = createItemDependencyLinkRouter();

self.addEventListener('message', (event: MessageEvent<ItemDependencyLinkRequest>) => {
  const { id, input } = event.data;
  let response: ItemDependencyLinkResponse;
  try {
    const links: ItemDependencyLink[] = [];
    let progress: ItemDependencyLink[] = [];
    let publishedAt: number | undefined;
    for (const link of route(input)) {
      links.push(link);
      progress.push(link);
      const now = performance.now();
      // The first finished link is immediate; later messages carry bounded
      // append-only batches rather than repeatedly cloning the whole scene.
      if (publishedAt === undefined || now - publishedAt >= 16) {
        self.postMessage({ id, progress } satisfies ItemDependencyLinkResponse);
        progress = [];
        publishedAt = now;
      }
    }
    if (progress.length) self.postMessage({ id, progress } satisfies ItemDependencyLinkResponse);
    response = { id, links };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
