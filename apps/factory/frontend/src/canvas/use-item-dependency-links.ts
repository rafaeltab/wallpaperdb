import { useEffect, useRef, useState } from 'react';
import {
  createItemDependencyLinkExecutor,
  type ItemDependencyLinkExecutor,
} from './item-dependency-link-executor';
import type { ItemDependencyLink, ItemDependencyLinkInput } from './item-dependency-links';

type Completed = { input: ItemDependencyLinkInput; links: ItemDependencyLink[] };

export function useItemDependencyLinks(
  input: ItemDependencyLinkInput,
  createExecutor: () => ItemDependencyLinkExecutor = createItemDependencyLinkExecutor
) {
  const executor = useRef<ItemDependencyLinkExecutor | undefined>(undefined);
  const creationFailure = useRef<Error | undefined>(undefined);
  const [completed, setCompleted] = useState<Completed>();
  const [failure, setFailure] = useState<{ input: ItemDependencyLinkInput; error: Error }>();
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: A replacement executor must receive the current input even when geometry is unchanged.
  useEffect(() => {
    let active = true;
    if (creationFailure.current) {
      setFailure({ input, error: creationFailure.current });
      return;
    }
    executor.current?.compute(input).then(
      (links) => {
        if (active) {
          setCompleted({ input, links });
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
    links: completed?.links ?? [],
    input: completed?.input,
    pending: completed?.input !== input && failure?.input !== input,
    error: failure?.input === input ? failure.error : undefined,
  };
}
