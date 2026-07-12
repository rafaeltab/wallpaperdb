import { recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { inject, singleton } from 'tsyringe';
import { OpenSearchConnection } from '../connections/opensearch.js';
import {
  gatewayIndexDefinitions,
  type IndexDefinition,
  wallpaperIndexDefinition,
} from '../opensearch/index-definitions.js';
import { GatewayAttributes } from '../telemetry/attributes.js';

/**
 * Service for managing OpenSearch indices
 */
@singleton()
export class IndexManagerService {
  private readonly definitions = new Map(
    gatewayIndexDefinitions.map((definition) => [definition.key, definition])
  );

  constructor(
    @inject(OpenSearchConnection) private readonly openSearchConnection: OpenSearchConnection
  ) {}

  /**
   * Register an independently managed projected index.
   */
  register(definition: IndexDefinition): void {
    if (this.definitions.has(definition.key)) {
      throw new Error(`Index definition already registered: ${definition.key}`);
    }
    if ([...this.definitions.values()].some(({ name }) => name === definition.name)) {
      throw new Error(`Index name already registered: ${definition.name}`);
    }

    this.definitions.set(definition.key, definition);
  }

  unregister(key: string): void {
    this.definitions.delete(key);
  }

  /**
   * Create all registered indexes with their mappings.
   */
  async createIndex(key?: string): Promise<void> {
    if (key) {
      await this.createDefinition(this.getDefinition(key));
      return;
    }

    for (const definition of this.definitions.values()) {
      await this.createDefinition(definition);
    }
  }

  private async createDefinition(definition: IndexDefinition): Promise<void> {
    return await withSpan(
      'opensearch.index.create',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: definition.name,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'create_index',
      },
      async (span) => {
        const startTime = Date.now();
        const client = this.openSearchConnection.getClient();

        const exists = await client.indices.exists({
          index: definition.name,
        });

        if (exists.body) {
          span.setAttribute('index.already_exists', true);
          return;
        }

        await client.indices.create({
          index: definition.name,
          body: {
            settings: definition.mapping.settings,
            mappings: {
              properties: definition.mapping.properties,
            },
          },
        });

        span.setAttribute('index.already_exists', false);
        const durationMs = Date.now() - startTime;
        recordCounter('opensearch.index.created.total', 1, {
          [GatewayAttributes.OPENSEARCH_INDEX]: definition.name,
        });
        recordHistogram('opensearch.index.operation_duration_ms', durationMs, {
          [GatewayAttributes.OPENSEARCH_INDEX]: definition.name,
          [GatewayAttributes.OPENSEARCH_OPERATION]: 'create_index',
        });
      }
    );
  }

  /**
   * Delete all registered indexes (for testing).
   */
  async deleteIndex(key?: string): Promise<void> {
    if (key) {
      await this.deleteDefinition(this.getDefinition(key));
      return;
    }

    for (const definition of this.definitions.values()) {
      await this.deleteDefinition(definition);
    }
  }

  private async deleteDefinition(definition: IndexDefinition): Promise<void> {
    return await withSpan(
      'opensearch.index.delete',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: definition.name,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'delete_index',
      },
      async (span) => {
        const startTime = Date.now();
        const client = this.openSearchConnection.getClient();

        const exists = await client.indices.exists({
          index: definition.name,
        });

        if (!exists.body) {
          span.setAttribute('index.existed', false);
          return;
        }

        await client.indices.delete({
          index: definition.name,
        });

        span.setAttribute('index.existed', true);
        const durationMs = Date.now() - startTime;
        recordHistogram('opensearch.index.operation_duration_ms', durationMs, {
          [GatewayAttributes.OPENSEARCH_INDEX]: definition.name,
          [GatewayAttributes.OPENSEARCH_OPERATION]: 'delete_index',
        });
      }
    );
  }

  /**
   * Get the physical index name for a registered projection.
   */
  getIndexName(key = wallpaperIndexDefinition.key): string {
    return this.getDefinition(key).name;
  }

  private getDefinition(key: string): IndexDefinition {
    const definition = this.definitions.get(key);
    if (!definition) {
      throw new Error(`Unknown index definition: ${key}`);
    }

    return definition;
  }
}
