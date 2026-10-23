import { afterEach, expect, it, vi } from 'vitest';
import { selectSourceDefault, withdrawSource } from '@/features/wallpaper-creation/adapters/http';
vi.mock('@/lib/auth/token-provider', () => ({ getAuthToken: async () => 'test-owner-token' }));
afterEach(() => vi.unstubAllGlobals());
it('sends protected Default and withdrawal commands with exact decimal revisions, route identity and cancellation', async () => {
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 })
  );
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  await selectSourceDefault('asset/one', 'source/next', '9007199254740993', signal);
  await withdrawSource('asset/one', 'source/old', '9007199254740994', signal);
  const first = fetcher.mock.calls[0];
  const second = fetcher.mock.calls[1];
  expect(first).toEqual([
    '/asset/assets/asset%2Fone/default-source',
    {
      method: 'PUT',
      headers: expect.any(Headers),
      body: JSON.stringify({
        sourceId: 'source/next',
        expectedSourceSetRevision: '9007199254740993',
      }),
      signal,
    },
  ]);
  expect(second).toEqual([
    '/asset/assets/asset%2Fone/sources/source%2Fold',
    {
      method: 'DELETE',
      headers: expect.any(Headers),
      body: JSON.stringify({ expectedSourceSetRevision: '9007199254740994' }),
      signal,
    },
  ]);
  for (const call of fetcher.mock.calls) {
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer test-owner-token');
    expect(new Headers(call[1]?.headers).get('Content-Type')).toBe('application/json');
  }
});
it.each([
  409, 422,
])('reports a Source-management rejection without an intake restart or automatic mutation retry: %s', async (status) => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ private: 'not client guidance' }), { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(
    withdrawSource('asset', 'source', '3', new AbortController().signal)
  ).rejects.toThrow(
    'Sources changed or this Source cannot be changed. Review the current Sources and try again.'
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
