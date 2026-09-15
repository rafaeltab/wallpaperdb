import type { PublicProfileSnapshot } from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { OpenSearchConnection } from '../connections/opensearch.js';
import { profileIndexDefinition } from '../opensearch/index-definitions.js';
import type { CursorValue } from '../services/cursor.service.js';
import { IndexManagerService } from '../services/index-manager.service.js';

export type ProfileDocument = PublicProfileSnapshot;

@singleton()
export class ProfileRepository {
  constructor(
    @inject(OpenSearchConnection) private readonly openSearchConnection: OpenSearchConnection,
    @inject(IndexManagerService) private readonly indexManager: IndexManagerService
  ) {}

  async project(profile: ProfileDocument): Promise<void> {
    await this.openSearchConnection.getClient().update({
      index: this.indexManager.getIndexName(profileIndexDefinition.key),
      id: profile.id,
      body: {
        scripted_upsert: true,
        script: {
          lang: 'painless',
          source: `
            if (ctx.op == 'create' || params.profile.version > ctx._source.version) {
              ctx._source = params.profile;
            } else {
              ctx.op = 'none';
            }
          `,
          params: { profile },
        },
        upsert: profile,
      },
      refresh: true,
      retry_on_conflict: 3,
    });
  }

  async findById(id: string): Promise<ProfileDocument | null> {
    try {
      const result = await this.openSearchConnection.getClient().get({
        index: this.indexManager.getIndexName(profileIndexDefinition.key),
        id,
      });
      return result.body._source as ProfileDocument;
    } catch (error) {
      if ((error as { meta?: { statusCode?: number } }).meta?.statusCode === 404) return null;
      throw error;
    }
  }

  async findByIds(ids: string[]): Promise<Array<ProfileDocument | null>> {
    if (ids.length === 0) return [];

    const result = await this.openSearchConnection.getClient().mget({
      index: this.indexManager.getIndexName(profileIndexDefinition.key),
      body: { ids },
    });

    return result.body.docs.map((document: { found?: boolean; _source?: ProfileDocument }) => {
      if (document.found === false) return null;
      return document._source ?? null;
    });
  }

  async search(params: { query: string; size: number; searchAfter?: CursorValue[] }) {
    const aliasMatch = (query: Record<string, unknown>) => ({
      nested: { path: 'aliases', score_mode: 'none', query },
    });
    const tiers = [
      { term: { handle: params.query } },
      { prefix: { handle: params.query } },
      aliasMatch({ term: { 'aliases.handle': params.query } }),
      aliasMatch({ prefix: { 'aliases.handle': params.query } }),
      { match_phrase_prefix: { displayName: params.query } },
      { match: { displayName: { query: params.query, fuzziness: 'AUTO', operator: 'and' } } },
    ];
    const result = await this.openSearchConnection.getClient().search({
      index: this.indexManager.getIndexName(profileIndexDefinition.key),
      body: {
        // Only the best tier contributes. Extra alias/name matches cannot push a
        // lower tier above a current Handle, and scores do not drift with index statistics.
        query: {
          dis_max: {
            tie_breaker: 0,
            queries: tiers.map((filter, index) => ({
              constant_score: { filter, boost: tiers.length - index },
            })),
          },
        },
        sort: [{ _score: 'desc' }, { id: 'asc' }],
        size: params.size,
        search_after: params.searchAfter,
      },
    });
    const hits = result.body.hits.hits as Array<{
      _source: ProfileDocument;
      sort: CursorValue[];
    }>;
    return hits.map((hit) => ({ profile: hit._source, cursorValues: hit.sort }));
  }

  async findByHandle(handle: string): Promise<ProfileDocument | null> {
    const normalizedHandle = handle.toLowerCase();
    const index = this.indexManager.getIndexName(profileIndexDefinition.key);
    const client = this.openSearchConnection.getClient();
    const aliasFilter = {
      bool: {
        filter: [
          { term: { 'aliases.handle': normalizedHandle } },
          {
            bool: {
              should: [
                { bool: { must_not: { exists: { field: 'aliases.expiresAt' } } } },
                { range: { 'aliases.expiresAt': { gt: new Date().toISOString() } } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    };
    // Compare each kind of claim by the requested Handle's generation. A newer
    // current Handle or unrelated alias must not make an older claim win.
    const [currentResult, aliasResult] = await Promise.all([
      client.search({
        index,
        body: {
          query: { term: { handle: normalizedHandle } },
          sort: [{ claimGeneration: 'desc' }],
          size: 1,
        },
      }),
      client.search({
        index,
        body: {
          query: { nested: { path: 'aliases', query: aliasFilter } },
          sort: [
            {
              'aliases.claimGeneration': {
                order: 'desc',
                mode: 'max',
                nested: {
                  path: 'aliases',
                  filter: aliasFilter,
                },
              },
            },
          ],
          size: 1,
        },
      }),
    ]);
    const current = currentResult.body.hits.hits[0]?._source as ProfileDocument | undefined;
    const alias = aliasResult.body.hits.hits[0]?._source as ProfileDocument | undefined;
    const aliasGeneration = alias?.aliases?.find(
      (claim) => claim.handle === normalizedHandle
    )?.claimGeneration;
    if (
      alias &&
      aliasGeneration !== undefined &&
      (!current || aliasGeneration > current.claimGeneration)
    ) {
      return alias;
    }
    return current ?? null;
  }
}
