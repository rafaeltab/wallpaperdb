import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { ItemDependencyLinkResponse } from '../src/canvas/item-dependency-link-executor';
import type {
  ItemDependencyLink,
  ItemDependencyLinkInput,
} from '../src/canvas/item-dependency-links';

it('posts the first finished link and the exact final scene without a redundant tail update', async () => {
  const fixtures: { name: string; input: ItemDependencyLinkInput; links: ItemDependencyLink[] }[] =
    JSON.parse(
      readFileSync(new URL('./fixtures/canvas/item-dependency-links.json', import.meta.url), 'utf8')
    );
  const fixture = fixtures.find(({ name }) => name === 'shared-header-ports');
  if (!fixture) throw new Error('Missing shared terminal fixture');
  const messages: ItemDependencyLinkResponse[] = [];
  const scope = Object.assign(new EventTarget(), {
    postMessage(response: ItemDependencyLinkResponse) {
      messages.push(structuredClone(response));
    },
  });
  vi.stubGlobal('self', scope);
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    await import('../src/canvas/item-dependency-link-worker');
    scope.dispatchEvent(new MessageEvent('message', { data: { id: 7, input: fixture.input } }));
    const batches = messages.flatMap((message) =>
      'progress' in message ? [message.progress] : []
    );
    expect(batches).toEqual([[fixture.links[0]]]);
    expect(messages).toHaveLength(2);
    expect(messages.at(-1)).toEqual({ id: 7, links: fixture.links });
    expect(messages.every(({ id }) => id === 7)).toBe(true);
    scope.dispatchEvent(
      new MessageEvent('message', {
        data: { id: 8, input: { ...fixture.input, edges: [] } },
      })
    );
    expect(messages.at(-1)).toEqual({ id: 8, links: [] });
  } finally {
    clock.mockRestore();
    vi.unstubAllGlobals();
  }
});
