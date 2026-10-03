import { expect, it, vi } from 'vitest';
import { downloadWallpaper } from '@/features/wallpaper-details';
const variant = {url:'/image',width:1200,height:800,format:'image/jpeg'};
it('downloads cached payloads without network traffic', async () => {
 const fetchPayload=vi.fn(),save=vi.fn();
 await downloadWallpaper(variant,{openCache:async()=>({read:async()=> 'cached',write:vi.fn()}),fetchPayload,save});
 expect(fetchPayload).not.toHaveBeenCalled();expect(save).toHaveBeenCalledWith('cached','wallpaper-1200x800.jpg');
});
it('fetches without caching when cache storage is unavailable', async () => {
 const save=vi.fn();
 await downloadWallpaper(variant,{openCache:async()=>{throw Error('Unavailable')},fetchPayload:async()=> 'network',save});
 expect(save).toHaveBeenCalledWith('network','wallpaper-1200x800.jpg');
});
it('writes network payloads on cache misses and propagates cache write failures', async () => {
 const save=vi.fn(),write=vi.fn().mockRejectedValue(Error('Write failed'));
 await expect(downloadWallpaper(variant,{openCache:async()=>({read:async()=>undefined,write}),fetchPayload:async()=> 'network',save})).rejects.toThrow('Write failed');
 expect(write).toHaveBeenCalledWith('/image','network');expect(save).not.toHaveBeenCalled();
});
