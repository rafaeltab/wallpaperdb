import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import { inject, singleton } from 'tsyringe';
import { OpenSearchConnection } from '../connections/opensearch.js';
import { IndexManagerService } from '../services/index-manager.service.js';
import { GatewayAttributes } from '../telemetry/attributes.js';

export interface Variant {
  width: number;
  height: number;
  aspectRatio: number;
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSizeBytes: number;
  createdAt: string;
}

export interface WallpaperDocument {
  wallpaperId: string;
  userId: string;
  variants: Variant[];
  uploadedAt: string;
  updatedAt: string;
}

/**
 * Repository for wallpaper documents in OpenSearch
 */
@singleton()
export class WallpaperRepository {
  constructor(
    @inject(OpenSearchConnection) private readonly openSearchConnection: OpenSearchConnection,
    @inject(IndexManagerService) private readonly indexManager: IndexManagerService
  ) {}

  /**
   * Create or update a wallpaper document
   */
  async upsert(wallpaper: WallpaperDocument): Promise<void> {
    const indexName = this.indexManager.getIndexName();
    return await withSpan(
      'opensearch.upsert',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: indexName,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'upsert',
        [GatewayAttributes.OPENSEARCH_DOC_ID]: wallpaper.wallpaperId,
        [Attributes.WALLPAPER_ID]: wallpaper.wallpaperId,
        [Attributes.USER_ID]: wallpaper.userId,
      },
      async () => {
        const startTime = Date.now();
        try {
          await this.openSearchConnection.getClient().index({
            index: indexName,
            id: wallpaper.wallpaperId,
            body: wallpaper,
            refresh: true, // Make immediately available for search (disable in production)
          });
          this.recordOperationMetrics('upsert', true, startTime);
        } catch (error) {
          this.recordOperationMetrics('upsert', false, startTime);
          throw error;
        }
      }
    );
  }

  /**
   * Add a variant to a wallpaper document
   */
  async addVariant(wallpaperId: string, variant: Variant): Promise<void> {
    const indexName = this.indexManager.getIndexName();
    return await withSpan(
      'opensearch.add_variant',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: indexName,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'add_variant',
        [GatewayAttributes.OPENSEARCH_DOC_ID]: wallpaperId,
        [Attributes.WALLPAPER_ID]: wallpaperId,
      },
      async (span) => {
        const startTime = Date.now();
        try {
          // Get existing document
          const result = await this.openSearchConnection.getClient().get({
            index: indexName,
            id: wallpaperId,
          });

          const doc = result.body._source as WallpaperDocument;

          // Add new variant
          doc.variants.push(variant);
          doc.updatedAt = new Date().toISOString();

          span.setAttribute('variant.count', doc.variants.length);

          // Update document
          await this.openSearchConnection.getClient().index({
            index: indexName,
            id: wallpaperId,
            body: doc,
            refresh: true,
          });

          this.recordOperationMetrics('add_variant', true, startTime);
        } catch (error) {
          this.recordOperationMetrics('add_variant', false, startTime);
          throw error;
        }
      }
    );
  }

  /**
   * Get a wallpaper document by ID
   */
  async findById(wallpaperId: string): Promise<WallpaperDocument | null> {
    const indexName = this.indexManager.getIndexName();
    return await withSpan(
      'opensearch.find_by_id',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: indexName,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'get',
        [GatewayAttributes.OPENSEARCH_DOC_ID]: wallpaperId,
        [Attributes.WALLPAPER_ID]: wallpaperId,
      },
      async (span) => {
        const startTime = Date.now();
        try {
          const result = await this.openSearchConnection.getClient().get({
            index: indexName,
            id: wallpaperId,
          });

          span.setAttribute(GatewayAttributes.OPENSEARCH_DOC_EXISTS, true);
          this.recordOperationMetrics('get', true, startTime);
          return result.body._source as WallpaperDocument;
        } catch (error) {
          if ((error as { meta?: { statusCode?: number } }).meta?.statusCode === 404) {
            span.setAttribute(GatewayAttributes.OPENSEARCH_DOC_EXISTS, false);
            this.recordOperationMetrics('get', true, startTime);
            return null;
          }
          this.recordOperationMetrics('get', false, startTime);
          throw error;
        }
      }
    );
  }

  /**
   * Search wallpapers with filters
   */
  async search(params: {
    userId?: string;
    variantFilters?: {
      width?: number;
      height?: number;
      aspectRatio?: number;
      format?: string;
    };
    from?: number;
    size?: number;
  }): Promise<{ documents: WallpaperDocument[]; total: number }> {
    const indexName = this.indexManager.getIndexName();
    const pageSize = params.size ?? 10;
    const offset = params.from ?? 0;

    return await withSpan(
      'opensearch.search',
      {
        [GatewayAttributes.OPENSEARCH_INDEX]: indexName,
        [GatewayAttributes.OPENSEARCH_OPERATION]: 'search',
        [GatewayAttributes.SEARCH_PAGE_SIZE]: pageSize,
        [GatewayAttributes.SEARCH_OFFSET]: offset,
        [GatewayAttributes.SEARCH_FILTER_USER_ID]: params.userId ?? 'none',
        [GatewayAttributes.SEARCH_FILTER_HAS_VARIANT]: params.variantFilters ? 'true' : 'false',
      },
      async (span) => {
        const startTime = Date.now();

        const must: unknown[] = [];

        // User filter
        if (params.userId) {
          must.push({ term: { userId: params.userId } });
        }

        // Variant filters using nested query
        if (params.variantFilters) {
          const variantMust: unknown[] = [];

          if (params.variantFilters.width) {
            variantMust.push({
              term: { 'variants.width': params.variantFilters.width },
            });
          }

          if (params.variantFilters.height) {
            variantMust.push({
              term: { 'variants.height': params.variantFilters.height },
            });
          }

          if (params.variantFilters.aspectRatio) {
            variantMust.push({
              term: { 'variants.aspectRatio': params.variantFilters.aspectRatio },
            });
          }

          if (params.variantFilters.format) {
            variantMust.push({
              term: { 'variants.format': params.variantFilters.format },
            });
          }

          if (variantMust.length > 0) {
            must.push({
              nested: {
                path: 'variants',
                query: {
                  bool: {
                    must: variantMust,
                  },
                },
              },
            });
          }
        }

        try {
          const result = await this.openSearchConnection.getClient().search({
            index: indexName,
            body: {
              query: {
                bool: {
                  must: must.length > 0 ? must : [{ match_all: {} }],
                },
              },
              from: offset,
              size: pageSize,
            },
          });

          const documents = result.body.hits.hits.map(
            (hit: { _source: WallpaperDocument }) => hit._source
          );
          const total = result.body.hits.total.value as number;

          span.setAttribute(GatewayAttributes.SEARCH_TOTAL_RESULTS, total);
          span.setAttribute(GatewayAttributes.GRAPHQL_RESULT_COUNT, documents.length);
          this.recordOperationMetrics('search', true, startTime);
          recordHistogram('opensearch.search.results', total, {
            [GatewayAttributes.OPENSEARCH_INDEX]: indexName,
          });

          return { documents, total };
        } catch (error) {
          this.recordOperationMetrics('search', false, startTime);
          throw error;
        }
      }
    );
  }

  /**
   * Record metrics for OpenSearch operations
   */
  private recordOperationMetrics(operation: string, success: boolean, startTime: number): void {
    const durationMs = Date.now() - startTime;
    const attributes = {
      [GatewayAttributes.OPENSEARCH_OPERATION]: operation,
      [Attributes.OPERATION_SUCCESS]: success,
    };

    recordCounter('opensearch.operation.total', 1, attributes);
    recordHistogram('opensearch.operation.duration_ms', durationMs, attributes);
  }
}
