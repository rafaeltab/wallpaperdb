import { inject, singleton } from 'tsyringe';
import { OpenSearchConnection } from '../connections/opensearch.js';
import { IndexManagerService } from '../services/index-manager.service.js';

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
    await this.openSearchConnection.getClient().index({
      index: this.indexManager.getIndexName(),
      id: wallpaper.wallpaperId,
      body: wallpaper,
      refresh: true, // Make immediately available for search (disable in production)
    });
  }

  /**
   * Add a variant to a wallpaper document
   */
  async addVariant(wallpaperId: string, variant: Variant): Promise<void> {
    // Get existing document
    const result = await this.openSearchConnection.getClient().get({
      index: this.indexManager.getIndexName(),
      id: wallpaperId,
    });

    const doc = result.body._source as WallpaperDocument;

    // Add new variant
    doc.variants.push(variant);
    doc.updatedAt = new Date().toISOString();

    // Update document
    await this.openSearchConnection.getClient().index({
      index: this.indexManager.getIndexName(),
      id: wallpaperId,
      body: doc,
      refresh: true,
    });
  }

  /**
   * Get a wallpaper document by ID
   */
  async findById(wallpaperId: string): Promise<WallpaperDocument | null> {
    try {
      const result = await this.openSearchConnection.getClient().get({
        index: this.indexManager.getIndexName(),
        id: wallpaperId,
      });

      return result.body._source as WallpaperDocument;
    } catch (error) {
      if ((error as { meta?: { statusCode?: number } }).meta?.statusCode === 404) {
        return null;
      }
      throw error;
    }
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

    const result = await this.openSearchConnection.getClient().search({
      index: this.indexManager.getIndexName(),
      body: {
        query: {
          bool: {
            must: must.length > 0 ? must : [{ match_all: {} }],
          },
        },
        from: params.from ?? 0,
        size: params.size ?? 10,
      },
    });

    const documents = result.body.hits.hits.map(
      (hit: { _source: WallpaperDocument }) => hit._source
    );

    return {
      documents,
      total: result.body.hits.total.value,
    };
  }
}
