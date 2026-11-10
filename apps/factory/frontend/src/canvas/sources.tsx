import { useEffect, useId, useState } from 'react';
import type { Board } from './model';
import { Icon } from './canvas-presentation';

function useSourceTime() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function AttentionControl({
  board,
  count,
  active,
  onToggle,
}: {
  board: Board;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const now = useSourceTime();
  const descriptionId = useId();
  const affected = Object.values(board.entities.sources).filter(
    (source) =>
      source.observedAt === null ||
      source.refresh === 'failed' ||
      source.refresh === 'unavailable' ||
      source.failure !== null ||
      (source.staleAt !== null && Date.parse(source.staleAt) <= now)
  );
  const oldest = affected
    .flatMap((source) => (source.observedAt ? [{ kind: source.kind, at: source.observedAt }] : []))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const unobserved = affected.filter((source) => source.observedAt === null).map((s) => s.kind);
  return (
    <>
      <button
        type="button"
        className="cc-attention-toggle"
        aria-label={`Highlight ${count} items needing human attention`}
        aria-describedby={affected.length ? descriptionId : undefined}
        aria-pressed={active}
        disabled={count === 0 && !active}
        data-tip="Highlight work needing human attention. Dated counts use last-known source data."
        onClick={onToggle}
      >
        <Icon kind="attention" size={13} />
        <span className="cc-attention-count">
          {count}
          {board.meta.coverage.state !== 'complete' ? '+' : ''}
        </span>{' '}
        {affected.length ? (
          <>
            attention ·{' '}
            {oldest ? (
              <>
                as of{' '}
                <time dateTime={oldest.at}>
                  {new Date(oldest.at).toISOString().slice(0, 16).replace('T', ' ')}Z
                </time>
              </>
            ) : (
              'source unavailable'
            )}
          </>
        ) : (
          'need attention'
        )}
      </button>
      {affected.length > 0 && (
        <span className="cc-attention-source-details" id={descriptionId} role="status">
          <span>Attention count may be outdated</span>
          {oldest && (
            <span>
              Oldest affected source {oldest.kind}: <time dateTime={oldest.at}>{oldest.at}</time>
            </span>
          )}
          {unobserved.length > 0 && <span>unobserved: {unobserved.join(', ')}</span>}
        </span>
      )}
    </>
  );
}

export function SourceCoverage({ board, refresh }: { board: Board; refresh: () => void }) {
  const now = useSourceTime();
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
