import mercurius, { type MercuriusOptions } from 'mercurius';
import type { HttpExecution } from '../runtime.js';
import { GraphqlAdapter, type MediaUrls } from './resolvers.js';
import { schema } from './schema.js';
export type { MediaUrls } from './resolvers.js';
const errorFormatter: NonNullable<MercuriusOptions['errorFormatter']> = (execution, context) => {
  const formatted = mercurius.defaultErrorFormatter(execution, context);
  if (
    !execution.data &&
    execution.errors.some(
      (error) =>
        error.originalError &&
        'code' in error.originalError &&
        error.originalError.code === 'MER_ERR_GQL_VALIDATION'
    )
  )
    return { ...formatted, statusCode: 400 };
  return formatted;
};
/** Mercurius driving adapter. The composition root supplies the inbound capability. */
export function createGraphql(execution: HttpExecution['Service'], media: MediaUrls) {
  const adapter = new GraphqlAdapter(execution, media);
  return { schema, resolvers: adapter.resolvers(), loaders: adapter.loaders(), errorFormatter };
}
