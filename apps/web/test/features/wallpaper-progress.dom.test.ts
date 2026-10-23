import {afterEach,expect,it,vi} from 'vitest';
import {recentCreations} from '@/features/wallpaper-creation/adapters/http';
vi.mock('@/lib/auth/token-provider',()=>({getAuthToken:async()=> 'owner-token'}));
afterEach(()=>vi.unstubAllGlobals());
it('reads the saved candidate rejection after loading durable Wallpaper progress again',async()=>{
 const requests:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
  requests.push(url);expect(new Headers(options.headers).get('Authorization')).toBe('Bearer owner-token');
  const data=requests.length===1?{wallpapers:[{wallpaperId:'wallpaper',state:'accepting-source',assetId:'asset',sourceId:null,candidateId:'candidate',createdAt:'2026-10-22T00:00:00Z'}]}:{candidateId:'candidate',status:'rejected'};
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 }));
 expect(await recentCreations()).toEqual([{wallpaperId:'wallpaper',state:'accepting-source',assetId:'asset',sourceId:null,candidateId:'candidate',createdAt:'2026-10-22T00:00:00Z',candidateStatus:'rejected'}]);
 expect(requests).toEqual(['/wallpaper/wallpapers','/asset/assets/asset/source-candidates/candidate']);
});
it('sends the captured current revision and independent correlation for an additional Source',async()=>{
 const {browserSourceBatchApi}=await import('@/features/wallpaper-creation/adapters/http');
 const requests:{url:string;options:RequestInit}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{requests.push({url,options});return new Response(JSON.stringify({candidateId:'candidate-2',status:'accepted',expectedSourceSetRevision:'1',sourceId:'source-2'}),{headers:{'Content-Type':'application/json'}});}));
 expect(await browserSourceBatchApi().accept('asset','candidate-2','1','independent',new AbortController().signal)).toMatchObject({status:'accepted',sourceId:'source-2'});
 expect(requests[0]?.url).toBe('/asset/assets/asset/source-candidates/candidate-2/accept');
 expect(JSON.parse(String(requests[0]?.options.body))).toEqual({operation:'add',expectedSourceSetRevision:'1'});
 expect(new Headers(requests[0]?.options.headers).get('X-Correlation-Id')).toBe('independent');
});
