import type { CSSProperties } from 'react';
import { pullRequestIcons } from './octicons';
import type { Action, WorkItem } from '../../../src/http/index.js';
import { type Board, type PullRequest, metadataIssue, subject, title } from './model';
export function Icon({
  kind,
}: {
  kind: 'issue' | 'pr' | 'draft' | 'collapse' | 'expand' | 'play' | 'stop' | 'eye' | 'settings';
}) {
  if (kind === 'pr' || kind === 'draft')
    return (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d={pullRequestIcons[kind === 'pr' ? 'pr' : 'draft-pr']} />
      </svg>
    );
  const paths = {
    issue: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 4v4m0 2h.01',
    pr: 'M4 2v12M2 4h4m5-2 3 3-3 3m3-3H9v7m-2 2h4',
    draft: 'M4 2v12m7-12v2m0 3v2m0 3v2',
    collapse: 'm3 4 4 4-4 4m10-8-4 4 4 4',
    expand: 'm6 4-4 4 4 4m4-8 4 4-4 4',
    play: 'm5 2 9 6-9 6Z',
    stop: 'M3 3h10v10H3Z',
    eye: 'M1 8s2-5 7-5 7 5 7 5-2 5-7 5-7-5-7-5Zm9 0a2 2 0 1 0-4 0 2 2 0 0 0 4 0',
    settings: 'M2 4h12M2 12h12M5 2v4m6 4v4',
  };
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
export function External({
  href,
  children,
}: {
  href: string | null | undefined;
  children: React.ReactNode;
}) {
  // Only resolved links are accepted; provider text never supplies executable URLs.
  if (!href || !/^(https?:|t3code:|t3-thread:)/i.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  );
}
export function Threads({
  board,
  item,
  native = false,
}: {
  board: Board;
  item: WorkItem;
  native?: boolean;
}) {
  return (
    <>
      {item.threadIds.map((id) => {
        const thread = board.entities.threads[id];
        if (thread?.metadata.state !== 'known') return <span key={id}>T3 unavailable</span>;
        if (thread.association.state !== 'confirmed')
          return <span key={id}>T3 association {thread.association.state}</span>;
        return <ThreadLink key={id} thread={thread} native={native} />;
      })}
    </>
  );
}
export function ThreadLink({
  thread,
  native = false,
  label,
}: {
  thread: Board['entities']['threads'][keyof Board['entities']['threads']];
  native?: boolean;
  label?: string;
}) {
  if (thread.metadata.state !== 'known') return <span>{label ?? 'T3'} unavailable</span>;
  const meta = thread.metadata.value;
  const href = native ? (meta.nativeUrl ?? meta.webUrl) : (meta.webUrl ?? meta.nativeUrl);
  if (!href)
    return (
      <span>
        {label ?? 'T3'} link unavailable · {meta.title}
      </span>
    );
  return <External href={href}>{label ?? `T3 · ${meta.title}`}</External>;
}
export function Labels({ board, item }: { board: Board; item: WorkItem }) {
  const issue = metadataIssue(board, item),
    entity = issue ?? subject(board, item);
  if (entity?.metadata.state !== 'known') return <span>Labels unavailable</span>;
  return (
    <span className="fc-labels">
      {entity.metadata.value.labelIds.map((id) => {
        const label = board.entities.labels[id];
        return label ? (
          <span
            key={id}
            className="fc-label"
            style={
              {
                '--label': `#${/^[0-9a-f]{6}$/i.test(label.color) ? label.color : '888888'}`,
              } as CSSProperties
            }
          >
            {label.name}
          </span>
        ) : null;
      })}
    </span>
  );
}
export function Fields({ board, item }: { board: Board; item: WorkItem }) {
  const project = metadataIssue(board, item)?.project;
  const data = project?.state === 'known' ? project.value : undefined;
  return (
    <span
      className="fc-fields"
      title={data ? 'Priority and size' : 'Priority and size unavailable'}
    >
      <span>{data?.priority?.name ?? (data ? '—' : '?')}</span>
      <span className="fc-size">{data?.size?.name ?? (data ? '—' : '?')}</span>
    </span>
  );
}
export function comparisonLabel(
  pr: PullRequest,
  comparison: { headOid: string; baseOid: string | null; baseRef: string | null }
): string;
export function comparisonLabel(
  pr: PullRequest,
  comparison: { headOid: string; baseOid: string | null; baseRef: string | null }
) {
  if (pr.metadata.state !== 'known') return 'Current comparison unavailable';
  const current = pr.metadata.value.comparison;
  if (
    current.headOid !== comparison.headOid ||
    (comparison.baseOid !== null && current.baseOid !== comparison.baseOid) ||
    (comparison.baseRef !== null && current.baseRef !== comparison.baseRef)
  )
    return 'Previous comparison';
  return comparison.baseOid === null
    ? 'Head-only evidence; tested base unknown'
    : 'Current comparison';
}
export function Checks({ pr }: { pr: PullRequest }) {
  if (pr.checks.state !== 'known') return <span className="fc-muted">Checks unknown</span>;
  const checks = pr.checks.value,
    qualifier = comparisonLabel(pr, checks.comparison);
  return (
    <fieldset className="fc-checks" aria-label={`Checks: ${checks.state}. ${qualifier}`}>
      {checks.groups.map((group) => (
        <External key={group.id} href={group.url}>
          <span
            className={`fc-check fc-check-${qualifier === 'Current comparison' ? group.state : 'unknown'}`}
            title={`${group.name}: ${group.state}, ${group.completed}/${group.total}, ${group.requirement}. ${qualifier}`}
          >
            {group.state === 'passed' ? '✓' : group.state === 'failed' ? '×' : '◷'}
          </span>
        </External>
      ))}
      {qualifier !== 'Current comparison' && <span className="fc-muted">{qualifier}</span>}
      {!checks.complete && <span>Partial checks</span>}
    </fieldset>
  );
}
export function Reviews({ board, pr }: { board: Board; pr: PullRequest }) {
  if (pr.reviews.state !== 'known') return <span>Reviews unknown</span>;
  const reviews = pr.reviews.value;
  const qualifier = comparisonLabel(pr, reviews.comparison);
  return (
    <span
      className="fc-reviewers"
      title={`${reviews.state}. ${comparisonLabel(pr, reviews.comparison)}${reviews.complete ? '' : '. Partial reviews'}`}
    >
      {reviews.reviewers.map((r) => {
        const user = board.entities.users[r.userId];
        return (
          <span key={r.userId} title={`${user?.login ?? 'Unknown reviewer'}: ${r.state}`}>
            {user?.avatarUrl && /^https?:/i.test(user.avatarUrl) ? (
              <img src={user.avatarUrl} alt={user.login} />
            ) : (
              <span className="fc-avatar">{(user?.login ?? '?').slice(0, 1)}</span>
            )}
          </span>
        );
      })}
      {reviews.state}
      {qualifier !== 'Current comparison' && <span className="fc-muted">{qualifier}</span>}
    </span>
  );
}
export function CardContent({
  board,
  item,
  native,
}: {
  board: Board;
  item: WorkItem;
  native: boolean;
}) {
  const entity = subject(board, item);
  const pr =
    item.subject.kind === 'pull-request'
      ? board.entities.pullRequests[item.subject.pullRequestId]
      : undefined;
  return (
    <>
      <div className="fc-card-top">
        <span className="fc-number">
          <Icon
            kind={
              pr
                ? pr.metadata.state === 'known' && pr.metadata.value.draft
                  ? 'draft'
                  : 'pr'
                : 'issue'
            }
          />
          <External href={entity?.metadata.state === 'known' ? entity.metadata.value.url : null}>
            #{entity?.number ?? '?'}
          </External>
        </span>
        {pr &&
          item.subject.kind === 'pull-request' &&
          item.subject.issueIds.map((id) => (
            <span key={id} className="fc-muted">
              #{board.entities.issues[id]?.number ?? '?'}
            </span>
          ))}
        {pr && (
          <span className="fc-pr-title" title={title(entity)}>
            {title(entity)}
          </span>
        )}
        <span
          className={`fc-status fc-status-${item.status.code}${item.status.active ? ' fc-active' : ''}`}
        >
          {item.status.label}
          <i />
        </span>
        <Fields board={board} item={item} />
      </div>
      {!pr && <div className="fc-title">{title(entity)}</div>}
      <div className="fc-card-bottom">
        <Labels board={board} item={item} />
        {pr && (
          <>
            <Checks pr={pr} />
            <Reviews board={board} pr={pr} />
          </>
        )}
        <span className="fc-thread">
          <Threads board={board} item={item} native={native} />
        </span>
      </div>
    </>
  );
}

export function actionLabel(board: Board, item: WorkItem, action: Action) {
  const names = {
    configure: 'Configure factory',
    start: 'Start issue',
    resume: 'Resume job',
    cancel: 'Cancel job',
    'preview-plan': 'Generate plan preview',
  };
  const name = names[action.kind];
  if (item.actionIds.filter((id) => board.entities.actions[id]?.kind === action.kind).length < 2)
    return name;
  const job = Object.values(board.entities.jobs).find((job) => job.id === action.targetId);
  return job ? `${name}: ${job.stage} · ${job.progress}` : name;
}
