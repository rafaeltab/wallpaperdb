import { expect, it } from 'vitest';
import { canonicalProfileOutcome, embeddedWallpaperState, projectionRetryDelay, profileInitials, profileFallbackColor, resolveProfilePicture } from '@/features/public-profile';
it('returns explicit canonical, missing, and redirect outcomes', () => {
  const profile={id:'owner'};
  expect(canonicalProfileOutcome(null,'alias')).toEqual({kind:'missing'});
  expect(canonicalProfileOutcome({profile,canonicalHandle:'ada'},'alias')).toEqual({kind:'redirect',handle:'ada'});
  expect(canonicalProfileOutcome({profile,canonicalHandle:'ada'},'ada')).toEqual({kind:'profile',profile});
  expect(canonicalProfileOutcome({profile,canonicalHandle:'ada'})).toEqual({kind:'redirect',handle:'ada'});
});
it('retries missing projections but never retries a different owner or admission denial', () => {
  expect(embeddedWallpaperState(null,'a','owner')).toMatchObject({retryable:true,available:false});
  expect(embeddedWallpaperState({wallpaperId:'a',profileId:'other',variants:[{}]},'a','owner')).toMatchObject({retryable:false,available:false});
  expect(embeddedWallpaperState({wallpaperId:'a',profileId:'owner',variants:[{}]},'a','owner')).toMatchObject({retryable:false,available:true});
  expect(projectionRetryDelay(0,false)).toBe(1000);
  expect(projectionRetryDelay(2,false)).toBe(4000);
  expect(projectionRetryDelay(3,false)).toBeUndefined();
  expect(projectionRetryDelay(0,true)).toBeUndefined();
});
it('uses newer owner pictures and names while respecting newer public projections', () => {
  const projection={id:'owner',displayName:'Public',version:3,picture:{id:'public',url:'public-url'}};
  const owner={id:'owner',displayName:'Owner',version:4,pictureAssetId:'owner-picture'};
  expect(resolveProfilePicture(projection,owner,'/media')).toMatchObject({displayName:'Owner',picture:{url:'/media/profile-pictures/owner-picture'}});
  expect(resolveProfilePicture({...projection,version:5},owner,'/media')).toMatchObject({displayName:'Public',picture:{url:'public-url'}});
  expect(resolveProfilePicture(projection,{...owner,id:'other'},'/media')).toMatchObject({displayName:'Public',picture:{url:'public-url'}});
  expect(resolveProfilePicture(projection,{...owner,pictureAssetId:null},'/media').picture).toBeNull();
});
it('renders deterministic initials and fallback colors', () => {
  expect(profileInitials('  Ada  Byron ')).toBe('AB');
  expect(profileInitials('')).toBe('?');
  expect(profileFallbackColor('owner')).toBe(profileFallbackColor('owner'));
  expect(profileFallbackColor('other')).not.toBe(profileFallbackColor('owner'));
});
