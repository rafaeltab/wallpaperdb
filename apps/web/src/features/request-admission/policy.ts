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

export function retryAfterDelay(
  value: { seconds?: number; deadline?: number },
  now: number
): number {
  if (value.seconds !== undefined) return value.seconds * 1000;
  if (value.deadline !== undefined) return Math.max(0, value.deadline - now);
  return 60000;
}
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  return error instanceof GatewayAdmissionError && error.status === 429 && failureCount === 0;
}
export function requestRetryDelay(error: unknown, jitter: number): number {
  return error instanceof GatewayAdmissionError
    ? error.retryAfterMs + 100 + Math.min(399, Math.max(0, Math.floor(jitter * 400)))
    : 0;
}
export function shouldRefreshRequest(error: unknown): boolean {
  return !(error instanceof GatewayAdmissionError);
}
