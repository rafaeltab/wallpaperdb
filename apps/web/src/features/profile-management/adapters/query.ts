import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { Profile } from '@/lib/api/user';
import type { ProfileCommandAvailability } from '../index';

export const ownerProfileQueryRoot = ['profile'] as const;
export function profileQueryKey(profileId: string) {
  return [...ownerProfileQueryRoot, profileId] as const;
}
interface ProfileRequest<Command> {
  command: Command;
  execute: () => Promise<Profile>;
  publish: (profile: Profile) => void;
  onSuccess: (profile: Profile) => void;
  onError: (error: Error) => void;
}
export function useOwnerProfileMutation<Command>(
  profileId: string,
  execute: (command: Command) => Promise<Profile>,
  feedback: {
    onSuccess?: (profile: Profile, command: Command) => void;
    onError?: (error: Error) => void;
  } = {}
) {
  const client = useQueryClient();
  const key = profileQueryKey(profileId);
  const refreshing = useIsFetching({ queryKey: key }) > 0;
  const writing = useIsMutating({ mutationKey: key }) > 0;
  const lifecycle = useMemo(() => ({ client, profileId, generation: 0 }), [client, profileId]);
  useEffect(() => {
    lifecycle.generation++;
    return () => {
      lifecycle.generation++;
    };
  }, [lifecycle]);
  const availability = useMemo<ProfileCommandAvailability>(() => {
    const key = profileQueryKey(profileId);
    const isBusy = () =>
      client.isFetching({ queryKey: key }) > 0 || client.isMutating({ mutationKey: key }) > 0;
    return {
      isBusy,
      subscribe(listener) {
        let previous = isBusy();
        const changed = () => {
          const next = isBusy();
          if (next === previous) return;
          previous = next;
          listener();
        };
        const queries = client.getQueryCache().subscribe(changed);
        const mutations = client.getMutationCache().subscribe(changed);
        return () => {
          queries();
          mutations();
        };
      },
    };
  }, [client, profileId]);
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: (request: ProfileRequest<Command>) => request.execute(),
    // Shared publication survives navigation; request-bound UI feedback does not.
    onSuccess: (updated, request) => {
      request.publish(updated);
      request.onSuccess(updated);
    },
    onError: (error, request) => request.onError(error),
  });
  function capture(command: Command): ProfileRequest<Command> {
    const ownerQuery = client.getQueryCache().find({ queryKey: key, exact: true });
    const generation = lifecycle.generation;
    const ownsCache = () =>
      Boolean(
        ownerQuery && client.getQueryCache().find({ queryKey: key, exact: true }) === ownerQuery
      );
    const current = () => lifecycle.generation === generation && ownsCache();
    return {
      command,
      execute: () => execute(command),
      publish(updated) {
        if (ownsCache()) client.setQueryData(key, updated);
      },
      onSuccess(updated) {
        if (current()) feedback.onSuccess?.(updated, command);
      },
      onError(error) {
        if (current()) feedback.onError?.(error);
      },
    };
  }
  return {
    mutation: {
      ...mutation,
      variables: mutation.variables?.command,
      mutate(command: Command) {
        if (!availability.isBusy()) mutation.mutate(capture(command));
      },
      mutateAsync(command: Command) {
        if (availability.isBusy()) return Promise.reject(new Error('Profile is busy'));
        // TanStack marks pending synchronously, before React receives notifications.
        return mutation.mutateAsync(capture(command));
      },
    },
    async refresh() {
      if (availability.isBusy()) throw new Error('Profile is busy');
      const ownerQuery = client.getQueryCache().find({ queryKey: key, exact: true });
      await client.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
      const updated = client.getQueryData<Profile>(key);
      if (!updated || client.getQueryCache().find({ queryKey: key, exact: true }) !== ownerQuery)
        throw new Error('Profile unavailable');
      return updated;
    },
    availability,
    refreshing,
    writing,
  };
}
