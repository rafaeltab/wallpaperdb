import { GraphQLClient } from 'graphql-request';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3004/graphql';

export const graphqlClient = new GraphQLClient(GATEWAY_URL, {
  headers: {
    // Future: Add auth headers
  },
});

// Export request method for use in hooks
export const request = graphqlClient.request.bind(graphqlClient);
