import { GraphQLClient, type RequestMiddleware } from 'graphql-request';
import { admissionError } from '@/lib/graphql/admission';
import { getAuthToken } from '@/lib/auth/token-provider';

function resolveGatewayUrl(url: string): string {
  if (url.startsWith('/') && typeof window !== 'undefined') {
    return new URL(url, window.location.origin).toString();
  }

  return url;
}

const GATEWAY_URL = resolveGatewayUrl(import.meta.env.VITE_GATEWAY_URL || '/gateway/graphql');

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
  fetch: async (...args) => {
    const response = await fetch(...args);
    const error = admissionError(response);
    if (error) throw error;
    return response;
  },
});

export const request = graphqlClient.request.bind(graphqlClient);
