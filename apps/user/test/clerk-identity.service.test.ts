import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clerkIdentitiesLayer } from '../src/adapters/profiles/index.js';
import { Identities } from '../src/profile/index.js';

const run = (userId = 'user_123') => Effect.runPromise(Effect.gen(function* () {
  return yield* (yield* Identities).getIdentity(userId);
}).pipe(Effect.provide(clerkIdentitiesLayer({ clerkSecretKey: 'test-secret' }))));

afterEach(() => vi.unstubAllGlobals());

describe('Clerk identities adapter', () => {
  it.each([true, false])('imports only a custom identity picture when has_image is %s', async hasImage => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ first_name: null, last_name: null, has_image: hasImage, image_url: 'https://img.clerk.com/initial-picture' })));
    expect(await run()).toEqual({ displayName: null, firstName: null, lastName: null, imageUrl: hasImage ? 'https://img.clerk.com/initial-picture' : null });
  });
  it('keeps usernames out of display names and encodes the user identifier in the authenticated request', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ username: 'ada123', first_name: 'Ada', last_name: 'Lovelace', has_image: false, image_url: '' }));
    vi.stubGlobal('fetch', fetch);
    expect(await run('user/a')).toEqual({ displayName: null, firstName: 'Ada', lastName: 'Lovelace', imageUrl: null });
    expect(fetch).toHaveBeenCalledWith('https://api.clerk.com/v1/users/user%2Fa', expect.objectContaining({ headers: { authorization: 'Bearer test-secret' }, signal: expect.any(AbortSignal) }));
  });
  it.each([Response.json({ first_name: 12 }), new Response('private upstream diagnostic', { status: 503 })])('translates unavailable or malformed identity responses into a tagged technical failure', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(run()).rejects.toMatchObject({ _tag: 'ProfileUnavailable', operation: 'identity-lookup' });
  });
});
