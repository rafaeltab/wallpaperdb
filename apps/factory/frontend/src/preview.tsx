import { useEffect, useRef, useState } from 'react';
import {
  commands,
  read,
  stage,
  type Attempt,
  type AttemptResult,
  type ScheduleSnapshot,
} from './api';
import { Issues, ThreadLinks } from './links';
export function PlanResult({
  result,
  threads,
}: {
  result: AttemptResult;
  threads?: ScheduleSnapshot['threads'];
}) {
  return (
    <>
      <h3>
        {result.kind === 'stale'
          ? 'Stale proposal. Generate a fresh preview.'
          : 'Validated advisory proposal'}
      </h3>
      <h3>Issue context</h3>
      {result.input.issues.map((issue) => (
        <article key={issue.number}>
          <Issues numbers={[issue.number]} />
          <p>{issue.title}</p>
          <p>
            Explicit prerequisites: <Issues numbers={issue.blockers} />
          </p>
          <p>
            Parent specs: <Issues numbers={issue.parents} />
          </p>
          {issue.recovery && (
            <>
              <p>
                Conflict recovery: {issue.recovery.classification ?? 'Unclassified'}:{' '}
                {issue.recovery.progress}
              </p>
              {issue.recovery.question && <p>Question: {issue.recovery.question}</p>}
              {issue.recovery.threadId && (
                <ThreadLinks
                  threadId={issue.recovery.threadId}
                  environmentId={threads?.facts?.environmentId}
                  browserOrigin={threads?.browserOrigin}
                />
              )}
            </>
          )}
        </article>
      ))}
      <h3>Proposed</h3>
      {result.selected.map((selection) => (
        <article key={selection.issue}>
          <p>
            #{selection.issue}: {selection.reason}
          </p>
          <p>
            Proposed dependencies: <Issues numbers={selection.dependsOn} />
          </p>
          <p>
            Proposed conflicts: <Issues numbers={selection.conflicts} />
          </p>
        </article>
      ))}
      <h3>Rejected or blocked</h3>
      {result.rejected.length
        ? result.rejected.map((item) => (
            <p key={item.issue}>
              #{item.issue}: {item.reason}
            </p>
          ))
        : 'None'}
      <p>No work was dispatched.</p>
    </>
  );
}
export function Preview({ threads }: { threads?: ScheduleSnapshot['threads'] } = {}) {
  const [attempt, setAttempt] = useState<Attempt>();
  const [result, setResult] = useState<AttemptResult>();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const send = useRef(commands());
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    lifetime.current = new AbortController();
    return () => lifetime.current?.abort();
  }, []);
  async function preview() {
    if (pending) return;
    const controller = lifetime.current;
    if (!controller) return;
    const signal = controller.signal;
    setPending(true);
    setResult(undefined);
    setAttempt(undefined);
    setMessage('Submitting advisory preview…');
    try {
      const accepted = await send.current<AttemptResult | { id: string }>('/api/plan', {});
      if (signal.aborted) return;
      if (!('id' in accepted)) {
        setResult(accepted);
        setMessage('');
        return;
      }
      while (!signal.aborted) {
        const current = await read<Attempt>(`/api/plan/${encodeURIComponent(accepted.id)}`, signal);
        if (signal.aborted) return;
        setAttempt(current);
        setMessage('');
        if (current.phase === 'succeeded') {
          setResult(current.result);
          break;
        }
        if (current.phase === 'failed') {
          setMessage(current.detail ?? 'Preview failed');
          break;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 1000);
          function done() {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
          }
          signal.addEventListener('abort', done, { once: true });
        });
      }
    } catch (error) {
      if (!signal.aborted)
        setMessage(
          error instanceof Error ? error.message : 'Preview unavailable. No work was dispatched.'
        );
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  const progress = attempt && stage(attempt.phase);
  return (
    <section>
      <h2>Automatic plan preview</h2>
      <p>
        Preview only. No implementation work is dispatched. Explicit pinned upgrades are host
        operations.
      </p>
      <button type="button" disabled={pending} onClick={preview}>
        Generate plan preview
      </button>
      <div id="plan" role="status">
        {progress && (
          <>
            <p>
              {progress.label} ({Math.round((attempt?.elapsedMs ?? 0) / 1000)}s)
            </p>
            <progress aria-label="Approximate planning stage" max={4} value={progress.value} />
            <small>Approximate stages, not percent complete.</small>
          </>
        )}
        {message}
        {result && <PlanResult result={result} threads={threads} />}
      </div>
    </section>
  );
}
