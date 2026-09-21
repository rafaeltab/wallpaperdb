import { Schema } from 'effect';
import type { DocumentNode, FieldNode, GraphQLField, GraphQLSchema } from 'graphql';
import {
  BREAK,
  getArgumentValues,
  getOperationAST,
  getVariableValues,
  GraphQLError,
  separateOperations,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from 'graphql';
import { resolvePageSize } from '../catalogue/index.js';

export interface QueryLimits {
  readonly graphqlMaxUniqueFields: number;
  readonly graphqlMaxAliases: number;
  readonly graphqlMaxComplexity: number;
}
const fieldCosts: Record<string, number> = {
  'Query.searchWallpapers': 10,
  'Query.getWallpaper': 5,
  'Wallpaper.variants': 5,
  'Profile.wallpapers': 10,
  'Variant.url': 1,
};
const paginationArguments = Schema.is(
  Schema.Struct({
    first: Schema.optional(Schema.NullOr(Schema.Number)),
    last: Schema.optional(Schema.NullOr(Schema.Number)),
  })
);
function listMultiplier(
  field: GraphQLField<unknown, unknown>,
  node: FieldNode,
  variables: Record<string, unknown>
): number | GraphQLError {
  const args = getArgumentValues(field, node, variables);
  if (!paginationArguments(args))
    return new GraphQLError('Invalid query arguments', { extensions: { code: 'BAD_USER_INPUT' } });
  const size = resolvePageSize({ first: args.first ?? undefined, last: args.last ?? undefined });
  return typeof size === 'number'
    ? size
    : new GraphQLError(size.reason, { extensions: { code: 'BAD_USER_INPUT' } });
}
export function inspectQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  limits: QueryLimits,
  operationName?: string
): { complexity: number; error?: GraphQLError } {
  const operation = getOperationAST(document, operationName);
  const selectedDocument = operation && separateOperations(document)[operation.name?.value ?? ''];
  if (!operation || !selectedDocument)
    return { complexity: 0, error: new GraphQLError('Unable to select a GraphQL operation') };
  const resolved = getVariableValues(schema, operation.variableDefinitions ?? [], variables);
  if (resolved.errors) return { complexity: 0, error: resolved.errors[0] };
  const fields = new Set<string>();
  let aliases = 0;
  let complexity = 0;
  let error: GraphQLError | undefined;
  const typeInfo = new TypeInfo(schema);
  visit(
    selectedDocument,
    visitWithTypeInfo(typeInfo, {
      Field(node) {
        fields.add(node.name.value);
        if (node.alias) aliases++;
        const parent = typeInfo.getParentType();
        const name = parent ? `${parent.name}.${node.name.value}` : node.name.value;
        const field = typeInfo.getFieldDef();
        const multiplier =
          field && (name === 'Query.searchWallpapers' || name === 'Profile.wallpapers')
            ? listMultiplier(field, node, resolved.coerced)
            : 1;
        if (typeof multiplier !== 'number') {
          error = multiplier;
          return BREAK;
        }
        complexity +=
          (fieldCosts[name] ?? 1) * multiplier * (name === 'Wallpaper.variants' ? 5 : 1);
        return undefined;
      },
    })
  );
  if (error) return { complexity, error };
  if (fields.size > limits.graphqlMaxUniqueFields) {
    return {
      complexity,
      error: new GraphQLError(
        `Query has ${fields.size} unique fields, maximum is ${limits.graphqlMaxUniqueFields}`,
        {
          extensions: {
            code: 'BREADTH_LIMIT_EXCEEDED',
            unique_fields: fields.size,
            max_unique_fields: limits.graphqlMaxUniqueFields,
          },
        }
      ),
    };
  }
  if (aliases > limits.graphqlMaxAliases) {
    return {
      complexity,
      error: new GraphQLError(
        `Query has ${aliases} aliases, maximum is ${limits.graphqlMaxAliases}`,
        {
          extensions: {
            code: 'BREADTH_LIMIT_EXCEEDED',
            aliases,
            max_aliases: limits.graphqlMaxAliases,
          },
        }
      ),
    };
  }
  if (complexity > limits.graphqlMaxComplexity) {
    return {
      complexity,
      error: new GraphQLError(
        `Query complexity ${complexity} exceeds maximum ${limits.graphqlMaxComplexity}`,
        {
          extensions: {
            code: 'COMPLEXITY_LIMIT_EXCEEDED',
            complexity,
            maxComplexity: limits.graphqlMaxComplexity,
          },
        }
      ),
    };
  }
  return { complexity };
}
