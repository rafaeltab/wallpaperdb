import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Profile } from '@/lib/api/user';

export const ownerProfileQueryRoot = ['profile'] as const;
export function profileQueryKey(profileId: string) {
  return [...ownerProfileQueryRoot, profileId] as const;
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
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: ({ command }: { command: Command; ownerQuery: unknown }) => execute(command),
    onSuccess: (updated, { command, ownerQuery }) => {
      if (ownerQuery && client.getQueryCache().find({ queryKey: key, exact: true }) === ownerQuery)
        client.setQueryData(key, updated);
      feedback.onSuccess?.(updated, command);
    },
    onError: (error) => feedback.onError?.(error),
  });
  return {
    mutation: {
      ...mutation,
      variables: mutation.variables?.command,
      mutate(command: Command) {
        mutation.mutate({
          command,
          ownerQuery: client.getQueryCache().find({ queryKey: key, exact: true }),
        });
      },
      mutateAsync(command: Command) {
        // Capture before TanStack's asynchronous mutation callbacks can cross a session change.
        return mutation.mutateAsync({
          command,
          ownerQuery: client.getQueryCache().find({ queryKey: key, exact: true }),
        });
      },
    },
    refreshing,
    writing,
    busy: refreshing || writing,
    isBusy: () =>
      client.isFetching({ queryKey: key }) > 0 || client.isMutating({ mutationKey: key }) > 0,
  };
}
