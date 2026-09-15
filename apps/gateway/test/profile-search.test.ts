import 'reflect-metadata';
import { container } from 'tsyringe';
import { describe, expect, it, vi } from 'vitest';
import {
  type ProfileDocument,
  ProfileRepository,
} from '../src/repositories/profile.repository.js';
import { tester } from './setup.js';

async function project(overrides: Partial<ProfileDocument> & Pick<ProfileDocument, 'id' | 'handle'>) {
  await container.resolve(ProfileRepository).project({
    displayName: 'Contributor',
    claimGeneration: 1,
    aliases: [],
    biographyMarkdown: '',
    pictureAssetId: null,
    version: 1,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  });
}

async function search(query: string, first?: number, after?: string) {
  const response = await tester.getApp().inject({
    method: 'POST',
    url: '/graphql',
    payload: {
      query: `query SearchProfiles($query: String!, $first: Int, $after: String) {
        searchProfiles(query: $query, first: $first, after: $after) {
          edges { node { id handle displayName canonicalPath picture { id url } } }
          pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        }
      }`,
      variables: { query, first, after },
    },
  });
  return response.json();
}

describe('Profile search integration', () => {
  it('paginates equal-rank Profiles by immutable ID without repeats or gaps', async () => {
    for (const suffix of ['05', '01', '04', '02', '03']) {
      await project({ id: `user_${suffix}`, handle: `constellation-${suffix}` });
    }
    const first = await search('constellation', 2);
    expect(first.errors).toBeUndefined();
    expect(first.data.searchProfiles.edges.map((edge: { node: { id: string } }) => edge.node.id))
      .toEqual(['user_01', 'user_02']);
    expect(first.data.searchProfiles.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });

    // Extra matching Display names alter index statistics, but never existing rank scores.
    await project({ id: 'user_name', handle: 'night-artist', displayName: 'Constellation Painter' });
    const second = await search('constellation', 2, first.data.searchProfiles.pageInfo.endCursor);
    expect(second.errors).toBeUndefined();
    expect(second.data.searchProfiles.edges.map((edge: { node: { id: string } }) => edge.node.id))
      .toEqual(['user_03', 'user_04']);
    expect(second.data.searchProfiles.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: true });

    const third = await search('constellation', 2, second.data.searchProfiles.pageInfo.endCursor);
    expect(third.errors).toBeUndefined();
    expect(third.data.searchProfiles.edges.map((edge: { node: { id: string } }) => edge.node.id))
      .toEqual(['user_05', 'user_name']);
    expect(third.data.searchProfiles.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });

    const end = await search('constellation', 2, third.data.searchProfiles.pageInfo.endCursor);
    expect(end.errors).toBeUndefined();
    expect(end.data.searchProfiles).toEqual({
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: true, startCursor: null, endCursor: null },
    });
  });

  it('keeps scheduled aliases searchable until their exact deadline and retained aliases afterward', async () => {
    const deadline = new Date('2030-01-01T00:00:00.000Z');
    await project({
      id: 'user_retained', handle: 'retained-owner',
      aliases: [{ handle: 'aurora-retained', claimGeneration: 2 }],
    });
    await project({
      id: 'user_scheduled', handle: 'scheduled-owner',
      aliases: [
        { handle: 'aurora', claimGeneration: 2, expiresAt: deadline.toISOString() },
        { handle: 'unrelated-retained', claimGeneration: 3 },
      ],
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(deadline.getTime() - 1);
      const before = await search('aurora');
      expect(before.errors).toBeUndefined();
      expect(before.data.searchProfiles.edges.map((edge: { node: { id: string } }) => edge.node.id))
        .toEqual(['user_scheduled', 'user_retained']);

      vi.setSystemTime(deadline);
      const expired = await search('aurora');
      expect(expired.errors).toBeUndefined();
      expect(expired.data.searchProfiles.edges.map((edge: { node: { id: string } }) => edge.node.id))
        .toEqual(['user_retained']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ranks current Handles, active aliases, and Display names in strict tiers', async () => {
    await project({ id: 'user_rank_7', handle: 'aurora', displayName: 'Aurora' });
    await project({ id: 'user_rank_6', handle: 'aurora-ridge' });
    await project({
      id: 'user_rank_5', handle: 'renamed-exact', displayName: 'Aurora Aurora Aurora',
      aliases: [
        { handle: 'aurora', claimGeneration: 2 },
        { handle: 'aurora-one', claimGeneration: 3 },
        { handle: 'aurora-two', claimGeneration: 4 },
        { handle: 'aurora-three', claimGeneration: 5 },
      ],
    });
    await project({
      id: 'user_rank_4', handle: 'renamed-prefix', displayName: 'Aurora',
      aliases: [{ handle: 'aurora-hill', claimGeneration: 2 }],
    });
    await project({ id: 'user_rank_3', handle: 'phrase-artist', displayName: 'The Aurora Artist' });
    await project({ id: 'user_rank_2', handle: 'prefix-artist', displayName: 'Auroral Painter' });
    await project({ id: 'user_rank_1', handle: 'fuzzy-artist', displayName: 'Aurorra' });

    const result = await search('aurora');

    expect(result.errors).toBeUndefined();
    expect(result.data.searchProfiles.edges.map((edge: { node: { id: string } }) => edge.node.id))
      .toEqual(['user_rank_7', 'user_rank_6', 'user_rank_5', 'user_rank_4', 'user_rank_2', 'user_rank_3', 'user_rank_1']);
  });

  it('finds an exact current Handle as a public Profile connection', async () => {
    await project({ id: 'user_aurora', handle: 'aurora', displayName: 'Aurora Artist' });
    await project({ id: 'user_other', handle: 'other' });

    const result = await search('aurora');

    expect(result.errors).toBeUndefined();
    expect(result.data.searchProfiles.edges).toEqual([
      { node: {
        id: 'user_aurora', handle: 'aurora', displayName: 'Aurora Artist',
        canonicalPath: '/profiles/@aurora', picture: null,
      } },
    ]);
    expect(result.data.searchProfiles.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: expect.any(String),
      endCursor: expect.any(String),
    });
  });
});
