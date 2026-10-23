// Populated only by the mutation integration setup in each isolated Vitest run.
export const mutationPostgresEndpoint: {
  url?: string;
  recordLifecycle?: (phase: 'created' | 'disposed', seconds: number) => void;
  withDisposal?: (cleanup: () => Promise<void>) => Promise<void>;
} = {};
