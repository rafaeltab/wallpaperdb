import 'reflect-metadata';
import { container } from 'tsyringe';
import { describe, expect, it } from 'vitest';
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
