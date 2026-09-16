import type { HttpExecution } from '../runtime.js';
import { GraphqlAdapter, type MediaUrls } from './resolvers.js';
import { schema } from './schema.js';
export type { MediaUrls } from './resolvers.js';
/** Mercurius driving adapter. The composition root supplies the inbound capability. */
export function createGraphql(execution: HttpExecution['Service'], media: MediaUrls) {
  const adapter = new GraphqlAdapter(execution, media);
  return { schema, resolvers: adapter.resolvers(), loaders: adapter.loaders() };
}
