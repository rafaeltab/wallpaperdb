export class GatewayAdmissionError extends Error {
  readonly name = 'GatewayAdmissionError';
  readonly status: 429 | 503;
  readonly retryAfterMs: number;

  constructor(status: 429 | 503, retryAfterMs: number) {
    super(
      status === 429
        ? 'This network has reached its usage limit. Please wait before trying again.'
        : 'The server is busy. Please try again shortly.'
    );
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function admissionError(response: Response): GatewayAdmissionError | undefined {
  if (response.status !== 429 && response.status !== 503) return;
  const header = response.headers.get('Retry-After')?.trim();
  let retryAfterMs = 60_000;
  if (header && /^\d+(\.\d+)?$/.test(header)) {
    retryAfterMs = Number(header) * 1000;
  } else if (header && !/^-?\d/.test(header)) {
    const timestamp = Date.parse(header);
    if (Number.isFinite(timestamp)) retryAfterMs = Math.max(0, timestamp - Date.now());
  }
  return new GatewayAdmissionError(response.status, retryAfterMs);
}

function canRefresh(query: { state: { error: unknown } }) {
  return !(query.state.error instanceof GatewayAdmissionError);
}

// All GraphQL consumers, including fetchQuery in route loaders, share this budget.
export const graphqlQueryOptions = {
  retry: (failureCount: number, error: Error) =>
    error instanceof GatewayAdmissionError && error.status === 429 && failureCount === 0,
  retryDelay: (_attempt: number, error: Error) =>
    error instanceof GatewayAdmissionError
      ? error.retryAfterMs + 100 + Math.floor(Math.random() * 400)
      : 0,
  retryOnMount: false,
  refetchOnMount: canRefresh,
  refetchOnReconnect: canRefresh,
  refetchOnWindowFocus: false,
};
