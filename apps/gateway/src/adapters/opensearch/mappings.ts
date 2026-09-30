import { colorUtilityFields } from '../../capabilities/catalogue/index.js';
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
  settings: { 'index.mapping.total_fields.limit': 10100 },
  source: { excludes: ['utilities'] },
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

    utilities: {
      type: 'object',
      dynamic: 'strict',
      properties: Object.fromEntries(
        colorUtilityFields.map((key) => [key, { type: 'float', index: true, doc_values: true }])
      ),
    },
    colorReady: { type: 'keyword' },
    colorSnapshot: { type: 'object', enabled: false },
    colorOrder: { type: 'keyword', index: false },
    variantOrder: { type: 'object', enabled: false },

    // Timestamps
    uploadedAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};

export const profilesIndexMapping = {
  properties: {
    id: { type: 'keyword' },
    displayName: { type: 'text' },
    handle: { type: 'keyword' },
    claimGeneration: { type: 'long' },
    aliases: {
      type: 'nested',
      properties: {
        handle: { type: 'keyword' },
        claimGeneration: { type: 'long' },
        createdAt: { type: 'date' },
        expiresAt: { type: 'date' },
      },
    },
    biographyMarkdown: { type: 'text', index: false },
    pictureAssetId: { type: 'keyword' },
    version: { type: 'long' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};
