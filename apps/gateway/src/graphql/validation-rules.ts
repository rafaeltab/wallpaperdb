import type { ValidationRule } from 'graphql';
import { NoSchemaIntrospectionCustomRule } from 'graphql';
import type { Config } from '../config.js';

/**
 * Get GraphQL validation rules based on configuration
 *
 * @param config - Application configuration
 * @returns Array of validation rules to apply
 */
export function getValidationRules(config: Config): ValidationRule[] {
  const rules: ValidationRule[] = [];

  // Disable introspection in production or when explicitly disabled
  if (config.nodeEnv === 'production' || !config.graphqlIntrospectionEnabled) {
    rules.push(NoSchemaIntrospectionCustomRule);
  }

  return rules;
}
