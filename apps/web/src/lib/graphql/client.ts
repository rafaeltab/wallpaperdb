import { GraphQLClient, type RequestMiddleware } from 'graphql-request';
import { getAuthToken } from '@/lib/auth/token-provider';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3004/graphql';

const authMiddleware: RequestMiddleware = async (request) => {
  const token = await getAuthToken();
  if (token) {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);

    return {
      ...request,
      headers,
    };
  }
  return request;
};

export const graphqlClient = new GraphQLClient(GATEWAY_URL, {
  requestMiddleware: authMiddleware,
});

export const request = graphqlClient.request.bind(graphqlClient);
