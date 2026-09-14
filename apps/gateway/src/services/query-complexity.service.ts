import { recordCounter } from '@wallpaperdb/core/telemetry';
import type { DocumentNode, FieldNode, FragmentDefinitionNode, GraphQLSchema, ValueNode } from 'graphql';
import { BREAK, Kind, TypeInfo, visit, visitWithTypeInfo } from 'graphql';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { BreadthLimitError, ComplexityLimitError } from '../errors/graphql-errors.js';

/**
 * Service for analyzing GraphQL query complexity and breadth
 */
@singleton()
export class QueryComplexityService {
  constructor(@inject('config') private readonly config: Config) {}

  // Cost configuration based on schema
  private readonly FIELD_COSTS: Record<string, number> = {
    // Base query costs
    'Query.searchWallpapers': 10,
    'Query.getWallpaper': 5,

    // Expensive nested fields
    'Wallpaper.variants': 5, // Array of variants
    'Profile.wallpapers': 10,

    // Computed fields
    'Variant.url': 1, // Cheap computed field

    // Default cost
    DEFAULT_FIELD: 1,
  };

  // Average nested list sizes (based on actual data patterns)
  private readonly AVERAGE_NESTED_SIZES: Record<string, number> = {
    'Wallpaper.variants': 5, // Average variants per wallpaper
  };

  // Note: LIST_MULTIPLIER is implicit in cost calculations (see getListMultiplier)

  /**
   * Calculate the complexity of a GraphQL document
   */
  calculateComplexity(
    schema: GraphQLSchema,
    document: DocumentNode,
    variables: Record<string, unknown>
  ): number {
    let totalCost = 0;
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of document.definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(definition.name.value, definition);
      }
    }

    for (const operation of document.definitions) {
      if (operation.kind !== Kind.OPERATION_DEFINITION) continue;
      const typeInfo = new TypeInfo(schema);
      let multiplier = 1;
      let pageSize = 1;
      const ancestors: Array<{ multiplier: number; pageSize: number }> = [];
      const activeFragments = new Set<string>();

      const visitor = visitWithTypeInfo(typeInfo, {
        Field: {
          enter: (node) => {
            ancestors.push({ multiplier, pageSize });
            const parentType = typeInfo.getParentType();
            const fieldName = parentType ? `${parentType.name}.${node.name.value}` : node.name.value;
            const fieldCost = this.FIELD_COSTS[fieldName] ?? this.FIELD_COSTS.DEFAULT_FIELD;

            // Only connection edges repeat per result; pageInfo is resolved once.
            if (fieldName === 'WallpaperConnection.edges') multiplier *= pageSize;
            const listMultiplier = this.getListMultiplier(node, variables);
            totalCost += fieldCost * multiplier * listMultiplier * this.getNestedMultiplier(fieldName);

            if (totalCost > this.config.graphqlMaxComplexity) return BREAK;
            if (fieldName === 'Query.searchWallpapers' || fieldName === 'Profile.wallpapers') {
              pageSize = listMultiplier;
            }
            return undefined;
          },
          leave: () => {
            const ancestor = ancestors.pop();
            if (ancestor) ({ multiplier, pageSize } = ancestor);
          },
        },
        FragmentSpread: (node) => {
          const name = node.name.value;
          const fragment = fragments.get(name);
          if (!fragment) return undefined;
          if (activeFragments.has(name)) {
            totalCost = this.config.graphqlMaxComplexity + 1;
            return BREAK;
          }
          activeFragments.add(name);
          visit(fragment, visitor);
          activeFragments.delete(name);
          if (totalCost > this.config.graphqlMaxComplexity) return BREAK;
          return undefined;
        },
      });
      visit(operation, visitor);

      // Stop expanding fragments as soon as rejection is certain.
      if (totalCost > this.config.graphqlMaxComplexity) {
        return this.config.graphqlMaxComplexity + 1;
      }
    }

    return totalCost;
  }

  /**
   * Check query breadth (unique fields and aliases)
   */
  checkBreadth(document: DocumentNode): void {
    const uniqueFields = new Set<string>();
    let aliasCount = 0;

    visit(document, {
      Field: (node) => {
        // Track unique field names
        uniqueFields.add(node.name.value);

        // Count aliases
        if (node.alias) {
          aliasCount++;
        }
      },
    });

    // Check unique fields limit
    if (uniqueFields.size > this.config.graphqlMaxUniqueFields) {
      recordCounter('graphql.security.breadth_exceeded', 1, {
        type: 'unique_fields',
        count: uniqueFields.size,
        threshold: this.config.graphqlMaxUniqueFields,
      });

      throw new BreadthLimitError(
        uniqueFields.size,
        this.config.graphqlMaxUniqueFields,
        'unique_fields'
      );
    }

    // Check aliases limit
    if (aliasCount > this.config.graphqlMaxAliases) {
      recordCounter('graphql.security.breadth_exceeded', 1, {
        type: 'aliases',
        count: aliasCount,
        threshold: this.config.graphqlMaxAliases,
      });

      throw new BreadthLimitError(aliasCount, this.config.graphqlMaxAliases, 'aliases');
    }
  }

  /**
   * Validate query complexity against configured limit
   */
  validateComplexity(complexity: number): void {
    if (complexity > this.config.graphqlMaxComplexity) {
      recordCounter('graphql.security.complexity_exceeded', 1, {
        complexity,
        threshold: this.config.graphqlMaxComplexity,
      });

      throw new ComplexityLimitError(complexity, this.config.graphqlMaxComplexity);
    }
  }

  /**
   * Get list multiplier from pagination arguments
   */
  private getListMultiplier(node: FieldNode, variables: Record<string, unknown>): number {
    // Check for 'first' argument
    const firstArg = node.arguments?.find((arg) => arg.name.value === 'first');
    if (firstArg) {
      const value = this.getArgumentValue(firstArg.value, variables);
      // Cap at 100 to prevent overflow in cost calculation
      return Math.min(value ?? 10, 100);
    }

    // Check for 'last' argument
    const lastArg = node.arguments?.find((arg) => arg.name.value === 'last');
    if (lastArg) {
      const value = this.getArgumentValue(lastArg.value, variables);
      return Math.min(value ?? 10, 100);
    }

    return 1; // No list multiplier
  }

  /**
   * Get nested list multiplier for fields that return nested lists
   */
  private getNestedMultiplier(fieldName: string): number {
    // Check if this field returns a nested list
    if (this.AVERAGE_NESTED_SIZES[fieldName]) {
      return this.AVERAGE_NESTED_SIZES[fieldName];
    }

    return 1; // No nested multiplier
  }

  /**
   * Extract argument value from AST (handles literals and variables)
   */
  private getArgumentValue(
    value: ValueNode,
    variables: Record<string, unknown>
  ): number | undefined {
    // Handle literal int values
    if (value.kind === 'IntValue') {
      return Number.parseInt(value.value, 10);
    }

    // Handle variable references
    if (value.kind === 'Variable') {
      const varValue = variables[value.name.value];
      return typeof varValue === 'number' ? varValue : undefined;
    }

    return undefined;
  }
}
