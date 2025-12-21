/**
 * Gateway-specific attribute keys for OpenTelemetry spans and metrics.
 * Extends the core Attributes with GraphQL and OpenSearch context.
 */
export const GatewayAttributes = {
  // GraphQL context
  GRAPHQL_OPERATION_NAME: 'graphql.operation.name',
  GRAPHQL_OPERATION_TYPE: 'graphql.operation.type',
  GRAPHQL_FIELD_NAME: 'graphql.field.name',
  GRAPHQL_PARENT_TYPE: 'graphql.parent.type',
  GRAPHQL_RESULT_COUNT: 'graphql.result.count',

  // Search context
  SEARCH_FILTER_USER_ID: 'search.filter.user_id',
  SEARCH_FILTER_HAS_VARIANT: 'search.filter.has_variant',
  SEARCH_PAGE_SIZE: 'search.page.size',
  SEARCH_OFFSET: 'search.offset',
  SEARCH_TOTAL_RESULTS: 'search.total.results',
  SEARCH_HAS_NEXT_PAGE: 'search.has_next_page',
  SEARCH_HAS_PREV_PAGE: 'search.has_prev_page',

  // OpenSearch context
  OPENSEARCH_INDEX: 'opensearch.index',
  OPENSEARCH_OPERATION: 'opensearch.operation',
  OPENSEARCH_DOC_ID: 'opensearch.document.id',
  OPENSEARCH_DOC_EXISTS: 'opensearch.document.exists',
} as const;

export type GatewayAttributeKey = (typeof GatewayAttributes)[keyof typeof GatewayAttributes];
