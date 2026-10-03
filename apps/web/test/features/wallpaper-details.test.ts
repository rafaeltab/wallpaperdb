import { expect, it } from 'vitest';
import { resolveVariantIndex, detailShortcut, shareWallpaperLink } from '@/features/wallpaper-details';
it('resets selection on navigation and bounds selection after variants disappear', () => {
  expect(resolveVariantIndex({wallpaperId:'a',index:2},'b',4)).toBe(0);
  expect(resolveVariantIndex({wallpaperId:'a',index:2},'a',2)).toBe(1);
  expect(resolveVariantIndex({wallpaperId:'a',index:2},'a',0)).toBe(0);
});
it('maps shortcuts to bounded actions and ignores typing', () => {
  const state={panelOpen:true,index:0,count:2};
  expect(detailShortcut('ArrowRight',false,state)).toEqual({kind:'select',index:1});
  expect(detailShortcut('ArrowLeft',false,state)).toBeUndefined();
  expect(detailShortcut('Escape',false,state)).toEqual({kind:'close-panel'});
  expect(detailShortcut('D',false,state)).toEqual({kind:'download'});
  expect(detailShortcut('s',true,state)).toBeUndefined();
  expect(detailShortcut('d',false,{...state,count:0})).toBeUndefined();
});
it('uses native sharing and falls back to copying on native failure', async () => {
  const shared:string[]=[];const copied:string[]=[];
  const port={share:async (url:string)=>{shared.push(url);},copy:async (url:string)=>{copied.push(url);}};
  expect(await shareWallpaperLink('link',port)).toBe('shared');
  expect(copied).toEqual([]);
  expect(await shareWallpaperLink('link',{...port,share:async()=>{throw Error('Unavailable');}})).toBe('copied');
  expect(copied).toEqual(['link']);
});
it('reports clipboard failures when native sharing is unavailable', async () => {
  expect(await shareWallpaperLink('link',{copy:async()=>{throw Error('Denied');}})).toBe('failed');
});
