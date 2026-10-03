import { expect, it } from 'vitest';
import { classifyAliases, aliasChangeDialog, pictureSelection, historicalHandleAvailability, pictureImportPollInterval, shouldClearOwnerProfile } from '@/features/profile-management';
it('classifies aliases without showing active aliases again in history', () => {
  const profile={aliases:[{handle:'old'},{handle:'expiring',expiresAt:'soon'}],historicalHandles:[{handle:'old'},{handle:'recent'}]};
  const result=classifyAliases(profile);
  expect(result.retained.map(a=>a.handle)).toEqual(['old']);
  expect(result.expiring.map(a=>a.handle)).toEqual(['expiring']);
  expect(result.historical.map(a=>a.handle)).toEqual(['recent']);
  expect(result.summary).toBe('1 retained · 1 expiring');
  expect(classifyAliases({}).summary).toBe('No previous handles');
});
it('describes each selected alias action', () => {
  const command={action:'expire' as const,handle:'old',expectedVersion:3};
  expect(aliasChangeDialog(command,'current')).toMatchObject({title:'Expire alias now?',button:'Expire now'});
  for(const action of ['schedule','keep','reactivate'] as const) expect(aliasChangeDialog({...command,action},'current').description).toContain('@old');
});
it('rejects unsupported or oversized pictures and handles deselection', () => {
  expect(pictureSelection({type:'image/gif',size:1},10).error).toContain('JPEG');
  expect(pictureSelection({type:'image/png',size:11},10).selected).toBeNull();
  const file={type:'image/webp',size:10};expect(pictureSelection(file,10)).toEqual({selected:file,error:null});
  expect(pictureSelection(undefined,10)).toEqual({selected:null,error:null});
});
it('prioritizes expired history and maps unavailable reasons', () => {
  expect(historicalHandleAvailability(5,'claimed',5)).toContain('recent history');
  expect(historicalHandleAvailability(10,'claimed',5)).toContain('claimed');
  expect(historicalHandleAvailability(10,'alias-limit',5)).toContain('limit');
  expect(historicalHandleAvailability(10,null,5)).toBeNull();
});
it('pauses import polling during writes and purges only resolved session transitions', () => {
  expect(pictureImportPollInterval('pending',false)).toBe(5000);
  expect(pictureImportPollInterval('retrying',true)).toBe(false);
  expect(pictureImportPollInterval('complete',false)).toBe(false);
  expect(shouldClearOwnerProfile('a',null,false)).toBe(false);
  expect(shouldClearOwnerProfile('a','b',true)).toBe(true);
  expect(shouldClearOwnerProfile(null,'a',true)).toBe(false);
  expect(shouldClearOwnerProfile('a',null,true)).toBe(true);
});
