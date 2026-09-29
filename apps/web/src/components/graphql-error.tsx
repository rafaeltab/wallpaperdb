import { GatewayAdmissionError } from '@/lib/graphql/admission';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function GraphQLError({
  error,
  retry,
  retrying = false,
  title = 'Could not load content',
}: {
  error: unknown;
  retry: () => unknown;
  retrying?: boolean;
  title?: string;
}) {
  const admission = error instanceof GatewayAdmissionError ? error : undefined;
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {admission
          ? admission.status === 429
            ? 'Network usage limit reached'
            : 'Server busy'
          : title}
      </AlertTitle>
      <AlertDescription>
        <p>{admission?.message ?? 'Please try again later.'}</p>
        {admission?.status === 429 ? (
          <p>
            {retrying ? 'We will try again automatically in about' : 'Try again in about'}{' '}
            {Math.ceil(admission.retryAfterMs / 1000)} seconds.
          </p>
        ) : null}
        <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
