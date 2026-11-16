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
    // The complete result includes the final unfinished batch. Publishing it
    // twice would add a redundant main-thread render just before completion.
    response = { id, links };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
