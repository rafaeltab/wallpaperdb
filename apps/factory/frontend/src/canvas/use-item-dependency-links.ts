import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createItemDependencyLinkExecutor,
  type ItemDependencyLinkExecutor,
} from './item-dependency-link-executor';
import type { ItemDependencyLink, ItemDependencyLinkInput } from './item-dependency-links';

type Completed = {
  input: ItemDependencyLinkInput;
  links: ItemDependencyLink[];
  complete: boolean;
};

function sameLink(a: ItemDependencyLink, b: ItemDependencyLink) {
  return (
    a.key === b.key &&
    a.d === b.d &&
    a.color === b.color &&
    a.label === b.label &&
    a.failed === b.failed &&
    a.points.length === b.points.length &&
    a.points.every((point, index) => point.x === b.points[index].x && point.y === b.points[index].y)
  );
}

function reconcile(previous: ItemDependencyLink[], next: ItemDependencyLink[]) {
  const byKey = new Map(previous.map((link) => [link.key, link]));
  return next.map((link) => {
    const before = byKey.get(link.key);
    return before && sameLink(before, link) ? before : link;
  });
}

/** Retain only visually valid old paths while the worker validates exact new routes. */
function retainVisibleLinks(previous: Completed | undefined, input: ItemDependencyLinkInput) {
  if (!previous) return [];
  const before = previous.input;
  const position = (node: ItemDependencyLinkInput['nodes'][number]) =>
    `${node.x}:${node.y}:${node.width}:${node.height}`;
  const oldPositions = new Set(before.nodes.map(position));
  const changed = input.nodes.filter((node) => !oldPositions.has(position(node)));
  const node = (value: ItemDependencyLinkInput, id: number) => value.nodes.find((n) => n.id === id);
  function sameEndpoint(id: number) {
    const a = node(before, id),
      b = node(input, id);
    return (
      a &&
      b &&
      position(a) === position(b) &&
      a.header === b.header &&
      a.stacked === b.stacked &&
      a.bottomPort?.x === b.bottomPort?.x &&
      a.bottomPort?.width === b.bottomPort?.width
    );
  }
  function fan(value: ItemDependencyLinkInput, id: number, direction: 'source' | 'target') {
    const endpoint = node(value, id);
    if (!endpoint) return '';
    return value.edges
      .filter((edge) => {
        const other = node(value, edge[direction]);
        return other && position(endpoint) === position(other);
      })
      .map((edge) => `${edge.source}-${edge.target}`)
      .join(',');
  }
  return previous.links.filter((link) => {
    const index = input.edges.findIndex(
      (edge) => edge.source === link.source && edge.target === link.target
    );
    const oldIndex = before.edges.findIndex(
      (edge) => edge.source === link.source && edge.target === link.target
    );
    if (
      index < 0 ||
      index !== oldIndex ||
      link.failed ||
      !sameEndpoint(link.source) ||
      !sameEndpoint(link.target) ||
      fan(before, link.source, 'source') !== fan(input, link.source, 'source') ||
      fan(before, link.target, 'target') !== fan(input, link.target, 'target')
    )
      return false;
    if (
      link.points.some(
        (point) =>
          point.x < 0 || point.y < 0 || point.x > input.width + 64 || point.y > input.height + 64
      )
    )
      return false;
    return !changed.some((rect) =>
      link.points.some((point, index) => {
        if (!index) return false;
        const previousPoint = link.points[index - 1];
        return point.x === previousPoint.x
          ? point.x >= rect.x - 12 &&
              point.x <= rect.x + rect.width + 12 &&
              Math.max(point.y, previousPoint.y) >= rect.y - 12 &&
              Math.min(point.y, previousPoint.y) <= rect.y + rect.height + 12
          : point.y >= rect.y - 12 &&
              point.y <= rect.y + rect.height + 12 &&
              Math.max(point.x, previousPoint.x) >= rect.x - 12 &&
              Math.min(point.x, previousPoint.x) <= rect.x + rect.width + 12;
      })
    );
  });
}

export function useItemDependencyLinks(
  input: ItemDependencyLinkInput,
  createExecutor: () => ItemDependencyLinkExecutor = createItemDependencyLinkExecutor
) {
  const executor = useRef<ItemDependencyLinkExecutor | undefined>(undefined);
  const creationFailure = useRef<Error | undefined>(undefined);
  const [completed, setCompleted] = useState<Completed>();
  const [failure, setFailure] = useState<{ input: ItemDependencyLinkInput; error: Error }>();
  const visible = useMemo(
    () => (completed?.input === input ? completed.links : retainVisibleLinks(completed, input)),
    [completed, input]
  );
  useEffect(() => {
    try {
      creationFailure.current = undefined;
      executor.current = createExecutor();
    } catch (error) {
      creationFailure.current = error instanceof Error ? error : new Error(String(error));
    }
    return () => {
      executor.current?.dispose();
      executor.current = undefined;
    };
  }, [createExecutor]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Capture visible paths only when input or executor changes; a progress update must not restart routing.
  useEffect(() => {
    let active = true;
    // Capture the current valid paths once; progress deltas replace matching keys.
    let links = visible;
    if (creationFailure.current) {
      setFailure({ input, error: creationFailure.current });
      return;
    }
    executor.current
      ?.compute(input, (delta) => {
        if (active) {
          const byKey = new Map(links.map((link) => [link.key, link]));
          for (const link of reconcile(links, delta)) byKey.set(link.key, link);
          links = input.edges.flatMap((edge) => {
            const link = byKey.get(`${edge.source}-${edge.target}`);
            return link ? [link] : [];
          });
          setCompleted({ input, links, complete: false });
        }
      })
      .then(
        (result) => {
          if (active) {
            setCompleted({ input, links: reconcile(links, result), complete: true });
            setFailure(undefined);
          }
        },
        (error: unknown) => {
          if (active)
            setFailure({ input, error: error instanceof Error ? error : new Error(String(error)) });
        }
      );
    return () => {
      active = false;
    };
  }, [input, createExecutor]);
  return {
    links: visible,
    input: completed?.input,
    pending: !(completed?.input === input && completed.complete) && failure?.input !== input,
    error: failure?.input === input ? failure.error : undefined,
  };
}
