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
