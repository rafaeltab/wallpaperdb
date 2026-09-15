import type { Catalogue } from '../catalogue/index.js';
import { GraphqlAdapter, type MediaUrls } from './resolvers.js';
import { schema } from './schema.js';
export type { MediaUrls } from './resolvers.js';
/** Mercurius driving adapter. The composition root supplies the inbound capability. */
export function createGraphql(catalogue: Catalogue, media: MediaUrls) {
  const adapter = new GraphqlAdapter(catalogue, media);
  return { schema, resolvers: adapter.resolvers(), loaders: adapter.loaders() };
}
