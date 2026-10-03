import {
  GatewayAdmissionError,
  retryAfterDelay,
  shouldRetryRequest,
  requestRetryDelay,
  shouldRefreshRequest,
} from '../index';
export { GatewayAdmissionError } from '../index';
export function admissionError(response: Response): GatewayAdmissionError | undefined {
  if (response.status !== 429 && response.status !== 503) return;
  const header = response.headers.get('Retry-After')?.trim();
  const parsed: { seconds?: number; deadline?: number } = {};
  if (header && /^\d+(\.\d+)?$/.test(header)) parsed.seconds = Number(header);
  else if (header && !/^-?\d/.test(header)) {
    const timestamp = Date.parse(header);
    if (Number.isFinite(timestamp)) parsed.deadline = timestamp;
  }
  const retryAfterMs = retryAfterDelay(parsed, Date.now());
  return new GatewayAdmissionError(response.status, retryAfterMs);
}

function canRefresh(query: { state: { error: unknown } }) {
  return shouldRefreshRequest(query.state.error);
}

// All GraphQL consumers, including fetchQuery in route loaders, share this budget.
export const graphqlQueryOptions = {
  retry: shouldRetryRequest,
  retryDelay: (_attempt: number, error: Error) => requestRetryDelay(error, Math.random()),
  retryOnMount: false,
  refetchOnMount: canRefresh,
  refetchOnReconnect: canRefresh,
  refetchOnWindowFocus: false,
};
