import { randomUUID } from 'node:crypto';
import { Client } from '@opensearch-project/opensearch';
import { inject } from 'vitest';
import { Layer, ManagedRuntime } from 'effect';
import {
  OpenSearchGateway,
  openSearchLayer,
  type OpenSearchGatewayOptions,
} from '../src/adapters/opensearch/index.js';
import { ProjectCatalogue, projectionLayer } from '../src/projection/index.js';

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

export async function acquireSearchFixture(options: OpenSearchGatewayOptions) {
  const runtime = ManagedRuntime.make(
    projectionLayer.pipe(Layer.provideMerge(openSearchLayer(options)))
  );
  try {
    const adapter = await runtime.runPromise(OpenSearchGateway);
    const project = await runtime.runPromise(ProjectCatalogue);
    return { adapter, project, dispose: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
