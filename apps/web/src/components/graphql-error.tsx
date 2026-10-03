import { GatewayAdmissionError } from '@/features/request-admission/adapters/graphql';
import { Button } from '@/components/ui/button';

export function GraphQLError({
  error,
  retry,
  retrying = false,
  title = 'Could not load content',
  retryLabel,
}: {
  error: unknown;
  retry: () => unknown;
  retrying?: boolean;
  title?: string;
  retryLabel?: string;
}) {
  const admission = error instanceof GatewayAdmissionError ? error : undefined;
  return (
    <span
      role="alert"
      className="block rounded-lg border border-destructive/50 bg-card px-4 py-3 text-left text-sm text-destructive"
    >
      <span className="block font-medium">
        {admission
          ? admission.status === 429
            ? 'Network usage limit reached'
            : 'Server busy'
          : title}
      </span>
      <span className="block space-y-2">
        <span className="block">{admission?.message ?? 'Please try again later.'}</span>
        {admission?.status === 429 ? (
          <span className="block">
            {retrying ? 'We will try again automatically in about' : 'Try again in about'}{' '}
            {Math.ceil(admission.retryAfterMs / 1000)} seconds.
          </span>
        ) : null}
        <Button
          aria-label={retryLabel}
          variant="outline"
          size="sm"
          disabled={retrying}
          onClick={() => void retry()}
        >
          Try again
        </Button>
      </span>
    </span>
  );
}
