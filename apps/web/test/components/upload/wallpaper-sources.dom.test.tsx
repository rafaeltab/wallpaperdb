import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { WallpaperSources } from '@/components/upload/wallpaper-sources';
import { browserSourceBatchApi, ownedSources } from '@/features/wallpaper-creation/adapters/http';
vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: 'owner' }) }));
vi.mock('@/features/wallpaper-creation/adapters/http', () => ({ browserSourceBatchApi: vi.fn(), ownedSources: vi.fn(), downloadSourceOriginal: vi.fn() }));
afterEach(cleanup);
it('shows independent initial outcomes and retries the failed file while keeping the saved Wallpaper', async () => {
  const wallpaper={wallpaperId:'saved-one',assetId:'asset-one',sourceId:null,state:'awaiting-source' as const,createdAt:'now'};
  let revision=0, attempts=0;
  const uploads:string[]=[];
  vi.mocked(ownedSources).mockImplementation(async()=>({sourceSetRevision:String(revision),sources:[],hasPendingCandidates:false,candidates:[]}));
  vi.mocked(browserSourceBatchApi).mockReturnValue({identifier:()=>crypto.randomUUID(),begin:async()=>wallpaper,wallpaper:async()=>({...wallpaper,state:'published',sourceId:'source-one'}),list:async()=>({sourceSetRevision:String(revision),sources:revision?[{sourceId:'source-one'}]:[],hasPendingCandidates:false,candidates:[]}),create:async(_asset,key,expected)=>({candidateId:key,status:'awaiting-bytes',expectedSourceSetRevision:expected}),status:async()=>{throw new Error('Must create fresh rejected candidate');},upload:async(_asset,id,file)=>{uploads.push(file.name);return {candidateId:id,status:file.name==='bad.png'&&++attempts===1?'rejected':'ready',expectedSourceSetRevision:String(revision)};},expectSource:async()=>{},accept:async(_asset,id,expected)=>{revision++;return {candidateId:id,status:'accepted',sourceId:`source-${revision}`,expectedSourceSetRevision:expected};},cancel:async()=>{},wait:async()=>{}});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=render(<QueryClientProvider client={client}><WallpaperSources /></QueryClientProvider>);
  const user=userEvent.setup();
  await user.upload(screen.getByLabelText('Choose initial Sources for one Wallpaper'),[new File(['bad'],'bad.png',{type:'image/png'}),new File(['good'],'good.png',{type:'image/png'})]);
  await screen.findByText('Retry bad.png');
  await waitFor(()=>expect(screen.getAllByTestId('source-upload-outcome')[1]).toHaveTextContent('Source accepted'));
  expect(screen.getByText('Saved Wallpaper: saved-one')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Retry bad.png'}));
  await waitFor(()=>expect(screen.queryByText('Retry bad.png')).not.toBeInTheDocument());
  expect(uploads).toEqual(['bad.png','good.png','bad.png']);
  view.unmount();client.clear();
});
it('resumes all retained pending files after the first publication wait expires even when the 16-file input is disabled',async()=>{
 let revision=0,publicationReady=false;const uploads:string[]=[];
 const wallpaper={wallpaperId:'delayed-publication',assetId:'asset',sourceId:null,state:'awaiting-source' as const,createdAt:'now'};
 const current=()=>publicationReady?{...wallpaper,state:'published' as const,sourceId:'first'}:wallpaper;
 vi.mocked(ownedSources).mockImplementation(async()=>({sourceSetRevision:String(revision),sources:revision?[{sourceId:'first'}]:[],hasPendingCandidates:false,candidates:[]}));
 vi.mocked(browserSourceBatchApi).mockReturnValue({identifier:()=>crypto.randomUUID(),begin:async()=>current(),wallpaper:async()=>current(),list:async()=>({sourceSetRevision:String(revision),sources:revision?[{sourceId:'first'}]:[],hasPendingCandidates:false,candidates:[]}),create:async(_asset,key,expected)=>({candidateId:key,status:'awaiting-bytes',expectedSourceSetRevision:expected}),status:async()=>{throw new Error('Accepted files must not be polled or uploaded again');},upload:async(_asset,id,file)=>{uploads.push(file.name);return {candidateId:id,status:'ready',expectedSourceSetRevision:String(revision)};},expectSource:async()=>{},accept:async(_asset,id,expected)=>{revision++;return {candidateId:id,status:'accepted',sourceId:`source-${revision}`,expectedSourceSetRevision:expected};},cancel:async()=>{},wait:async()=>{}});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={client}><WallpaperSources /></QueryClientProvider>);
 const user=userEvent.setup();const input=screen.getByLabelText('Choose initial Sources for one Wallpaper');
 await user.upload(input,Array.from({length:16},(_,n)=>new File(['image'],`${n}.png`,{type:'image/png'})));
 await waitFor(()=>expect(screen.getAllByTestId('source-upload-outcome')[0]).toHaveTextContent('Source accepted'));
 expect(uploads).toEqual(['0.png']);expect(input).toBeDisabled();
 publicationReady=true;
 await user.click(await screen.findByRole('button',{name:'Resume remaining Sources'}));
 await waitFor(()=>expect(uploads).toHaveLength(16));expect(new Set(uploads).size).toBe(16);
 await waitFor(()=>expect(screen.getAllByTestId('source-upload-outcome').every(row=>row.textContent?.includes('Source accepted'))).toBe(true));
 view.unmount();client.clear();
});
it('replaces the discovery page and resumes an older inspecting candidate through its exact status and bytes',async()=>{
 const pending={candidateId:'older-inspecting',status:'inspecting',expectedSourceSetRevision:'1'};
 const latest={sourceSetRevision:'1',sources:[{sourceId:'accepted-first'}],candidates:[{candidateId:'latest-cancelled',status:'cancelled',expectedSourceSetRevision:'1'}],hasPendingCandidates:true,nextCandidateCursor:'7:latest-cancelled'};
 vi.mocked(ownedSources).mockImplementation(async(_asset,_signal,cursor)=>cursor?{...latest,candidates:[pending],nextCandidateCursor:undefined}:latest);
 const status=vi.fn(async()=>pending),upload=vi.fn(async()=>({...pending,status:'ready'}));
 const wallpaper={wallpaperId:'saved',assetId:'asset',sourceId:'accepted-first',state:'published' as const,createdAt:'now'};
 vi.mocked(browserSourceBatchApi).mockReturnValue({identifier:()=>crypto.randomUUID(),begin:async()=>{throw new Error('Retain saved Wallpaper');},wallpaper:async()=>wallpaper,list:async()=>latest,create:async()=>{throw new Error('Retain older candidate');},status,upload,expectSource:async()=>{throw new Error('Preserve first publication');},accept:async()=>({...pending,status:'accepted',sourceId:'accepted-second'}),cancel:async()=>{throw new Error('Do not cancel retained inspection');},wait:async()=>{}});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={client}><WallpaperSources wallpaperId="saved" assetId="asset" /></QueryClientProvider>);
 const user=userEvent.setup();await screen.findByText(/latest-cancelled: cancelled/);
 await user.click(screen.getByRole('button',{name:'Older Source outcomes'}));
 await screen.findByText(/older-inspecting: inspecting/);expect(screen.queryByText(/latest-cancelled: cancelled/)).not.toBeInTheDocument();
 const file=new File(['same bytes'],'retained.png',{type:'image/png'});
 await user.upload(screen.getByLabelText('Retry or resume this Source with its image'),file);
 await waitFor(()=>expect(screen.getByTestId('source-upload-outcome')).toHaveTextContent('Source accepted'));
 expect(status).toHaveBeenCalledWith('asset','older-inspecting',expect.any(AbortSignal));expect(upload).toHaveBeenCalledWith('asset','older-inspecting',file,expect.any(AbortSignal));
 expect(vi.mocked(ownedSources).mock.calls.some(call=>call[2]==='7:latest-cancelled')).toBe(true);
 view.unmount();client.clear();
});

it('keeps the accepted predecessor visible on replacement failure and switches the owner list after retry succeeds', async () => {
  const wallpaper = { wallpaperId: 'same-wallpaper', assetId: 'same-asset', sourceId: 'first', state: 'published' as const, createdAt: 'now' };
  let replaced = false, failUpload = true;
  const list = async () => ({ sourceSetRevision: replaced ? '2' : '1', sources: [{ sourceId: replaced ? 'new-source' : 'old-source', facts: { width: 100, height: 100 } }], hasPendingCandidates: false, candidates: [] });
  vi.mocked(ownedSources).mockImplementation(list);
  const candidate = { candidateId: 'saved-replacement', expectedSourceSetRevision: '1', operation: 'replace-one' as const, targetSourceId: 'old-source', status: 'awaiting-bytes' };
  vi.mocked(browserSourceBatchApi).mockReturnValue({
    identifier: () => crypto.randomUUID(), begin: async () => wallpaper, wallpaper: async () => wallpaper, list,
    create: async (_asset, _key, _revision, _signal, mutation) => { expect(mutation).toEqual({ operation: 'replace-one', targetSourceId: 'old-source' }); return candidate; },
    status: async () => candidate,
    upload: async () => { if (failUpload) { failUpload = false; throw new Error('Storage unavailable. Retry.'); } return { ...candidate, status: 'ready' }; },
    expectSource: async () => { throw new Error('Keep original Wallpaper publication'); },
    accept: async (_asset, _id, _revision, _correlation, _signal, mutation) => { expect(mutation).toEqual({ operation: 'replace-one', targetSourceId: 'old-source' }); replaced = true; return { ...candidate, status: 'accepted', sourceId: 'new-source' }; },
    cancel: async () => {}, wait: async () => {},
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><WallpaperSources wallpaperId="same-wallpaper" assetId="same-asset" /></QueryClientProvider>);
  const user = userEvent.setup();
  const replacement = await screen.findByLabelText('Replace Source old-source');
  await user.upload(replacement, new File(['new bytes'], 'replacement.png', { type: 'image/png' }));
  await screen.findByRole('button', { name: 'Retry replacement.png' });
  expect(screen.getByLabelText('Replace Source old-source')).toBeInTheDocument();
  expect(screen.getByText(/Its accepted image stays active until replacement succeeds/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry replacement.png' }));
  await screen.findByLabelText('Replace Source new-source');
  expect(screen.queryByLabelText('Replace Source old-source')).not.toBeInTheDocument();
  expect(screen.getByTestId('source-upload-outcome')).toHaveTextContent('Source accepted');
  view.unmount(); client.clear();
});
