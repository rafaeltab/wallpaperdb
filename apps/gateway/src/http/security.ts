import type { DocumentNode, FieldNode, GraphQLSchema, ValueNode } from 'graphql';
import { GraphQLError, TypeInfo, visit, visitWithTypeInfo } from 'graphql';

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
function argumentValue(value: ValueNode, variables: Record<string, unknown>): number | undefined {
  if (value.kind === 'IntValue') return Number.parseInt(value.value, 10);
  if (value.kind !== 'Variable') return undefined;
  const variable = variables[value.name.value];
  return typeof variable === 'number' ? variable : undefined;
}
function listMultiplier(node: FieldNode, variables: Record<string, unknown>): number {
  const argument =
    node.arguments?.find((arg) => arg.name.value === 'first') ??
    node.arguments?.find((arg) => arg.name.value === 'last');
  return argument ? Math.max(1, Math.min(argumentValue(argument.value, variables) ?? 10, 100)) : 1;
}
export function inspectQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  limits: QueryLimits
): { complexity: number; error?: GraphQLError } {
  const fields = new Set<string>();
  let aliases = 0;
  let complexity = 0;
  const typeInfo = new TypeInfo(schema);
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      Field(node) {
        fields.add(node.name.value);
        if (node.alias) aliases++;
        const parent = typeInfo.getParentType();
        const name = parent ? `${parent.name}.${node.name.value}` : node.name.value;
        complexity +=
          (fieldCosts[name] ?? 1) *
          listMultiplier(node, variables) *
          (name === 'Wallpaper.variants' ? 5 : 1);
      },
    })
  );
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
