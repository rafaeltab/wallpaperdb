import { expect, it } from 'vitest';
import { GatewayAdmissionError, shouldRetryRequest, requestRetryDelay, shouldRefreshRequest, retryAfterDelay } from '@/features/request-admission';
it('uses one automatic retry for rate limits and none for overload or ordinary errors', () => {
  expect(shouldRetryRequest(0,new GatewayAdmissionError(429,1000))).toBe(true);
  expect(shouldRetryRequest(1,new GatewayAdmissionError(429,1000))).toBe(false);
  expect(shouldRetryRequest(0,new GatewayAdmissionError(503,1000))).toBe(false);
  expect(shouldRetryRequest(0,Error('Offline'))).toBe(false);
});
it('bounds jitter and disables implicit refreshes after admission failures', () => {
  const error=new GatewayAdmissionError(429,1000);
  expect(requestRetryDelay(error,0)).toBe(1100);
  expect(requestRetryDelay(error,0.99)).toBe(1496);
  expect(requestRetryDelay(Error('Offline'),0.5)).toBe(0);
  expect(shouldRefreshRequest(error)).toBe(false);
  expect(shouldRefreshRequest(null)).toBe(true);
});
it('resolves numeric, absolute and missing retry delays against explicit time', () => {
  expect(retryAfterDelay({seconds:1.5},100)).toBe(1500);
  expect(retryAfterDelay({deadline:50},100)).toBe(0);
  expect(retryAfterDelay({deadline:400},100)).toBe(300);
  expect(retryAfterDelay({},100)).toBe(60000);
});
