/**
 * OpenSearch index mappings for the Gateway service
 */

/**
 * Mapping for the wallpapers index
 *
 * Key design decisions:
 * - variants is a nested type for independent querying
 * - aspectRatio is stored for efficient filtering
 * - format enum for easy filtering by image type
 */
export const wallpapersIndexMapping = {
  settings: {
    index: {
      knn: true,
    },
  },
  properties: {
    wallpaperId: { type: 'keyword' },
    userId: { type: 'keyword' },

    // Variants as nested objects (independent from parent document)
    variants: {
      type: 'nested',
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
        aspectRatio: { type: 'float' },
        format: { type: 'keyword' }, // jpeg, png, webp
        fileSizeBytes: { type: 'long' },
        createdAt: { type: 'date' },
      },
    },

    colorHistogram: {
      type: 'knn_vector',
      dimension: 64,
      method: {
        name: 'hnsw',
        engine: 'lucene',
        space_type: 'cosinesimil',
      },
    },
    colorSpace: { type: 'keyword' },

    // Timestamps
    uploadedAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};
