import { useEffect, useRef, useState } from 'react';
import type { Board } from './model';
import type { Factory } from './use-factory';
import { ThreadLink } from './presentation';

export function planningResumeBlocked(board: Board) {
  const state = board.meta.factory.planning;
  return (
    state.consecutiveModelDeadlineFailures === state.maximumAttempts && state.pendingNoticeCount > 0
  );
}

export function PlanningNotice({
  board,
  factory,
  native,
}: {
  board: Board;
  factory: Factory;
  native: boolean;
}) {
  const state = board.meta.factory.planning,
    notice = state.notice;
  const unseen = notice?.acknowledgedAt === null;
  const action = board.meta.factory.actionIds
    .map((id) => board.entities.actions[id])
    .find((a) => a?.kind === 'acknowledge-planning-failures');
  const announced = useRef('');
  const [announcement, announce] = useState('');
  useEffect(() => {
    if (!notice || notice.acknowledgedAt !== null) return;
    const key = `${board.scopeId}/${notice.id}/${notice.version}`;
    if (announced.current === key) return;
    announced.current = key;
    announce(
      `Planning needs attention. ${notice.failures.length} model deadline failures. ${state.pendingNoticeCount} pending notices.`
    );
  }, [board.scopeId, notice, state.pendingNoticeCount]);
  if (!notice) return null;
  const details = (
    <>
      <p>
        Notice created <time dateTime={notice.createdAt}>{notice.createdAt}</time>.
      </p>
      <ol>
        {notice.failures.map((failure) => {
          const thread = failure.threadId ? board.entities.threads[failure.threadId] : undefined;
          return (
            <li key={failure.attemptId}>
              <p>{failure.message}</p>
              <p>
                Model elapsed: {(failure.modelElapsedMs / 1000).toFixed(1)} seconds. Attempt
                elapsed: {(failure.attemptElapsedMs / 1000).toFixed(1)} seconds.
              </p>
              <dl>
                <dt>Attempt started</dt>
                <dd>
                  <time dateTime={failure.attemptStartedAt}>{failure.attemptStartedAt}</time>
                </dd>
                <dt>Model handed off</dt>
                <dd>
                  <time dateTime={failure.modelHandedOffAt}>{failure.modelHandedOffAt}</time>
                </dd>
                <dt>Model deadline</dt>
                <dd>
                  <time dateTime={failure.deadline}>{failure.deadline}</time>
                </dd>
                <dt>Failure observed</dt>
                <dd>
                  <time dateTime={failure.failedAt}>{failure.failedAt}</time>
                </dd>
              </dl>
              {thread ? (
                <ThreadLink thread={thread} native={native} label="Planner in T3" />
              ) : (
                <p>Planner link unavailable.</p>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
  const disabled = !unseen || factory.commandsBlocked || action?.availability.state !== 'available';
  return (
    <section
      className={`cc-planning-notice ${unseen ? 'cc-planning-unseen' : ''}`}
      aria-labelledby="planning-notice-heading"
    >
      <div role="status" aria-live="polite" className="cc-sr-only">
        {announcement}
      </div>
      <h2 id="planning-notice-heading">
        {unseen ? 'Planning needs attention' : 'Seen planning failures'}
      </h2>
      {state.consecutiveModelDeadlineFailures === state.maximumAttempts && (
        <p>
          The factory paused after three automatic model deadline failures. Acknowledge the
          failures, then use Resume separately to begin a fresh cycle. Existing ownership and
          admission checks still apply.
        </p>
      )}
      {state.pendingNoticeCount > 1 && (
        <p>
          {state.pendingNoticeCount} pending planning failure notices. Showing the oldest unseen
          notice.
        </p>
      )}
      {unseen ? (
        details
      ) : (
        <details>
          <summary>Inspect seen failure details</summary>
          {details}
          <p>
            Acknowledged{' '}
            <time dateTime={notice.acknowledgedAt ?? undefined}>{notice.acknowledgedAt}</time>.
          </p>
        </details>
      )}
      <button
        type="button"
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled && action)
            void factory.submit(action, { kind: 'acknowledge-planning-failures', payload: {} });
        }}
      >
        {unseen ? 'Acknowledge seen' : 'Acknowledged'}
      </button>
      {unseen && (
        <p>Acknowledgement records that you saw this notice. It does not resume the factory.</p>
      )}
    </section>
  );
}
