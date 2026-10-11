import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it } from 'vitest';
import {
  profileQueryKey,
  useOwnerProfileMutation,
} from '@/features/profile-management/adapters/query';
import type { Profile } from '@/lib/api/user';
const initial: Profile = {
  id: 'owner',
  displayName: 'Ada',
  handle: 'ada',
  biographyMarkdown: '',
  pictureAssetId: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
};
it('updates the original cache after navigation but protects a recreated session', async () => {
  for (const replaceSession of [false, true]) {
    const client = new QueryClient();
    client.setQueryData(profileQueryKey(initial.id), initial);
    let complete: ((profile: Profile) => void) | undefined;
    const { result, unmount } = renderHook(
      () =>
        useOwnerProfileMutation(
          initial.id,
          () =>
            new Promise<Profile>((resolve) => {
              complete = resolve;
            })
        ),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );
    let request: Promise<Profile> | undefined;
    act(() => {
      request = result.current.mutation.mutateAsync('command');
      if (replaceSession) {
        client.removeQueries({ queryKey: profileQueryKey(initial.id) });
        client.setQueryData(profileQueryKey(initial.id), initial);
      }
    });
    await waitFor(() => expect(complete).toBeDefined());
    unmount();
    complete?.({ ...initial, version: 2 });
    await request;
    expect(client.getQueryData<Profile>(profileQueryKey(initial.id))?.version).toBe(
      replaceSession ? 1 : 2
    );
  }
});
it('checks shared writes synchronously at command time', async () => {
  const client = new QueryClient();
  const { result } = renderHook(
    () => useOwnerProfileMutation(initial.id, () => new Promise<Profile>(() => {})),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  expect(result.current.availability.isBusy()).toBe(false);
  act(() => {
    void result.current.mutation.mutateAsync('command');
    expect(result.current.availability.isBusy()).toBe(true);
  });
});

it('rejects a competing command at the public boundary before React receives notifications', async () => {
  const client = new QueryClient();
  client.setQueryData(profileQueryKey(initial.id), initial);
  const commands: string[] = [];
  let complete!: (profile: Profile) => void;
  const { result } = renderHook(
    () => ({
      field: useOwnerProfileMutation(initial.id, (command: string) => {
        commands.push(command);
        return new Promise<Profile>((resolve) => {
          complete = resolve;
        });
      }),
      picture: useOwnerProfileMutation(initial.id, async (command: string) => {
        commands.push(command);
        return initial;
      }),
    }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  let accepted!: Promise<Profile>;
  let rejected!: Promise<Profile>;
  act(() => {
    accepted = result.current.field.mutation.mutateAsync('field');
    rejected = result.current.picture.mutation.mutateAsync('picture');
    result.current.picture.mutation.mutate('alias');
  });
  await expect(rejected).rejects.toThrow('Profile is busy');
  await waitFor(() => expect(complete).toBeDefined());
  expect(commands).toEqual(['field']);
  complete({ ...initial, version: 2 });
  await accepted;
  await act(() => result.current.picture.mutation.mutateAsync('picture'));
  expect(commands).toEqual(['field', 'picture']);
});

it('coordinates refreshes with writes and rejects consecutive refreshes synchronously', async () => {
  const client = new QueryClient();
  const key = profileQueryKey(initial.id);
  let complete!: (profile: Profile) => void;
  const { result } = renderHook(
    () => {
      useQuery({
        queryKey: key,
        queryFn: () =>
          new Promise<Profile>((resolve) => {
            complete = resolve;
          }),
        initialData: initial,
        staleTime: Infinity,
      });
      return useOwnerProfileMutation(initial.id, async () => initial);
    },
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  let refresh!: Promise<Profile>;
  let competing!: Promise<Profile>;
  act(() => {
    refresh = result.current.refresh();
    competing = result.current.refresh();
    result.current.mutation.mutate('blocked');
  });
  await expect(competing).rejects.toThrow('Profile is busy');
  expect(client.isMutating()).toBe(0);
  await waitFor(() => expect(complete).toBeDefined());
  complete({ ...initial, version: 2 });
  await expect(refresh).resolves.toMatchObject({ version: 2 });
});

it.each([
  false,
  true,
])('captures request execution and cache ownership across a changed context, owner change=%s', async (changeOwner) => {
  const client = new QueryClient();
  const other = { ...initial, id: 'other' };
  client.setQueryData(profileQueryKey(initial.id), initial);
  client.setQueryData(profileQueryKey(other.id), other);
  const owners: string[] = [];
  let complete!: (profile: Profile) => void;
  const { result, rerender } = renderHook(
    ({ owner, environment }) =>
      useOwnerProfileMutation(owner.id, () => {
        owners.push(environment);
        return new Promise<Profile>((resolve) => {
          complete = resolve;
        });
      }),
    {
      initialProps: { owner: initial, environment: 'original' },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
  let request!: Promise<Profile>;
  act(() => {
    request = result.current.mutation.mutateAsync('accepted');
  });
  rerender({ owner: changeOwner ? other : initial, environment: 'replacement' });
  await waitFor(() => expect(complete).toBeDefined());
  expect(owners).toEqual(['original']);
  complete({ ...initial, version: 2 });
  await request;
  expect(client.getQueryData<Profile>(profileQueryKey(initial.id))?.version).toBe(2);
  expect(client.getQueryData<Profile>(profileQueryKey(other.id))?.version).toBe(1);
});

it('publishes accepted responses after StrictMode cleanup without late component feedback', async () => {
  const client = new QueryClient();
  client.setQueryData(profileQueryKey(initial.id), initial);
  const notices: string[] = [];
  let complete!: (profile: Profile) => void;
  const { result, unmount } = renderHook(
    () =>
      useOwnerProfileMutation(
        initial.id,
        () =>
          new Promise<Profile>((resolve) => {
            complete = resolve;
          }),
        {
          onSuccess: () => {
            notices.push('saved');
          },
        }
      ),
    {
      wrapper: ({ children }) => (
        <StrictMode>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </StrictMode>
      ),
    }
  );
  let request!: Promise<Profile>;
  act(() => {
    request = result.current.mutation.mutateAsync('accepted');
  });
  await waitFor(() => expect(complete).toBeDefined());
  unmount();
  complete({ ...initial, version: 2 });
  await request;
  expect(client.getQueryData<Profile>(profileQueryKey(initial.id))?.version).toBe(2);
  expect(notices).toEqual([]);
});
