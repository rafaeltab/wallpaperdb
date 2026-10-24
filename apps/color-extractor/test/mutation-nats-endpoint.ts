import type { NatsConnection } from 'nats';

// Populated only by the mutation setup, once per isolated Vitest execution.
export const mutationNatsEndpoint: {
  url?: string;
  connection?: NatsConnection;
  withDisposal?: (cleanup: () => Promise<void>) => Promise<void>;
  recordLifecycle?: (phase: 'created' | 'disposed', seconds: number) => void;
} = {};
