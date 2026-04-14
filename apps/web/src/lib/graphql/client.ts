import { GraphQLClient, type RequestMiddleware } from 'graphql-request';
import { getAuthToken } from '@/lib/auth/token-provider';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3004/graphql';

const authMiddleware: RequestMiddleware = async (request) => {
  const token = await getAuthToken();
  if (token) {
    return {
      ...request,
      headers: {
        ...(request.headers as Record<string, string>),
        Authorization: `Bearer ${token}`,
      },
    };
  }
  return request;
};

export const graphqlClient = new GraphQLClient(GATEWAY_URL, {
  requestMiddleware: authMiddleware,
});

export const request = graphqlClient.request.bind(graphqlClient);
