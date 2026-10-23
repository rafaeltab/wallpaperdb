import { expect, it } from 'vitest';
import { createWallpaperSourceBatch, type SourceBatchApi } from '@/features/wallpaper-creation';

it('keeps one initial Wallpaper through independent rejection and retry without uploading successful Sources again', async () => {
  let revision = 0;
  const uploads: string[] = [], intents: string[] = [];
  const candidates = new Map<string, { candidateId: string; status: string; expectedSourceSetRevision: string; sourceId?: string }>();
  const wallpaper = { wallpaperId: 'wallpaper', assetId: 'asset', sourceId: null, state: 'awaiting-source' as const, createdAt: 'now' };
  let published = false, badAttempts = 0;
  const api: SourceBatchApi<string> = {identifier:()=>crypto.randomUUID(),
    begin: async () => wallpaper,
    wallpaper: async () => published ? { ...wallpaper, state: 'published', sourceId: 'source-good' } : wallpaper,
    list: async () => ({ sourceSetRevision: String(revision), sources: revision ? [{sourceId: 'source-good'}] : [], candidates: [] }),
    create: async (_asset, key, expected) => {
      const candidate = { candidateId: key, status: 'awaiting-bytes', expectedSourceSetRevision: expected };
      candidates.set(key, candidate); return candidate;
    },
    status: async (_asset, id) => { const candidate = candidates.get(id); if (!candidate) throw new Error('Unknown candidate'); return candidate; },
    upload: async (_asset, id, file) => {
      uploads.push(file);
      const candidate = { candidateId: id, expectedSourceSetRevision: String(revision), status: file === 'bad' && ++badAttempts === 1 ? 'rejected' : 'ready' };
      candidates.set(id, candidate); return candidate;
    },
    expectSource: async (_wallpaper, id) => { intents.push(id); },
    accept: async (_asset, id, expectedRevision) => {
      expect(expectedRevision).toBe(String(revision)); revision++; published = true;
      const candidate = { candidateId: id, expectedSourceSetRevision: expectedRevision, status: 'accepted', sourceId: `source-${id}` };
      candidates.set(id, candidate); return candidate;
    },
    cancel: async () => {},
    wait: async () => {},
  };
  const batch = createWallpaperSourceBatch(api, { creationKey: 'one-request' });
  batch.addFiles([{ value: 'bad', name: 'bad.png' }, { value: 'good', name: 'good.png' }]);
  await batch.run(new AbortController().signal);
  expect(batch.getSnapshot()).toMatchObject({ wallpaperId: 'wallpaper', rows: [{ status: 'failed' }, { status: 'accepted' }] });
  const bad = batch.getSnapshot().rows[0]; if (!bad) throw new Error('Missing failed row');
  batch.retry(bad.id); await batch.run(new AbortController().signal);
  expect(batch.getSnapshot().rows.map(row => row.status)).toEqual(['accepted', 'accepted']);
  expect(uploads).toEqual(['bad', 'good', 'bad']);
  expect(intents).toHaveLength(1);
});

it('pauses an ambiguous first acceptance and resolves it by status before admitting another initial file', async () => {
  const uploads: string[] = [], intents: string[] = [];
  const candidates = new Map<string, { candidateId: string; status: string; expectedSourceSetRevision: string; sourceId?: string }>();
  let revision = 0, loseReply = true;
  const wallpaper = { wallpaperId: 'retained', assetId: 'asset', sourceId: null, state: 'awaiting-source' as const, createdAt: 'now' };
  const api: SourceBatchApi<string> = {identifier:()=>crypto.randomUUID(),
    begin: async () => wallpaper,
    wallpaper: async () => revision ? { ...wallpaper, state: 'published', sourceId: 'first' } : wallpaper,
    list: async () => ({ sourceSetRevision: String(revision), sources: revision ? [{sourceId:'first'}] : [], candidates: [] }),
    create: async (_asset, key, expected) => { const candidate = {candidateId:key,status:'awaiting-bytes',expectedSourceSetRevision:expected}; candidates.set(key,candidate); return candidate; },
    status: async (_asset,id) => {const candidate=candidates.get(id);if(!candidate)throw new Error('Missing candidate');return candidate;},
    upload: async (_asset,id,file) => {uploads.push(file);const candidate={candidateId:id,status:'ready',expectedSourceSetRevision:String(revision)};candidates.set(id,candidate);return candidate;},
    expectSource: async (_wallpaper,id) => {intents.push(id);},
    accept: async (_asset,id,expected) => {revision++;const candidate={candidateId:id,status:'accepted',expectedSourceSetRevision:expected,sourceId:`source-${id}`};candidates.set(id,candidate);if(loseReply){loseReply=false;throw new Error('Acceptance response lost');}return candidate;},
    cancel: async () => {throw new Error('Do not cancel ambiguous accepted work');},
    wait: async () => {},
  };
  const batch=createWallpaperSourceBatch(api,{creationKey:'retained-key'});
  batch.addFiles([{value:'first',name:'first.png'},{value:'second',name:'second.png'}]);
  const pending=batch.run(new AbortController().signal);expect(batch.run(new AbortController().signal)).toBe(pending);await pending;
  expect(uploads).toEqual(['first']);
  await batch.run(new AbortController().signal); // Adding another action cannot silently supersede the unknown initial intent.
  expect(uploads).toEqual(['first']);
  const first=batch.getSnapshot().rows[0];if(!first)throw new Error('Missing first');
  batch.retry(first.id);await batch.run(new AbortController().signal);
  expect(uploads).toEqual(['first','second']);
  expect(intents).toHaveLength(1);
  expect(batch.getSnapshot().rows.map(row=>row.status)).toEqual(['accepted','accepted']);
  batch.retry(first.id);await batch.run(new AbortController().signal);expect(uploads).toEqual(['first','second']);
});
it('resumes a saved inspecting first candidate after reload without replacing it or uploading another file first', async()=>{
 const retained={candidateId:'retained-candidate',status:'inspecting',expectedSourceSetRevision:'0'};
 const wallpaper={wallpaperId:'saved-wallpaper',assetId:'asset',sourceId:null,state:'awaiting-source' as const,createdAt:'now'};
 let accepted=false;const intents:string[]=[];
 const api:SourceBatchApi<string>={identifier:()=>crypto.randomUUID(),begin:async()=>{throw new Error('Reuse the saved Wallpaper');},wallpaper:async()=>accepted?{...wallpaper,state:'published',sourceId:'retained-source'}:wallpaper,list:async()=>({sourceSetRevision:'0',sources:[],candidates:[retained]}),create:async()=>{throw new Error('Do not replace the pending candidate');},status:async()=>({...retained,status:'ready'}),upload:async()=>{throw new Error('Do not upload existing bytes');},expectSource:async(_wallpaper,candidate)=>{intents.push(candidate);},accept:async()=>{accepted=true;return {...retained,status:'accepted',sourceId:'retained-source'};},cancel:async()=>{throw new Error('Do not cancel retained work');},wait:async()=>{}};
 const blocked=createWallpaperSourceBatch(api,{wallpaperId:'saved-wallpaper'});blocked.addFiles([{value:'another',name:'another.png'}]);await blocked.run(new AbortController().signal);
 expect(blocked.getSnapshot().rows[0]).toMatchObject({status:'failed',message:expect.stringContaining('initial Source is still pending')});
 expect(intents).toEqual([]);
 const resumed=createWallpaperSourceBatch(api,{wallpaperId:'saved-wallpaper'});resumed.resume({value:'same-image',name:'same.png'},retained);await resumed.run(new AbortController().signal);
 expect(resumed.getSnapshot()).toMatchObject({wallpaperId:'saved-wallpaper',assetId:'asset',rows:[{status:'accepted',sourceId:'retained-source'}]});
 expect(intents).toEqual(['retained-candidate']);
});
it('retries a stale additional candidate against current membership and never repeats a successful file', async()=>{
 const {SourceIntakeError}=await import('@/features/wallpaper-creation');
 const uploads:string[]=[],cancellations:string[]=[];
 let revision=1,conflict=true;
 const wallpaper={wallpaperId:'published',assetId:'asset',sourceId:'first',state:'published' as const,createdAt:'now'};
 const api:SourceBatchApi<string>={identifier:()=>crypto.randomUUID(),begin:async()=>wallpaper,wallpaper:async()=>wallpaper,list:async()=>({sourceSetRevision:String(revision),sources:[{sourceId:'first'}],candidates:[]}),create:async(_asset,key,expected)=>({candidateId:key,status:'awaiting-bytes',expectedSourceSetRevision:expected}),status:async()=>{throw new Error('Cancelled stale candidate must not replay');},upload:async(_asset,id,file)=>{uploads.push(file);return {candidateId:id,status:'ready',expectedSourceSetRevision:String(revision)};},expectSource:async()=>{throw new Error('Published Wallpaper needs no first intent');},accept:async(_asset,id,expected)=>{if(uploads.at(-1)==='stale'&&conflict){conflict=false;revision++;throw new SourceIntakeError('Source set changed',true);}expect(expected).toBe(String(revision));revision++;return {candidateId:id,status:'accepted',sourceId:`source-${revision}`,expectedSourceSetRevision:expected};},cancel:async(_asset,id)=>{cancellations.push(id);},wait:async()=>{}};
 const batch=createWallpaperSourceBatch(api,{wallpaperId:'published'});batch.addFiles([{value:'good',name:'good.png'},{value:'stale',name:'stale.png'}]);await batch.run(new AbortController().signal);
 expect(batch.getSnapshot().rows.map(row=>row.status)).toEqual(['accepted','failed']);
 const stale=batch.getSnapshot().rows[1];if(!stale)throw new Error('Missing stale row');batch.retry(stale.id);await batch.run(new AbortController().signal);
 expect(uploads).toEqual(['good','stale','stale']);expect(cancellations).toHaveLength(1);expect(batch.getSnapshot().rows.map(row=>row.status)).toEqual(['accepted','accepted']);
});
it('replays the same supplied bytes to recover a retained inspection instead of polling it forever',async()=>{
 const wallpaper={wallpaperId:'published',assetId:'asset',sourceId:'first',state:'published' as const,createdAt:'now'};
 const retained={candidateId:'stopped-inspection',status:'inspecting',expectedSourceSetRevision:'1'};
 const uploads:string[]=[];let polls=0;
 const api:SourceBatchApi<string>={identifier:()=>crypto.randomUUID(),begin:async()=>wallpaper,wallpaper:async()=>wallpaper,list:async()=>({sourceSetRevision:'1',sources:[{sourceId:'first'}],candidates:[retained]}),create:async()=>{throw new Error('Preserve the retained candidate');},status:async()=>{polls++;return retained;},upload:async(_asset,id,file)=>{expect(id).toBe('stopped-inspection');uploads.push(file);return {...retained,status:'ready'};},expectSource:async()=>{throw new Error('Keep original publication');},accept:async()=>({...retained,status:'accepted',sourceId:'second'}),cancel:async()=>{throw new Error('Do not replace interrupted work');},wait:async()=>{}};
 const batch=createWallpaperSourceBatch(api,{wallpaperId:'published'});batch.resume({value:'same-immutable-bytes',name:'same.png'},retained);await batch.run(new AbortController().signal);
 expect(batch.getSnapshot().rows[0]).toMatchObject({status:'accepted',sourceId:'second'});expect(uploads).toEqual(['same-immutable-bytes']);expect(polls).toBe(1);
});
