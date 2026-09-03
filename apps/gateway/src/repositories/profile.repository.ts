import type { PublicProfileSnapshot } from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { OpenSearchConnection } from '../connections/opensearch.js';
import { profileIndexDefinition } from '../opensearch/index-definitions.js';
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

  async findByHandle(handle: string): Promise<ProfileDocument | null> {
    const result = await this.openSearchConnection.getClient().search({
      index: this.indexManager.getIndexName(profileIndexDefinition.key),
      body: {
        query: { term: { handle: handle.toLowerCase() } },
        sort: [{ claimGeneration: 'desc' }],
        size: 1,
      },
    });
    const hit = result.body.hits.hits[0] as { _source?: ProfileDocument } | undefined;
    return hit?._source ?? null;
  }
}
