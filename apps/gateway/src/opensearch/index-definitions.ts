import { wallpapersIndexMapping } from './mappings.js';

export interface IndexDefinition {
  key: string;
  name: string;
  mapping: {
    settings?: Record<string, unknown>;
    properties: Record<string, unknown>;
  };
}

export const wallpaperIndexDefinition = {
  key: 'wallpapers',
  name: 'wallpapers',
  mapping: wallpapersIndexMapping,
} satisfies IndexDefinition;

export const gatewayIndexDefinitions: readonly IndexDefinition[] = [wallpaperIndexDefinition];
