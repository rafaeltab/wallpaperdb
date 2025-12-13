// Manual types matching Gateway schema (apps/gateway/src/graphql/schema.ts)

export interface Wallpaper {
  wallpaperId: string;
  userId: string;
  variants: Variant[];
  uploadedAt: string;
  updatedAt: string;
}

export interface Variant {
  width: number;
  height: number;
  aspectRatio: number;
  format: string;
  fileSizeBytes: number;
  createdAt: string;
  url: string; // Computed by Gateway - no need to construct URLs manually
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface WallpaperEdge {
  node: Wallpaper;
}

export interface WallpaperConnection {
  edges: WallpaperEdge[];
  pageInfo: PageInfo;
}

export interface WallpaperFilter {
  userId?: string;
  variants?: VariantFilter;
}

export interface VariantFilter {
  width?: number;
  height?: number;
  aspectRatio?: number;
  format?: string;
}
