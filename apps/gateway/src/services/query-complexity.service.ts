import { recordCounter } from '@wallpaperdb/core/telemetry';
import type { DocumentNode, FieldNode, ValueNode } from 'graphql';
import { visit } from 'graphql';
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

    // Computed fields
    'Variant.url': 1, // Cheap computed field

    // Default cost
    DEFAULT_FIELD: 1,
  };

  // Average nested list sizes (based on actual data patterns)
  private readonly AVERAGE_NESTED_SIZES: Record<string, number> = {
    variants: 5, // Average variants per wallpaper
  };

  // Note: LIST_MULTIPLIER is implicit in cost calculations (see getListMultiplier)

  /**
   * Calculate the complexity of a GraphQL document
   */
  calculateComplexity(document: DocumentNode, variables: Record<string, unknown>): number {
    let totalCost = 0;

    visit(document, {
      Field: (node) => {
        const fieldName = this.getFieldName(node);
        const fieldCost = this.FIELD_COSTS[fieldName] ?? this.FIELD_COSTS.DEFAULT_FIELD;

        // Calculate list multiplier from arguments (first, last)
        const listMultiplier = this.getListMultiplier(node, variables);

        // Calculate nested multiplier for nested lists
        const nestedMultiplier = this.getNestedMultiplier(node);

        totalCost += fieldCost * listMultiplier * nestedMultiplier;
      },
    });

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
   * Get fully qualified field name (Type.field)
   */
  private getFieldName(node: FieldNode): string {
    // For now, return just the field name
    // In a more sophisticated implementation, we'd track the parent type
    return node.name.value;
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
  private getNestedMultiplier(node: FieldNode): number {
    const fieldName = node.name.value;

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
