import { useEffect, useRef, useState } from 'react';
import { commands, read, type ScheduleSnapshot } from './api';
import { Work, type Command } from './jobs';
import { Preview } from './preview';

export function SchedulerControls({
  snapshot,
  command,
  pending,
}: {
  snapshot: ScheduleSnapshot;
  command: Command;
  pending: boolean;
}) {
  const [editing, setDraft] = useState<ScheduleSnapshot['state']>();
  const draft = editing ?? snapshot.state;
  return (
    <section>
      <h2>Scheduler controls</h2>
      <form
        id="controls"
        data-revision={draft.revision}
        onSubmit={async (event) => {
          event.preventDefault();
          const saved = await command('/api/scheduler', {
            revision: draft.revision,
            concurrency: draft.concurrency,
            allowance: draft.allowance,
            paused: draft.paused,
          });
          if (saved?.state) setDraft(undefined);
        }}
      >
        <label>
          Concurrency
          <input
            name="concurrency"
            type="number"
            required
            value={draft.concurrency}
            onChange={(event) => setDraft({ ...draft, concurrency: Number(event.target.value) })}
          />
        </label>
        <label>
          Distinct issue allowance
          <input
            name="allowance"
            type="number"
            required
            value={draft.allowance}
            onChange={(event) => setDraft({ ...draft, allowance: Number(event.target.value) })}
          />
        </label>
        <p>Use -1 for unlimited. Lowering limits preserves existing work.</p>
        <label>
          <input
            name="paused"
            type="checkbox"
            checked={draft.paused}
            onChange={(event) => setDraft({ ...draft, paused: event.target.checked })}
          />
          Pause admissions
        </label>
        <button type="submit" disabled={pending}>
          Save scheduler controls
        </button>
      </form>
      <p>
        Editing revision {draft.revision}. Latest observed revision {snapshot.state.revision}.{' '}
        <button type="button" disabled={pending} onClick={() => setDraft(undefined)}>
          Use latest controls
        </button>
      </p>
      <p id="schedule-summary">
        Admissions: {snapshot.state.admissions.length}. Admissions{' '}
        {snapshot.state.paused ? 'paused' : 'enabled'}.
      </p>
    </section>
  );
}
export function ObservationNotice({ snapshot }: { snapshot: ScheduleSnapshot }) {
  const value = snapshot.observations;
  return (
    <section>
      <h2>Observations</h2>
      <p>
        GitHub: {value?.state ?? 'initial'}
        {value?.stale ? ' (stale)' : ''}.
      </p>
      <p>
        Last GitHub observation:{' '}
        {value?.observedAt === undefined ? 'Unknown' : new Date(value.observedAt).toISOString()}
      </p>
      <p>
        Last job observation:{' '}
        {value?.jobsObservedAt === undefined
          ? 'Unknown'
          : new Date(value.jobsObservedAt).toISOString()}
      </p>
      {value?.error && <p>Refresh failed: {value.error}. Last-known facts retained.</p>}
      <p>
        {value?.facts
          ? `${value.facts.issues.length} issues, ${value.facts.pullRequests.length} pull requests observed.`
          : 'GitHub facts unknown. Awaiting observation.'}
      </p>
    </section>
  );
}
export function App() {
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot>();
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [issue, setIssue] = useState('');
  const [context, setContext] = useState('');
  const send = useRef(commands());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit refresh restarts polling and cancels the superseded request.
  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    async function poll() {
      controller = new AbortController();
      const current = controller;
      try {
        const next = await read<ScheduleSnapshot>('/api/scheduler', current.signal);
        if (active && !current.signal.aborted) {
          setSnapshot(next);
          setError('');
        }
      } catch {
        if (active && !current.signal.aborted)
          setError(
            'Observations unavailable. Displaying last-known facts; refresh before commands.'
          );
      } finally {
        if (active && !current.signal.aborted) timer = setTimeout(poll, 1000);
      }
    }
    function stop() {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    }
    function start() {
      if (!active) {
        active = true;
        void poll();
      }
    }
    void poll();
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', start);
    return () => {
      stop();
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('pageshow', start);
    };
  }, [refresh]);
  const command: Command = async (path, body) => {
    setPending(true);
    setResult('');
    try {
      const accepted = await send.current<{ state?: ScheduleSnapshot['state'] }>(path, body);
      if (mounted.current) {
        setResult('Command accepted. Awaiting observation.');
        setRefresh((value) => value + 1);
      }
      return accepted;
    } catch (error) {
      if (mounted.current)
        setResult(error instanceof Error ? error.message : 'Command unavailable');
      return undefined;
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return (
    <main>
      <h1>Factory operations</h1>
      <p>
        Continuous admission of valid plans. Review, publication and CI observation follow accepted
        stage outcomes.
      </p>
      <Preview />
      <p role="status">
        {error ||
          (!snapshot ? 'Loading local observations…' : 'Observations refresh automatically.')}
      </p>
      {snapshot && (
        <>
          <ObservationNotice snapshot={snapshot} />
          <SchedulerControls snapshot={snapshot} command={command} pending={pending || !!error} />
          <Work snapshot={snapshot} command={command} pending={pending || !!error} />
          {!snapshot.jobs.some((job) => job.kind === 'job') && (
            <form
              data-start
              onSubmit={(event) => {
                event.preventDefault();
                void command('/api/job', { issue: Number(issue), context });
              }}
            >
              <label>
                Selected issue number
                <input
                  name="issue"
                  type="number"
                  min="1"
                  required
                  value={issue}
                  onChange={(event) => setIssue(event.target.value)}
                />
              </label>
              <label>
                Maintainer execution context
                <textarea
                  name="context"
                  maxLength={16000}
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                />
              </label>
              <button type="submit" disabled={pending || !!error}>
                Start selected issue
              </button>
            </form>
          )}
        </>
      )}
      <p>
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setRefresh((value) => value + 1);
          }}
        >
          Refresh observation
        </a>
      </p>
      <p id="result" role="status">
        {result}
      </p>
      <small>
        Distinct admissions are retained across restarts. Cancellation is explicit. Admission
        controls and readiness labels do not cancel active work.
      </small>
    </main>
  );
}
