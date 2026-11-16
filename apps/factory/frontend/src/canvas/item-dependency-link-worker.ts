import { computeItemDependencyLinks } from './item-dependency-links';
import type {
  ItemDependencyLinkRequest,
  ItemDependencyLinkResponse,
} from './item-dependency-link-executor';

self.addEventListener('message', (event: MessageEvent<ItemDependencyLinkRequest>) => {
  const { id, input } = event.data;
  let response: ItemDependencyLinkResponse;
  try {
    response = { id, links: computeItemDependencyLinks(input) };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
