import { useEffect, useState } from 'react';
import type { Board } from './model';

export function SourceCoverage({ board, refresh }: { board: Board; refresh: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <details className="fc-sources">
      <summary>Source coverage: {board.meta.coverage.state}</summary>
      {Object.values(board.entities.sources).map((source) => (
        <p key={source.id}>
          {source.kind}: {source.refresh}
          {source.staleAt && Date.parse(source.staleAt) <= now ? ' · stale' : ''} ·{' '}
          {source.observedAt ?? 'unobserved'} {source.failure?.message}
        </p>
      ))}
      {board.meta.coverage.reasons.map((reason) => (
        <p key={reason.code}>{reason.message}</p>
      ))}
      {board.meta.diagnostics.map((reason) => (
        <p key={reason.code}>{reason.message}</p>
      ))}
      <button type="button" onClick={refresh}>
        Refresh observations
      </button>
    </details>
  );
}
