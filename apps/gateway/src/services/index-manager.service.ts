import { inject, singleton } from 'tsyringe';
import { OpenSearchConnection } from '../connections/opensearch.js';
import { wallpapersIndexMapping } from '../opensearch/mappings.js';

/**
 * Service for managing OpenSearch indices
 */
@singleton()
export class IndexManagerService {
  private readonly indexName = 'wallpapers';

  constructor(
    @inject(OpenSearchConnection) private readonly openSearchConnection: OpenSearchConnection
  ) {}

  /**
   * Create the wallpapers index with mappings
   */
  async createIndex(): Promise<void> {
    const client = this.openSearchConnection.getClient();
    const exists = await client.indices.exists({
      index: this.indexName,
    });

    if (exists.body) {
      return;
    }

    await client.indices.create({
      index: this.indexName,
      body: {
        mappings: wallpapersIndexMapping,
      },
    });
  }

  /**
   * Delete the wallpapers index (for testing)
   */
  async deleteIndex(): Promise<void> {
    const client = this.openSearchConnection.getClient();
    const exists = await client.indices.exists({
      index: this.indexName,
    });

    if (!exists.body) {
      return;
    }

    await client.indices.delete({
      index: this.indexName,
    });
  }

  /**
   * Get the index name
   */
  getIndexName(): string {
    return this.indexName;
  }
}
