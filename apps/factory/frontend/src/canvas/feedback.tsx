import type { Factory } from './use-factory';
export function CommandFeedback({ factory }: { factory: Factory }) {
  if (!factory.receipt && !factory.commandError && !factory.busy) return null;
  return (
    <div className="fc-command-status" role="status">
      {factory.uncertain
        ? 'Command uncertain'
        : factory.busy
          ? 'Command pending…'
          : factory.receipt
            ? `Command ${factory.receipt.state}`
            : ''}
      {factory.receipt?.reasons.map((r) => (
        <span key={r.code}>{r.message}</span>
      ))}
      {factory.commandError && <span role="alert">{factory.commandError}</span>}
      {factory.uncertain && (
        <>
          <button type="button" disabled={factory.busy} onClick={() => void factory.observe()}>
            Observe command receipt
          </button>
          <button type="button" disabled={factory.busy} onClick={() => void factory.retry()}>
            Retry same command
          </button>
        </>
      )}
    </div>
  );
}
