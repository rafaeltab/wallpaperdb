import { createContext, useContext } from 'react';
import type { CanvasData, CanvasItem as Item } from './view-model';
import type { TitleMode } from './geometry-types';
import type { Board } from './model';
import { comparisonLabel } from './presentation';
import { pullRequestIcons } from './octicons';
export const CanvasContext = createContext<{
  data: CanvasData;
  board: Board;
  native: boolean;
} | null>(null);
function useCanvas() {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('Canvas context missing');
  return value;
}
export function statusAppearance(status: string) {
  const normalized = status.toLowerCase();
  if (
    ['Implementing', 'Babysitting', 'CI running']
      .map((value) => value.toLowerCase())
      .includes(normalized)
  )
    return { className: 'cc-blue', color: '#83aff0' };
  if (['Reviewing code', 'Needs review'].map((value) => value.toLowerCase()).includes(normalized))
    return { className: 'cc-purple', color: '#b59de4' };
  if (normalized === 'ready' || normalized === 'open')
    return { className: 'cc-green', color: '#59caa5' };
  if (normalized === 'draft') return { className: 'cc-muted', color: '#90909e' };
  if (normalized === 'conflict' || normalized === 'ci failed')
    return { className: 'cc-red', color: '#df8d96' };
  if (normalized === 'cancelled') return { className: 'cc-muted', color: '#777786' };
  return { className: 'cc-amber', color: '#d4b17d' };
}
export function Icon({ kind, size = 14 }: { kind: string; size?: number }) {
  if (kind === 'pr' || kind === 'draft-pr')
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        stroke="none"
        aria-hidden="true"
        data-icon={`github-${kind}`}
      >
        <path d={pullRequestIcons[kind]} />
      </svg>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'passed' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </>
      ) : kind === 'failed' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6m0-6-6 6" />
        </>
      ) : kind === 'running' ? (
        <>
          <circle cx="12" cy="12" r="9" strokeDasharray="23 10" />
          <path d="M12 7v5l3 2" />
        </>
      ) : kind === 'gear' ? (
        <>
          <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l2-2 3 1 3-3-1-3 2-2-2-3-3-1-1-3Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : kind === 'thread' ? (
        <>
          <rect x="3" y="4" width="18" height="13" rx="3" />
          <path d="m7 17-1 4 6-4M7 9h10m-10 4h6" />
        </>
      ) : kind === 'restack' ? (
        <>
          <path d="M20 10a8 8 0 0 0-14-4L3 9m0-6v6h6M4 14a8 8 0 0 0 14 4l3-3m0 6v-6h-6" />
        </>
      ) : kind === 'fit' ? (
        <path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6" />
      ) : kind === 'eye' ? (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : kind === 'attention' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6m0 4h.01" />
        </>
      ) : kind === 'play' ? (
        <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
      ) : kind === 'stop' ? (
        <>
          <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
          <rect x="8" y="8" width="8" height="8" rx=".5" fill="currentColor" stroke="none" />
        </>
      ) : kind === 'collapse' ? (
        <path d="m6 4 6 6 6-6m-12 16 6-6 6 6" strokeWidth="2.4" />
      ) : kind === 'expand' ? (
        <path d="m6 9 6-6 6 6m-12 6 6 6 6-6" strokeWidth="2.4" />
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2" />
        </>
      )}
    </svg>
  );
}
export function Identity({ item }: { item: Item }) {
  const { data } = useCanvas();
  const meta = data.metadata[item.id];
  const entry = (number: number | null, url: string | undefined, kind: string, issue = false) => {
    const children = (
      <>
        <Icon kind={kind} size={issue && item.pr ? 12 : 14} />
        <span>#{number ?? '?'}</span>
      </>
    );
    const className = `cc-id-entry ${issue ? 'cc-issue-number' : item.draft === false ? 'cc-green' : 'cc-muted'}`;
    return url && /^https?:/i.test(url) ? (
      <a
        key={`${kind}:${number}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className={className}
        data-tip={`${issue ? 'Issue' : 'Pull request'} #${number}`}
      >
        {children}
      </a>
    ) : (
      <span
        key={`${kind}:${number}`}
        className={className}
        data-tip="GitHub destination unavailable"
      >
        {children}
      </span>
    );
  };
  return (
    <span className="cc-identity">
      {item.pr
        ? entry(item.pr, item.prUrl, item.draft ? 'draft-pr' : 'pr')
        : entry(meta.number, meta.url, 'issue', true)}
      {!!item.pr && item.issueNumbers.map((issue) => entry(issue.number, issue.url, 'issue', true))}
    </span>
  );
}
export function Status({ status, active }: { status: string; active: boolean }) {
  return (
    <span
      className={`cc-status ${statusAppearance(status).className} ${active ? 'cc-status-active' : ''}`}
      data-tip={status}
    >
      {status}
      <i />
    </span>
  );
}
export function CanvasThread({ item }: { item: Item }) {
  const { board, native } = useCanvas();
  return (
    <>
      {item.item.threadIds.map((id) => {
        const thread = board.entities.threads[id];
        if (
          !thread ||
          thread.metadata.state !== 'known' ||
          thread.association.state !== 'confirmed'
        )
          return (
            <span key={id} className="cc-thread" data-tip="T3 metadata or association unavailable">
              T3 ?
            </span>
          );
        const meta = thread.metadata.value,
          href = native ? (meta.nativeUrl ?? meta.webUrl) : (meta.webUrl ?? meta.nativeUrl);
        return href && /^(https?:|t3code:|t3-thread:)/i.test(href) ? (
          <a
            key={id}
            className="cc-thread"
            aria-label={`T3 · ${meta.title}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            data-tip={`Open T3 · ${meta.title}`}
          >
            T3 ↗
          </a>
        ) : (
          <span key={id} className="cc-thread" data-tip={`T3 link unavailable · ${meta.title}`}>
            T3 ?
          </span>
        );
      })}
    </>
  );
}
export function CanvasEvidence({ item }: { item: Item }) {
  const { board } = useCanvas();
  const pr =
    item.item.subject.kind === 'pull-request'
      ? board.entities.pullRequests[item.item.subject.pullRequestId]
      : undefined;
  if (!pr) return null;
  const checks = pr.checks.state === 'known' ? pr.checks.value : undefined;
  const reviews = pr.reviews.state === 'known' ? pr.reviews.value : undefined;
  return (
    <span className="cc-evidence">
      <fieldset
        className="cc-checks"
        aria-label={
          checks
            ? `Checks: ${checks.state}. ${comparisonLabel(pr, checks.comparison)}`
            : 'Checks unknown'
        }
      >
        {checks ? (
          checks.groups.map((group) => {
            const qualifier = comparisonLabel(pr, checks.comparison),
              current = qualifier === 'Current comparison';
            const detail = `${group.name} · ${group.state} · ${group.completed}/${group.total} · ${group.requirement} · ${qualifier}${checks.complete ? '' : ' · Partial checks'}`;
            const mark = (
              <span
                key={group.id}
                className={`cc-check ${current ? group.state : 'unknown'}`}
                data-tip={detail}
              >
                <Icon kind={current ? group.state : 'unknown'} />
              </span>
            );
            return group.url && /^https?:/i.test(group.url) ? (
              <a
                key={group.id}
                href={group.url}
                target="_blank"
                rel="noreferrer"
                aria-label={detail}
              >
                {mark}
              </a>
            ) : (
              <span role="img" key={group.id} aria-label={detail}>
                {mark}
              </span>
            );
          })
        ) : (
          <span
            role="img"
            className="cc-check cc-muted"
            data-tip="Checks unknown"
            aria-label="Checks unknown"
          >
            ?
          </span>
        )}
        {checks && !checks.groups.length && (
          <span
            role="img"
            className="cc-muted"
            data-tip={`Checks: ${checks.state}`}
            aria-label={`Checks: ${checks.state}`}
          >
            —
          </span>
        )}
      </fieldset>
      {reviews ? (
        reviews.reviewers.map((review) => {
          const user = board.entities.users[review.userId],
            qualifier = comparisonLabel(pr, reviews.comparison);
          const approved = review.state === 'approved' && qualifier === 'Current comparison';
          const detail = `${user?.login ?? 'Unknown reviewer'} · ${review.state} · ${qualifier}${reviews.complete ? '' : ' · Partial reviews'}`;
          return (
            <span
              role="img"
              key={review.userId}
              className="cc-reviewer"
              data-tip={detail}
              aria-label={detail}
            >
              {user?.avatarUrl && /^https?:/i.test(user.avatarUrl) ? (
                <img src={user.avatarUrl} width="18" height="18" alt={user.login} />
              ) : (
                <span className="cc-avatar">{user?.login.slice(0, 1) ?? '?'}</span>
              )}
              <b className={approved ? 'approved' : 'requested'}>{approved ? '✓' : '·'}</b>
            </span>
          );
        })
      ) : (
        <span
          role="img"
          className="cc-muted"
          data-tip="Reviews unknown"
          aria-label="Reviews unknown"
        >
          ?
        </span>
      )}
      {reviews && !reviews.reviewers.length && (
        <span
          role="img"
          className="cc-muted"
          data-tip={`Reviews: ${reviews.state}`}
          aria-label={`Reviews: ${reviews.state}`}
        >
          —
        </span>
      )}
    </span>
  );
}
export function Fields({ id }: { id: number }) {
  const { metadata: issueMetadata } = useCanvas().data;
  const item = issueMetadata[id];
  return (
    <span className="cc-fields">
      <span
        className={item.priority === 'P0' ? 'cc-red' : item.priority === 'P1' ? 'cc-amber' : ''}
        data-tip={item.priority ? `GitHub Project priority: ${item.priority}` : 'Priority not set'}
      >
        {item.priority ?? (item.projectKnown ? 'P—' : '?')}
      </span>
      <span
        className="cc-size"
        data-tip={item.size ? `GitHub Project size: ${item.size}` : 'Size not set'}
      >
        {item.size ?? (item.projectKnown ? '—' : '?')}
      </span>
    </span>
  );
}
export function Labels({ id }: { id: number }) {
  const { metadata: issueMetadata } = useCanvas().data;
  const labels = issueMetadata[id].labels;
  return (
    <span className="cc-labels">
      {!issueMetadata[id].labelsKnown && (
        <span className="cc-unavailable cc-muted">Labels unavailable</span>
      )}
      {labels.slice(0, 2).map((l) => (
        <span
          className="cc-label"
          key={l.name}
          data-tip={l.name}
          style={{
            color: `color-mix(in srgb, #${l.color} 45%, #dce9e4)`,
            borderColor: `#${l.color}66`,
            background: `#${l.color}18`,
          }}
        >
          {l.name}
        </span>
      ))}
      {labels.length > 2 && (
        <span className="cc-label-more" data-label-list={id}>
          +{labels.length - 2}
        </span>
      )}
    </span>
  );
}
export function ParentTag({
  parent,
  nameKey,
  mode,
  expanded,
  highlighted,
}: {
  parent?: number;
  nameKey: string;
  mode: TitleMode;
  expanded: boolean;
  highlighted: boolean;
}) {
  const { metadata: issueMetadata, parentIds } = useCanvas().data;
  return parent ? (
    <span
      className={`cc-parent-tag ${highlighted ? 'cc-parent-highlighted' : ''}`}
      data-tip={
        mode === 'expand'
          ? undefined
          : `Parent #${issueMetadata[parent].number}: ${issueMetadata[parent].title}`
      }
      data-expand-title={mode === 'expand' ? nameKey : undefined}
      data-expanded={expanded}
    >
      <i className={parent === parentIds[0] ? 'cc-dot-green' : 'cc-dot-purple'} />
      <span>
        #{issueMetadata[parent].number ?? '?'} {issueMetadata[parent].title}
      </span>
    </span>
  ) : (
    <span
      role="img"
      className="cc-parent-tag cc-empty-tag"
      data-tip="No parent issue"
      aria-label="No parent issue"
    >
      —
    </span>
  );
}
function statusSummary(items: Item[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const status = item.status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const order = [
    'Conflict',
    'CI failed',
    'Repairing CI',
    'Restacking',
    'CI running',
    'Babysitting',
    'Needs review',
    'Ready',
  ];
  const rank = (status: string) => {
    const index = order.indexOf(status);
    return index < 0 ? order.length : index;
  };
  return [...counts]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.status.localeCompare(b.status));
}
export function StackSummary({ items }: { items: Item[] }) {
  const drafts = items.filter((i) => i.draft).length;
  const open = items.filter((i) => i.draft === false).length;
  const summary = statusSummary(items);
  return (
    <>
      <span className="cc-pr-counts">
        <span
          role="img"
          className="cc-pr-count cc-green"
          aria-label={`Open PRs: ${open}`}
          data-tip={`${open} published open pull requests`}
        >
          <Icon kind="pr" size={12} />
          <span>{open}</span>
        </span>
        <span
          role="img"
          className="cc-pr-count cc-muted"
          aria-label={`Draft PRs: ${drafts}`}
          data-tip={`${drafts} draft pull requests`}
        >
          <Icon kind="draft-pr" size={12} />
          <span>{drafts}</span>
        </span>
      </span>
      {items.some((i) => i.draft === undefined) && (
        <span className="cc-muted" data-tip="PR draft state unavailable">
          ? unknown
        </span>
      )}
      <span
        className="cc-stack-summary"
        data-tip={summary.map((s) => `${s.count} ${s.status}`).join(' · ')}
      >
        {summary.map(({ status, count }) => (
          <span
            key={status}
            className={`${statusAppearance(status).className} ${items.some((i) => i.status === status && i.active) ? 'cc-status-active' : ''}`}
          >
            {count} {status}
          </span>
        ))}
      </span>
    </>
  );
}
