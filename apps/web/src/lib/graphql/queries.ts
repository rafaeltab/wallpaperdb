import { gql } from 'graphql-request';

export const SEARCH_WALLPAPERS = gql`
  query SearchWallpapers(
    $filter: WallpaperFilter
    $first: Int
    $after: String
  ) {
    searchWallpapers(filter: $filter, first: $first, after: $after) {
      edges {
        node {
          wallpaperId
          userId
          uploadedAt
          updatedAt
          variants {
            width
            height
            aspectRatio
            format
            fileSizeBytes
            createdAt
            url
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export const GET_WALLPAPER = gql`
  query GetWallpaper($wallpaperId: ID!) {
    getWallpaper(wallpaperId: $wallpaperId) {
      wallpaperId
      userId
      uploadedAt
      updatedAt
      variants {
        width
        height
        aspectRatio
        format
        fileSizeBytes
        createdAt
        url
      }
    }
  }
`;
