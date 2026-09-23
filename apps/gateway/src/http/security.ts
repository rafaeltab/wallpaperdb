import { Schema } from 'effect';
import type {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  GraphQLCompositeType,
  GraphQLField,
  GraphQLObjectType,
  GraphQLSchema,
  InlineFragmentNode,
  SelectionNode,
  SelectionSetNode,
} from 'graphql';
import {
  getArgumentValues,
  getDirectiveValues,
  getNamedType,
  getOperationAST,
  getVariableValues,
  GraphQLError,
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
  isAbstractType,
  isCompositeType,
  isObjectType,
  SchemaMetaFieldDef,
  TypeMetaFieldDef,
  TypeNameMetaFieldDef,
} from 'graphql';
import { resolvePageSize, resolveProfilePageSize } from '../catalogue/index.js';

export interface QueryLimits {
  readonly graphqlMaxDepth: number;
  readonly graphqlMaxUniqueFields: number;
  readonly graphqlMaxAliases: number;
  readonly graphqlMaxComplexity: number;
}
const fieldCosts: Record<string, number> = {
  'Query.searchWallpapers': 10,
  'Query.searchProfiles': 10,
  'Query.getWallpaper': 5,
  'Wallpaper.variants': 5,
  'Profile.wallpapers': 10,
  'Variant.url': 1,
};
const introspectionFields = new Map(
  [SchemaMetaFieldDef, TypeMetaFieldDef, TypeNameMetaFieldDef].map((field) => [field.name, field])
);
const paginationArguments = Schema.is(
  Schema.Struct({
    first: Schema.optional(Schema.NullOr(Schema.Number)),
    last: Schema.optional(Schema.NullOr(Schema.Number)),
  })
);
function listMultiplier(
  field: GraphQLField<unknown, unknown>,
  node: FieldNode,
  variables: Record<string, unknown>,
  profiles: boolean
): number | GraphQLError {
  const args = getArgumentValues(field, node, variables);
  if (!paginationArguments(args))
    return new GraphQLError('Invalid query arguments', { extensions: { code: 'BAD_USER_INPUT' } });
  const size = profiles
    ? resolveProfilePageSize({ first: args.first ?? undefined })
    : resolvePageSize({ first: args.first ?? undefined, last: args.last ?? undefined });
  return typeof size === 'number'
    ? size
    : new GraphQLError(size.reason, { extensions: { code: 'BAD_USER_INPUT' } });
}
interface FieldSelection {
  readonly node: FieldNode;
  readonly children: Set<SelectionSetNode>;
}
class QueryInspection {
  private readonly fields = new Set<string>();
  private aliases = 0;
  complexity = 0;
  error?: GraphQLError;

  constructor(
    private readonly schema: GraphQLSchema,
    private readonly fragments: Map<string, FragmentDefinitionNode>,
    private readonly variables: Record<string, unknown>,
    private readonly limits: QueryLimits
  ) {}

  private included(node: SelectionNode): boolean {
    return (
      getDirectiveValues(GraphQLSkipDirective, node, this.variables)?.if !== true &&
      getDirectiveValues(GraphQLIncludeDirective, node, this.variables)?.if !== false
    );
  }

  private matches(
    fragment: FragmentDefinitionNode | InlineFragmentNode,
    parent: GraphQLObjectType
  ): boolean {
    if (!fragment.typeCondition) return true;
    const condition = this.schema.getType(fragment.typeCondition.name.value);
    return (
      condition === parent ||
      (isAbstractType(condition) && this.schema.isSubType(condition, parent))
    );
  }

  private collect(
    selections: Iterable<SelectionSetNode>,
    parent: GraphQLObjectType
  ): Iterable<FieldSelection> {
    const fields = new Map<string, FieldSelection>();
    const visited = new Set<string>();
    const pending = [...selections];
    // Each fragment is collected once at this object position. Field children are merged
    // by response key, as GraphQL execution does, without expanding the fragment graph.
    for (const set of pending) {
      for (const node of set.selections) {
        if (!this.included(node)) continue;
        switch (node.kind) {
          case 'Field': {
            const key = node.alias?.value ?? node.name.value;
            const selection = fields.get(key) ?? { node, children: new Set<SelectionSetNode>() };
            if (node.selectionSet) selection.children.add(node.selectionSet);
            fields.set(key, selection);
            break;
          }
          case 'InlineFragment':
            if (this.matches(node, parent)) pending.push(node.selectionSet);
            break;
          case 'FragmentSpread': {
            if (visited.has(node.name.value)) break;
            visited.add(node.name.value);
            const fragment = this.fragments.get(node.name.value);
            if (fragment && this.matches(fragment, parent)) pending.push(fragment.selectionSet);
            break;
          }
        }
      }
    }
    return fields.values();
  }

  inspect(
    selections: Iterable<SelectionSetNode>,
    parent: GraphQLCompositeType,
    depth = 1,
    multiplicity = 1,
    connectionSize?: number
  ): void {
    const types = isObjectType(parent) ? [parent] : this.schema.getPossibleTypes(parent);
    for (const type of types) {
      for (const selection of this.collect(selections, type)) {
        if (this.error) return;
        this.inspectField(selection, type, depth, multiplicity, connectionSize);
      }
    }
  }

  private inspectField(
    { node, children }: FieldSelection,
    parent: GraphQLObjectType,
    depth: number,
    multiplicity: number,
    connectionSize: number | undefined
  ): void {
    const field = parent.getFields()[node.name.value] ?? introspectionFields.get(node.name.value);
    if (!field) return;
    const name = `${parent.name}.${node.name.value}`;
    const pageSize =
      name === 'Query.searchWallpapers' ||
      name === 'Query.searchProfiles' ||
      name === 'Profile.wallpapers'
        ? listMultiplier(field, node, this.variables, name === 'Query.searchProfiles')
        : undefined;
    if (pageSize instanceof GraphQLError) {
      this.error = pageSize;
      return;
    }
    this.fields.add(node.name.value);
    if (node.alias) this.aliases++;
    this.complexity +=
      multiplicity *
      (fieldCosts[name] ?? 1) *
      (pageSize ?? (name === 'Wallpaper.variants' ? 5 : 1));
    this.error = this.checkLimits(depth);
    if (this.error) return;
    const type = getNamedType(field.type);
    if (!isCompositeType(type)) return;
    const childMultiplicity =
      name === 'WallpaperConnection.edges' || name === 'ProfileConnection.edges'
        ? (connectionSize ?? 1)
        : name === 'Wallpaper.variants'
          ? 5
          : 1;
    this.inspect(children, type, depth + 1, multiplicity * childMultiplicity, pageSize);
  }

  private checkLimits(depth: number): GraphQLError | undefined {
    const limits = this.limits;
    if (depth > limits.graphqlMaxDepth)
      return new GraphQLError(`Query depth ${depth} exceeds maximum ${limits.graphqlMaxDepth}`, {
        extensions: { code: 'DEPTH_LIMIT_EXCEEDED', depth, maxDepth: limits.graphqlMaxDepth },
      });
    if (this.fields.size > limits.graphqlMaxUniqueFields)
      return new GraphQLError(
        `Query has ${this.fields.size} unique fields, maximum is ${limits.graphqlMaxUniqueFields}`,
        {
          extensions: {
            code: 'BREADTH_LIMIT_EXCEEDED',
            unique_fields: this.fields.size,
            max_unique_fields: limits.graphqlMaxUniqueFields,
          },
        }
      );
    if (this.aliases > limits.graphqlMaxAliases)
      return new GraphQLError(
        `Query has ${this.aliases} aliases, maximum is ${limits.graphqlMaxAliases}`,
        {
          extensions: {
            code: 'BREADTH_LIMIT_EXCEEDED',
            aliases: this.aliases,
            max_aliases: limits.graphqlMaxAliases,
          },
        }
      );
    if (this.complexity > limits.graphqlMaxComplexity)
      return new GraphQLError(
        `Query complexity ${this.complexity} exceeds maximum ${limits.graphqlMaxComplexity}`,
        {
          extensions: {
            code: 'COMPLEXITY_LIMIT_EXCEEDED',
            complexity: this.complexity,
            maxComplexity: limits.graphqlMaxComplexity,
          },
        }
      );
    return undefined;
  }
}
export function inspectQuery(
  schema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  limits: QueryLimits,
  operationName?: string
): { complexity: number; error?: GraphQLError } {
  const operation = getOperationAST(document, operationName);
  const root = operation && schema.getRootType(operation.operation);
  if (!operation || !root)
    return { complexity: 0, error: new GraphQLError('Unable to select a GraphQL operation') };
  const resolved = getVariableValues(schema, operation.variableDefinitions ?? [], variables);
  if (resolved.errors) return { complexity: 0, error: resolved.errors[0] };
  const fragments = new Map(
    document.definitions
      .filter((node) => node.kind === 'FragmentDefinition')
      .map((node) => [node.name.value, node])
  );
  const inspection = new QueryInspection(schema, fragments, resolved.coerced, limits);
  inspection.inspect([operation.selectionSet], root);
  return { complexity: inspection.complexity, error: inspection.error };
}
