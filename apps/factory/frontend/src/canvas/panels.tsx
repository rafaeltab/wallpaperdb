import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Action,
  FactoryV2IssueSearch,
  FactoryV2ItemDetails,
  FactoryV2PlanDetails,
  WorkItem,
} from '../../../src/http/index.js';
import type { FactoryClient } from './client';
import type { Factory } from './use-factory';
import { CommandFeedback } from './feedback';
import { planningResumeBlocked } from './planning-notice';
import { type Board, type Issue, subject, title, metadataIssue, issueIds } from './model';
import {
  Checks,
  External,
  Reviews,
  Threads,
  comparisonLabel,
  actionLabel,
  retryExplanation,
  ThreadLink,
} from './presentation';
export function Panel({
  name,
  close,
  children,
  feedback,
}: {
  name: string;
  close: () => void;
  children: ReactNode;
  feedback?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = ref.current;
    dialog?.show();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      className={`fc-dialog cc-floating ${name === 'Factory controls' ? 'cc-settings' : name === 'Start an issue' ? 'cc-start' : 'cc-plan'}`}
      ref={ref}
      aria-label={name}
      onCancel={close}
    >
      <header className="cc-floating-title">
        <strong>{name === 'Factory controls' ? 'Settings' : name}</strong>
        <button type="button" onClick={close} aria-label={`Close ${name}`}>
          ×
        </button>
      </header>
      {children}
      {feedback}
    </dialog>
  );
}
export function ActionButton({
  action,
  busy,
  label,
  onClick,
}: {
  action: Action | undefined;
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  if (!action) return null;
  const reason =
    action.availability.state === 'available'
      ? ''
      : action.availability.reasons.map((r) => r.message).join(' ');
  return (
    <button
      type="button"
      disabled={busy || action.availability.state !== 'available'}
      title={reason}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
export function Controls({
  board,
  factory,
  close,
  children,
}: {
  board: Board;
  factory: Factory;
  close: () => void;
  children?: ReactNode;
}) {
  const [base] = useState(board.meta.factory);
  const [baseScope] = useState(board.scopeId);
  const [paused, setPaused] = useState(base.paused);
  const [concurrency, setConcurrency] = useState(
    base.concurrency.limit.kind === 'limited' ? String(base.concurrency.limit.maximum) : ''
  );
  const [allowance, setAllowance] = useState(
    base.admission.limit.kind === 'limited' ? String(base.admission.limit.maximum) : ''
  );
  const [error, setError] = useState('');
  const stale = baseScope !== board.scopeId || base.version !== board.meta.factory.version;
  const resumeBlocked = planningResumeBlocked(board) && !paused;
  const action = base.actionIds
    .map((id) => board.entities.actions[id])
    .find((a) => a?.kind === 'configure');
  return (
    <Panel name="Factory controls" close={close} feedback={<CommandFeedback factory={factory} />}>
      {children}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          const limit = (value: string) => {
            if (!value.trim()) return { kind: 'unlimited' } as const;
            const maximum = Number(value);
            if (!Number.isSafeInteger(maximum) || maximum <= 0)
              throw new Error('Limits must be positive whole numbers. Leave blank for unlimited.');
            return { kind: 'limited', maximum } as const;
          };
          try {
            if (action && !stale && !resumeBlocked)
              void factory.submit(action, {
                kind: 'configure',
                payload: {
                  paused,
                  concurrency: limit(concurrency),
                  admissionAllowance: limit(allowance),
                },
              });
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label>
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />{' '}
          Pause new admissions
        </label>
        <p>Existing jobs continue when admissions are paused.</p>
        {planningResumeBlocked(board) && (
          <p>
            Acknowledge the planning failures before resuming. You can still edit limits while
            paused.
          </p>
        )}
        <label>
          Concurrency
          <input
            inputMode="numeric"
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
          />
        </label>
        <p>{board.meta.factory.concurrency.occupied} active. Blank means unlimited.</p>
        <label>
          Admission allowance
          <input
            inputMode="numeric"
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
          />
        </label>
        <p>
          {board.meta.factory.admission.consumed} distinct admissions consumed. Cancelling does not
          restore allowance.
        </p>
        {stale && (
          <p role="alert">
            Factory controls changed while editing. Close and reopen to edit the latest values.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          type="submit"
          disabled={
            action?.availability.state !== 'available' ||
            stale ||
            factory.commandsBlocked ||
            resumeBlocked
          }
        >
          Apply controls
        </button>
      </form>
    </Panel>
  );
}
export function Start({
  client,
  factory,
  close,
  initialQuery = '',
}: {
  initialQuery?: string;
  client: FactoryClient;
  factory: Factory;
  close: () => void;
}) {
  const [query, setQuery] = useState(initialQuery),
    [page, setPage] = useState<string>();
  const [result, setResult] = useState<FactoryV2IssueSearch>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const indexRevision = useMemo(
    () =>
      JSON.stringify([
        Object.values(factory.board?.entities.issues ?? {}).map(({ id, version }) => [id, version]),
        Object.values(factory.board?.entities.actions ?? {}).map(({ id, version }) => [
          id,
          version,
        ]),
      ]),
    [factory.board?.entities.issues, factory.board?.entities.actions]
  );
  const [resultRevision, setResultRevision] = useState<string>();
  const [picked, setPicked] = useState<{ issue: Issue; action: Action; revision: string }>(),
    [context, setContext] = useState('');
  const currentAction = picked ? factory.board?.entities.actions[picked.action.id] : undefined;
  const currentIssue = picked ? factory.board?.entities.issues[picked.issue.id] : undefined;
  useEffect(() => {
    if (!picked || picked.revision === indexRevision || !currentAction) return;
    setPicked((selection) =>
      selection !== picked
        ? selection
        : currentAction.version === picked.action.version
          ? { ...picked, issue: currentIssue ?? picked.issue, revision: indexRevision }
          : undefined
    );
  }, [picked, indexRevision, currentAction, currentIssue]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new index generation expires the current page token.
  useEffect(() => setPage(undefined), [indexRevision]);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void client
        .search(query, page, controller.signal)
        .then((data) => {
          if (current) {
            setResult(data);
            setResultRevision(indexRevision);
            setPicked((selection) => {
              if (!selection || selection.revision === indexRevision) return selection;
              const hit = data.hits.find((candidate) => candidate.issue.id === selection.issue.id);
              return hit &&
                hit.startAction.id === selection.action.id &&
                hit.startAction.version === selection.action.version
                ? { ...selection, issue: hit.issue, revision: indexRevision }
                : undefined;
            });
            setLoading(false);
          }
        })
        .catch((e) => {
          if (current) {
            setError(String(e));
            setLoading(false);
          }
        });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, page, indexRevision]);
  return (
    <Panel name="Start an issue" close={close} feedback={<CommandFeedback factory={factory} />}>
      <label>
        Search issues
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(undefined);
            setPicked(undefined);
          }}
        />
      </label>
      {loading ? (
        <p role="status">Searching…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          {result?.coverage.state !== 'complete' && (
            <p>
              Search coverage {result?.coverage.state}.{' '}
              {result?.coverage.reasons.map((r) => r.message).join(' ')}
            </p>
          )}
          <ul className="fc-search">
            {result?.hits.map((hit) => (
              <li key={hit.issue.id}>
                <button
                  type="button"
                  aria-pressed={picked?.issue.id === hit.issue.id}
                  onClick={() =>
                    setPicked({
                      issue: hit.issue,
                      action: hit.startAction,
                      revision: resultRevision ?? indexRevision,
                    })
                  }
                >
                  #{hit.issue.number} {title(hit.issue)}
                </button>
                <p>
                  {hit.startAction.availability.state === 'available'
                    ? 'Available to start'
                    : hit.startAction.availability.reasons.map((r) => r.message).join(' ')}
                </p>
              </li>
            ))}
          </ul>
          {!result?.hits.length && <p>No matching issues.</p>}
          {result?.nextPageToken && (
            <button type="button" onClick={() => setPage(result.nextPageToken ?? undefined)}>
              Next results
            </button>
          )}
          {page && (
            <button type="button" onClick={() => setPage(undefined)}>
              First results
            </button>
          )}
        </>
      )}
      <label>
        Execution context
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Scope and instructions for this issue"
        />
      </label>
      {picked && (
        <>
          <p>
            Start #{picked.issue.number} · {title(picked.issue)}
          </p>
          <ActionButton
            action={picked.action}
            busy={factory.commandsBlocked || loading || !!error || resultRevision !== indexRevision}
            label="Start selected issue"
            onClick={() =>
              void factory.submit(picked.action, { kind: 'start', payload: { context } })
            }
          />
        </>
      )}
    </Panel>
  );
}
export function Details({
  board,
  item,
  client,
  factory,
  close,
  native,
}: {
  board: Board;
  item: WorkItem;
  client: FactoryClient;
  factory: Factory;
  close: () => void;
  native: boolean;
}) {
  const [details, setDetails] = useState<FactoryV2ItemDetails>(),
    [error, setError] = useState('');
  const { id: itemId, version: itemVersion } = item;
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setDetails(undefined);
    setError('');
    void client
      .details({ id: itemId, version: itemVersion }, controller.signal)
      .then((data) => {
        if (current) setDetails(data);
      })
      .catch((e) => {
        if (current) setError(String(e));
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [client, itemId, itemVersion]);
  const entity = subject(board, item),
    pr =
      item.subject.kind === 'pull-request'
        ? board.entities.pullRequests[item.subject.pullRequestId]
        : undefined;
  const issue = metadataIssue(board, item);
  const prerequisites = Object.values(board.entities.relationships).filter(
    (r) => r.kind === 'prerequisite' && issueIds(item).includes(r.dependantIssueId)
  );
  return (
    <Panel name="Work item details" close={close} feedback={<CommandFeedback factory={factory} />}>
      <h3>{title(entity)}</h3>
      <p>
        <External href={entity?.metadata.state === 'known' ? entity.metadata.value.url : null}>
          #{entity?.number}
        </External>{' '}
        · {item.status.label}
      </p>
      {issue && (
        <section>
          <h3>Admission eligibility: {issue.eligibility.state}</h3>
          {issue.eligibility.reasons.map((r) => (
            <p key={r.code}>{r.message}</p>
          ))}
        </section>
      )}
      {prerequisites.length > 0 && (
        <section>
          <h3>Prerequisites</h3>
          <ul>
            {prerequisites.map((edge) => {
              if (edge.kind !== 'prerequisite') return null;
              const prerequisite = board.entities.issues[edge.prerequisiteIssueId];
              return (
                <li key={edge.id}>
                  <External
                    href={
                      prerequisite?.metadata.state === 'known'
                        ? prerequisite.metadata.value.url
                        : null
                    }
                  >
                    #{prerequisite?.number} {title(prerequisite)}
                  </External>{' '}
                  · {edge.satisfaction.state}
                  {'reasons' in edge.satisfaction &&
                    edge.satisfaction.reasons.map((r) => <p key={r.code}>{r.message}</p>)}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p>Human attention: {item.attention.state}</p>
      {item.attention.state !== 'none' && (
        <ul>
          {item.attention.reasons.map((r) => (
            <li key={r.code}>{r.message}</li>
          ))}
        </ul>
      )}
      {item.jobIds.map((id) => {
        const job = board.entities.jobs[id];
        return (
          job && (
            <section key={id}>
              <h3>{job.stage}</h3>
              <p>{job.progress}</p>
              <p>
                {job.execution.state === 'known' ? job.execution.value.state : job.execution.reason}
              </p>
              {job.startedAt && (
                <p>
                  Started <time>{job.startedAt}</time>
                </p>
              )}
              {job.question && <p>{job.question.summary}</p>}
            </section>
          )
        );
      })}
      {item.maintenanceIds.map((id) => {
        const m = board.entities.maintenance[id];
        return (
          m && (
            <p key={id}>
              {m.phase}: {m.progress}
            </p>
          )
        );
      })}
      {pr && (
        <>
          <h3>Checks</h3>
          <Checks pr={pr} />
          <h3>Reviews</h3>
          <Reviews board={board} pr={pr} />
          <p>Factory readiness: {pr.readiness.state}</p>
          {'reasons' in pr.readiness &&
            pr.readiness.reasons.map((r) => <p key={r.code}>{r.message}</p>)}
        </>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : !details ? (
        <p role="status">Loading versioned details…</p>
      ) : (
        <>
          {details.questions.map((q) => (
            <p key={`${q.jobId}:${q.id}`}>{q.text}</p>
          ))}
          {details.checkRuns.state === 'known' ? (
            <ul>
              {details.checkRuns.value.map((run) => (
                <li key={run.id}>
                  <External href={run.url}>{run.name}</External> · {run.state} ·{' '}
                  {pr
                    ? comparisonLabel(pr, run.comparison)
                    : `Head ${run.comparison.headOid.slice(0, 7)} · base ${run.comparison.baseOid?.slice(0, 7) ?? 'unknown'}`}
                </li>
              ))}
            </ul>
          ) : (
            <p>Check runs unavailable: {details.checkRuns.reason}</p>
          )}
        </>
      )}
      {item.actionIds.some((id) => board.entities.actions[id]?.kind === 'retry') && (
        <p>{retryExplanation}</p>
      )}
      <div className="fc-panel-actions">
        <Threads board={board} item={item} native={native} />
        {item.actionIds.map((id) => {
          const a = board.entities.actions[id];
          return (
            a &&
            (a.kind === 'resume' || a.kind === 'retry' || a.kind === 'cancel') && (
              <ActionButton
                key={id}
                action={a}
                busy={factory.commandsBlocked}
                label={actionLabel(board, item, a)}
                onClick={() =>
                  void factory.submit(a, {
                    kind: a.kind === 'resume' ? 'resume' : a.kind === 'retry' ? 'retry' : 'cancel',
                    payload: {},
                  })
                }
              />
            )
          );
        })}
      </div>
    </Panel>
  );
}
export function Plan({
  board,
  client,
  factory,
  close,
  native,
}: {
  native: boolean;
  board: Board;
  client: FactoryClient;
  factory: Factory;
  close: () => void;
}) {
  const [data, setData] = useState<FactoryV2PlanDetails>(),
    [error, setError] = useState('');
  const id = board.meta.currentPlanId;
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setData(undefined);
    setError('');
    if (id)
      void client
        .plan(id, controller.signal)
        .then((result) => {
          if (current) setData(result);
        })
        .catch((e) => {
          if (current) setError(String(e));
        });
    return () => {
      current = false;
      controller.abort();
    };
  }, [client, id]);
  const action = board.meta.factory.actionIds
    .map((a) => board.entities.actions[a])
    .find((a) => a?.kind === 'preview-plan');
  const attempt = data?.attempt,
    result = attempt?.result;
  const issueName = (issueId: string) => {
    const issue = data?.entities.issues[issueId as keyof typeof board.entities.issues];
    return issue ? `#${issue.number} ${title(issue)}` : 'Issue unavailable';
  };
  const selected = result?.selected ?? [];
  const plannerThread = attempt?.threadId ? data?.entities.threads[attempt.threadId] : undefined;
  return (
    <Panel name="Plan preview" close={close} feedback={<CommandFeedback factory={factory} />}>
      <p>This proposal is advisory. Generating it does not start work.</p>
      <ActionButton
        action={action}
        busy={factory.commandsBlocked}
        label="Generate plan preview"
        onClick={() => {
          if (action) void factory.submit(action, { kind: 'preview-plan', payload: {} });
        }}
      />
      {error && <p role="alert">{error}</p>}
      {!id && <p>No plan preview yet.</p>}
      {id && !data && !error && <p role="status">Loading plan…</p>}
      {attempt && (
        <>
          <h3>{attempt.phase}</h3>
          <p>{attempt.progress}</p>
          <p>Applicability: {attempt.applicability}</p>
          <p>
            Started {attempt.startedAt}
            {attempt.deadline !== null && <> · Model deadline {attempt.deadline}</>}
          </p>
          {plannerThread && (
            <ThreadLink thread={plannerThread} native={native} label="Planner in T3" />
          )}
          {result && (
            <>
              <h3>Proposed work</h3>
              <div className="fc-plan-graph">
                <svg aria-hidden="true" width="560" height={Math.max(60, selected.length * 100)}>
                  <defs>
                    <marker
                      id="plan-arrow"
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0 0L6 3L0 6" fill="none" stroke="currentColor" />
                    </marker>
                  </defs>
                  {selected.flatMap((s, i) =>
                    s.dependsOn.map((dep) => {
                      const target = selected.findIndex((s) => s.issueId === dep);
                      if (target < 0) return null;
                      return (
                        <path
                          key={`${s.issueId}:${dep}`}
                          d={`M480 ${i * 100 + 30}H${510 + i * 8}V${target * 100 + 30}H480`}
                          fill="none"
                          stroke="#8ebca9"
                          markerEnd="url(#plan-arrow)"
                        />
                      );
                    })
                  )}
                </svg>
                <ol>
                  {selected.map((s) => (
                    <li key={s.issueId}>
                      <strong>{issueName(s.issueId)}</strong>
                      <p>{s.reason}</p>
                    </li>
                  ))}
                </ol>
              </div>
              {selected.map((s) => (
                <section key={s.issueId}>
                  <h4>{issueName(s.issueId)}</h4>
                  <p>
                    Proposed prerequisites:{' '}
                    {s.dependsOn.length ? s.dependsOn.map(issueName).join(', ') : 'None'}
                  </p>
                  <p>
                    Conflicts: {s.conflicts.length ? s.conflicts.map(issueName).join(', ') : 'None'}
                  </p>
                </section>
              ))}
              <h3>Deferred</h3>
              {result.deferred.length ? (
                result.deferred.map((s) => (
                  <p key={s.issueId}>
                    {issueName(s.issueId)} · {s.reason}
                  </p>
                ))
              ) : (
                <p>None</p>
              )}
              <h3>Rejected</h3>
              {result.rejected.length ? (
                result.rejected.map((s) => (
                  <p key={s.issueId}>
                    {issueName(s.issueId)} · {s.reason}
                  </p>
                ))
              ) : (
                <p>None</p>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}
