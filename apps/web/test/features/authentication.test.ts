import { expect, it } from 'vitest';
import { buildAuthUrl, postAuthDestination, signInNextAction, signUpNextAction } from '@/features/authentication';
it('resolves post-auth navigation and waits for outstanding session tasks', () => {
  expect(postAuthDestination('/upload',false)).toEqual({kind:'route',url:'/upload'});
  expect(postAuthDestination('https://example.test/web/',false)).toEqual({kind:'document',url:'https://example.test/web/'});
  expect(postAuthDestination('/upload',true)).toEqual({kind:'wait'});
});
it('builds callback and destination paths for subpath deployments', () => {
  expect(buildAuthUrl('/web/','/sso-callback')).toBe('/web/sso-callback');
  expect(buildAuthUrl('','/')).toBe('/');
  expect(buildAuthUrl('/web','upload')).toBe('/web/upload');
});
it('interprets SDK stages without owning authentication state', () => {
  expect(signInNextAction('complete')).toBe('finalize');
  expect(signInNextAction('needs_client_trust')).toBe('second-factor');
  expect(signInNextAction('needs_second_factor')).toBe('second-factor');
  expect(signInNextAction('needs_first_factor')).toBe('wait');
  expect(signUpNextAction('missing_requirements')).toBe('send-email-code');
  expect(signUpNextAction('complete')).toBe('finalize');
  expect(signUpNextAction(null)).toBe('wait');
});
