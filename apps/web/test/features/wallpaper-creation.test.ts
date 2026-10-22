import { expect,it } from 'vitest';
import { uploadFirstSource, type CreationApi } from '@/features/wallpaper-creation';
it('records the candidate intent before acceptance and waits for durable Wallpaper publication',async()=>{
 const calls:string[]=[];let polls=0;
 const status={wallpaperId:'wallpaper-1',state:'awaiting-source' as const,assetId:'asset-1',sourceId:null,createdAt:'2026-10-22T00:00:00Z'};
 const api:CreationApi<string>={candidateStatus:async()=>({candidateId:'candidate-1',status:'ready'}),begin:async key=>{calls.push(`begin:${key}`);return status;},status:async()=>{calls.push('status');return ++polls===1?{...status,state:'accepting-source'}:{...status,state:'published',sourceId:'source-1'};},policy:async()=>({maxBytes:100}),candidate:async()=>{calls.push('candidate');return {candidateId:'candidate-1',status:'awaiting-bytes'};},expectSource:async(_id,candidate,intent)=>{calls.push(`intent:${candidate}:${intent}`);},upload:async()=>{calls.push('upload');return {candidateId:'candidate-1',status:'ready'};},accept:async()=>{calls.push('accept');return {candidateId:'candidate-1',status:'accepted'};},wait:async()=>{},newId:()=> 'intent-1'};
 const result=await uploadFirstSource(api,{value:'image',size:80},'request-1',new AbortController().signal);
 expect(result).toMatchObject({kind:'published',wallpaper:{wallpaperId:'wallpaper-1',assetId:'asset-1',sourceId:'source-1'}});
 expect(calls).toEqual(['begin:request-1','candidate','intent:candidate-1:request-1','upload','accept','status','status']);
});
it('returns a durable pending receipt instead of claiming success during delayed confirmation',async()=>{
 const status={wallpaperId:'wallpaper-1',state:'creating-asset' as const,assetId:null,sourceId:null,createdAt:'2026-10-22T00:00:00Z'};
 let polls=0;
 const api:CreationApi<string>={candidateStatus:async()=>({candidateId:'candidate-1',status:'ready'}),begin:async()=>status,status:async()=>{polls++;return status;},policy:async()=>({maxBytes:100}),candidate:async()=>{throw new Error('No Asset');},expectSource:async()=>{},upload:async()=>{throw new Error('No Asset');},accept:async()=>{throw new Error('No Asset');},wait:async()=>{},newId:()=> 'intent'};
 expect(await uploadFirstSource(api,{value:'image',size:80},'key',new AbortController().signal)).toEqual({kind:'pending',wallpaper:status});expect(polls).toBe(30);
});
it('resumes a retained inspecting candidate through its durable status before accepting',async()=>{
 const calls:string[]=[];let inspected=0;
 const status={wallpaperId:'wallpaper',state:'awaiting-source' as const,assetId:'asset',sourceId:null,createdAt:'2026-10-22T00:00:00Z'};
 const api:CreationApi<string>={begin:async()=>status,status:async()=>({...status,state:'published',sourceId:'source'}),policy:async()=>({maxBytes:100}),candidate:async()=>({candidateId:'candidate',status:'inspecting'}),candidateStatus:async()=>{calls.push('inspect');return {candidateId:'candidate',status:++inspected===2?'ready':'inspecting'};},expectSource:async()=>{calls.push('intent');},upload:async()=>{throw new Error('Existing bytes');},accept:async()=>{calls.push('accept');return {candidateId:'candidate',status:'accepted'};},wait:async()=>{},newId:()=> 'intent'};
 expect(await uploadFirstSource(api,{value:'image',size:80},'key',new AbortController().signal)).toMatchObject({kind:'published'});
 expect(calls).toEqual(['inspect','inspect','intent','accept']);
});
