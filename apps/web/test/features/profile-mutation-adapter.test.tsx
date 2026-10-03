import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { profileQueryKey, useOwnerProfileMutation } from '@/features/profile-management/adapters/query';
import type { Profile } from '@/lib/api/user';
const initial:Profile={id:'owner',displayName:'Ada',handle:'ada',biographyMarkdown:'',pictureAssetId:null,version:1,createdAt:'',updatedAt:''};
it('updates the original cache after navigation but protects a recreated session', async () => {
  for(const replaceSession of [false,true]) {
    const client=new QueryClient();client.setQueryData(profileQueryKey(initial.id),initial);
    let complete:((profile:Profile)=>void)|undefined;
    const {result,unmount}=renderHook(()=>useOwnerProfileMutation(initial.id,()=>new Promise<Profile>(resolve=>{complete=resolve;})),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
    let request:Promise<Profile>|undefined;
    act(()=>{
      request=result.current.mutation.mutateAsync('command');
      if(replaceSession){client.removeQueries({queryKey:profileQueryKey(initial.id)});client.setQueryData(profileQueryKey(initial.id),initial);}
    });
    await waitFor(()=>expect(complete).toBeDefined());
    unmount();
    complete?.({...initial,version:2});await request;
    expect(client.getQueryData<Profile>(profileQueryKey(initial.id))?.version).toBe(replaceSession?1:2);
  }
});
it('checks shared writes synchronously at command time', async () => {
  const client=new QueryClient();
  const {result}=renderHook(()=>useOwnerProfileMutation(initial.id,()=>new Promise<Profile>(()=>{})),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
  expect(result.current.isBusy()).toBe(false);
  act(()=>{void result.current.mutation.mutateAsync('command');expect(result.current.isBusy()).toBe(true);});
});
