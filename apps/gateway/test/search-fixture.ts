import { randomUUID } from 'node:crypto';
import { Client } from '@opensearch-project/opensearch';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    gatewaySearch: { url: string; username: string; password: string };
  }
}

/** Unique persistence per fixture, including concurrent fixtures within one test file. */
export function createSearchFixture() {
  const connection = inject('gatewaySearch');
  const prefix = `gateway_${randomUUID()}_`;
  const index = (name: string) => `${prefix}${name}`;
  return {
    options: {
      ...connection,
      wallpaperIndex: index('wallpapers'),
      profileIndex: index('profiles'),
    },
    index,
    async destroy() {
      const client = new Client({ node: connection.url });
      try {
        await client.indices.delete({
          index: `${prefix}*`,
          expand_wildcards: 'all',
          ignore_unavailable: true,
          allow_no_indices: true,
        });
      } finally {
        await client.close();
      }
    },
  };
}
