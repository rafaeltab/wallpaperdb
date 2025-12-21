import { recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { inject, singleton } from 'tsyringe';
import { OpenSearchConnection } from '../connections/opensearch.js';
import { wallpapersIndexMapping } from '../opensearch/mappings.js';
import { GatewayAttributes } from '../telemetry/attributes.js';

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
    return await withSpan(
      'opensearch.index.create',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: this.indexName,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'create_index',
      },
      async (span) => {
        const startTime = Date.now();
        const client = this.openSearchConnection.getClient();

        const exists = await client.indices.exists({
          index: this.indexName,
        });

        if (exists.body) {
          span.setAttribute('index.already_exists', true);
          return;
        }

        await client.indices.create({
          index: this.indexName,
          body: {
            mappings: wallpapersIndexMapping,
          },
        });

        span.setAttribute('index.already_exists', false);
        const durationMs = Date.now() - startTime;
        recordCounter('opensearch.index.created.total', 1, {
          [GatewayAttributes.OPENSEARCH_INDEX]: this.indexName,
        });
        recordHistogram('opensearch.index.operation_duration_ms', durationMs, {
          [GatewayAttributes.OPENSEARCH_OPERATION]: 'create_index',
        });
      }
    );
  }

  /**
   * Delete the wallpapers index (for testing)
   */
  async deleteIndex(): Promise<void> {
    return await withSpan(
      'opensearch.index.delete',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: this.indexName,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'delete_index',
      },
      async (span) => {
        const startTime = Date.now();
        const client = this.openSearchConnection.getClient();

        const exists = await client.indices.exists({
          index: this.indexName,
        });

        if (!exists.body) {
          span.setAttribute('index.existed', false);
          return;
        }

        await client.indices.delete({
          index: this.indexName,
        });

        span.setAttribute('index.existed', true);
        const durationMs = Date.now() - startTime;
        recordHistogram('opensearch.index.operation_duration_ms', durationMs, {
          [GatewayAttributes.OPENSEARCH_OPERATION]: 'delete_index',
        });
      }
    );
  }

  /**
   * Get the index name
   */
  getIndexName(): string {
    return this.indexName;
  }
}
