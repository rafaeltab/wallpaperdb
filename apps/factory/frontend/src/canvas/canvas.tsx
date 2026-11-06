import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, WorkItem } from '../../../src/http/index.js';
import { type Board, layout, related, relatedItems, subject, title } from './model';
import { CardContent, Icon, External, Threads, actionLabel } from './presentation';
export function Canvas({
  board,
  native,
  onDetails,
  onStart,
  onCommand,
  busy,
}: {
  board: Board;
  native: boolean;
  onDetails: (item: WorkItem) => void;
  onStart: (item: WorkItem) => void;
  onCommand: (item: WorkItem, action: Action) => void;
  busy: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<WorkItem['id']>();
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [direction, setDirection] = useState<'prerequisites' | 'dependants'>('prerequisites');
  const [attention, setAttention] = useState(false);
  const [view, setView] = useState({ x: 16, y: 16, scale: 0.8 });
  const viewport = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; vx: number; vy: number } | undefined>(undefined);
  const graph = useMemo(() => layout(board, collapsed), [board, collapsed]);
  const item = selected ? board.entities.items[selected] : undefined;
  const selectedSubject = item ? subject(board, item) : undefined;
  const group = graph.groups.find((g) => g.key === selectedGroup);
  const relatives = useMemo(
    () =>
      item
        ? related(board, item, direction)
        : group
          ? relatedItems(board, group.items, direction)
          : new Set<string>(),
    [board, item, group, direction]
  );
  const seedIds = new Set<string>(item ? [item.id] : (group?.items.map((i) => i.id) ?? []));
  const attentionItems = Object.values(board.entities.items).filter(
    (i) => i.attention.state === 'required'
  );
  const unknown = Object.values(board.entities.items).filter(
    (i) => i.attention.state === 'unknown'
  ).length;
  function fitCanvas(ids?: Set<string>) {
    const el = viewport.current;
    if (!el) return;
    const candidates = [...graph.cards, ...graph.groups.filter((g) => g.collapsed)];
    const nodes = ids
      ? candidates.filter(
          (c) => ids.has(c.id) || ('items' in c && c.items.some((i) => ids.has(i.id)))
        )
      : candidates;
    const routes = ids
      ? graph.routes.filter((r) => ids.has(r.source) && ids.has(r.target))
      : graph.routes;
    const bounds = [
      ...nodes,
      ...(!ids
        ? graph.areas.map((area) => ({ x: 32, y: area.y - 20, width: 350, height: 30 }))
        : []),
      ...routes.flatMap((r) => r.points.map((p) => ({ ...p, width: 0, height: 0 }))),
    ];
    const x = bounds.length ? Math.min(...bounds.map((n) => n.x)) - 32 : 0,
      y = bounds.length ? Math.min(...bounds.map((n) => n.y)) - 48 : 0;
    const w = bounds.length ? Math.max(...bounds.map((n) => n.x + n.width)) - x + 48 : graph.width,
      h = bounds.length ? Math.max(...bounds.map((n) => n.y + n.height)) - y + 48 : graph.height;
    const scale = Math.min(
      1.2,
      Math.max(0.12, Math.min(el.clientWidth / w, (el.clientHeight - 60) / h))
    );
    setView({ x: (el.clientWidth - w * scale) / 2 - x * scale, y: 24 - y * scale, scale });
  }
  function toggle(key: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    function wheel(e: WheelEvent) {
      e.preventDefault();
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) return;
      setView((v) => {
        const scale = Math.max(0.12, Math.min(1.6, v.scale * Math.exp(-e.deltaY * 0.001)));
        const x = e.clientX - rect.left,
          y = e.clientY - rect.top;
        return {
          scale,
          x: x - ((x - v.x) * scale) / v.scale,
          y: y - ((y - v.y) * scale) / v.scale,
        };
      });
    }
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  return (
    <section className="fc-canvas-shell" aria-label="Factory canvas">
      <div className="fc-canvas-toolbar">
        <button type="button" aria-pressed={attention} onClick={() => setAttention(!attention)}>
          {attentionItems.length}
          {board.meta.coverage.state !== 'complete' ? '+' : ''} need attention
        </button>
        {unknown > 0 && <span>{unknown} attention unknown</span>}
        <span className="fc-space" />
        <button
          type="button"
          aria-label="Pan left"
          onClick={() => setView((v) => ({ ...v, x: v.x + 80 }))}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Pan right"
          onClick={() => setView((v) => ({ ...v, x: v.x - 80 }))}
        >
          →
        </button>
        <button
          type="button"
          aria-label="Pan up"
          onClick={() => setView((v) => ({ ...v, y: v.y + 80 }))}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Pan down"
          onClick={() => setView((v) => ({ ...v, y: v.y - 80 }))}
        >
          ↓
        </button>
        <button type="button" onClick={() => fitCanvas()}>
          Fit all
        </button>
        <button
          type="button"
          onClick={() => setView((v) => ({ ...v, scale: Math.min(1.6, v.scale * 1.2) }))}
          aria-label="Zoom in"
        >
          +
        </button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setView((v) => ({ ...v, scale: Math.max(0.12, v.scale / 1.2) }))}
        >
          −
        </button>
      </div>
      <div
        className="fc-viewport"
        ref={viewport}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('button,a,[data-card]')) return;
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        <div
          className="fc-world"
          style={{
            width: graph.width,
            height: graph.height,
            transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
          }}
        >
          {graph.areas.map((area) => (
            <section
              className="fc-area"
              key={area.id}
              style={{ top: area.y, width: graph.width - 64, height: area.height }}
              aria-label={area.name}
            >
              <h2>
                {area.name}
                <span>{area.count}</span>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed(
                      (prev) =>
                        new Set([
                          ...prev,
                          ...graph.groups.filter((g) => g.stage === area.id).map((g) => g.key),
                        ])
                    )
                  }
                >
                  <Icon kind="collapse" />
                  Collapse all
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed(
                      (prev) => new Set([...prev].filter((key) => !key.startsWith(`${area.id}:`)))
                    )
                  }
                >
                  <Icon kind="expand" />
                  Expand all
                </button>
              </h2>
            </section>
          ))}
          {graph.groups.map((group) => (
            <div
              key={group.key}
              className={`fc-group${group.parent ? ' fc-parent' : ''}${group.stack ? ' fc-stack' : ''}${selectedGroup === group.key ? ' fc-selected-group' : ''}`}
              style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
            >
              <div className="fc-group-heading">
                <button
                  type="button"
                  className="fc-collapse-button"
                  aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.name}`}
                  aria-expanded={!group.collapsed}
                  onClick={() => toggle(group.key)}
                >
                  <Icon kind={group.collapsed ? 'expand' : 'collapse'} />
                </button>
                <button
                  type="button"
                  className="fc-group-name"
                  aria-pressed={selectedGroup === group.key}
                  onClick={() => {
                    setSelected(undefined);
                    setSelectedGroup(group.key);
                  }}
                >
                  <span>
                    {group.parent && `#${group.parent.number} `}
                    {group.name}
                  </span>
                </button>
                <small>{group.items.length}</small>
                {group.stack && (
                  <>
                    <span className="fc-stack-summary" title={summarize(group.items)}>
                      {summarize(group.items)}
                    </span>
                    <span className="fc-stack-count">
                      <Icon kind="pr" />
                      {
                        group.items.filter((i) => {
                          const s = i.subject;
                          const meta =
                            s.kind === 'pull-request'
                              ? board.entities.pullRequests[s.pullRequestId]?.metadata
                              : undefined;
                          return meta?.state === 'known' && !meta.value.draft;
                        }).length
                      }
                      <Icon kind="draft" />
                      {
                        group.items.filter((i) => {
                          const s = i.subject;
                          const meta =
                            s.kind === 'pull-request'
                              ? board.entities.pullRequests[s.pullRequestId]?.metadata
                              : undefined;
                          return meta?.state === 'known' && meta.value.draft;
                        }).length
                      }
                    </span>
                    <span className="fc-stack-direction">
                      Tip ↑ · Base ↓ {group.stack.base.ref}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
          <svg className="fc-routes" width={graph.width} height={graph.height} aria-hidden="true">
            <defs>
              <marker
                id="fc-arrow"
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3"
                orient="auto-start-reverse"
              >
                <path d="M0 0L6 3L0 6" fill="none" stroke="context-stroke" />
              </marker>
            </defs>
            {graph.routes.map((route) => {
              const highlighted =
                !attention &&
                (seedIds.has(route.source) || relatives.has(route.source)) &&
                (seedIds.has(route.target) || relatives.has(route.target));
              return (
                <path
                  key={route.key}
                  d={route.d}
                  fill="none"
                  stroke={highlighted ? route.color : '#51515f'}
                  strokeWidth={highlighted ? 2 : 1}
                  opacity={attention ? 0.15 : (item || group) && !highlighted ? 0.15 : 0.7}
                  markerEnd="url(#fc-arrow)"
                />
              );
            })}
          </svg>
          {graph.cards.map((card) => {
            const chosen = item?.id === card.item.id,
              highlight = attention
                ? card.item.attention.state === 'required'
                : seedIds.has(card.item.id) || relatives.has(card.item.id),
              dim = attention ? !highlight : !!(item || group) && !highlight;
            return (
              <article
                key={card.id}
                data-card
                className={`fc-card${card.item.subject.kind === 'pull-request' ? ' fc-pr' : ''}${chosen ? ' fc-selected' : ''}${highlight ? ' fc-highlight' : ''}${dim ? ' fc-dimmed' : ''}${card.item.status.active ? ' fc-running' : ''}`}
                style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
              >
                <button
                  className="fc-card-select"
                  type="button"
                  aria-label={`Select ${title(subject(board, card.item))}`}
                  aria-pressed={chosen}
                  onClick={() => {
                    setSelectedGroup(undefined);
                    setSelected(card.item.id);
                  }}
                />
                <CardContent board={board} item={card.item} native={native} />
              </article>
            );
          })}
        </div>
        {!Object.keys(board.entities.items).length && (
          <p className="fc-empty">
            {board.meta.coverage.state === 'complete'
              ? 'No work items.'
              : 'Work items unavailable. Check source coverage.'}
          </p>
        )}
      </div>
      {group && !item && (
        <div className="fc-selection" role="toolbar" aria-label="Selected group actions">
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => setSelectedGroup(undefined)}
          >
            ×
          </button>
          <span>{group.name}</span>
          <External
            href={group.parent?.metadata.state === 'known' ? group.parent.metadata.value.url : null}
          >
            {group.parent ? `#${group.parent.number}` : ''}
          </External>
          <button
            type="button"
            aria-pressed={direction === 'prerequisites'}
            onClick={() => setDirection('prerequisites')}
          >
            Prerequisites {relatedItems(board, group.items, 'prerequisites').size}
          </button>
          <button
            type="button"
            aria-pressed={direction === 'dependants'}
            onClick={() => setDirection('dependants')}
          >
            Dependants {relatedItems(board, group.items, 'dependants').size}
          </button>
          <button
            type="button"
            title="Fit connections"
            onClick={() => fitCanvas(new Set([...seedIds, ...relatives]))}
          >
            <Icon kind="eye" />
          </button>
        </div>
      )}
      {item && (
        <div className="fc-selection" role="toolbar" aria-label="Selected work item actions">
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              setSelected(undefined);
              setSelectedGroup(undefined);
            }}
          >
            ×
          </button>
          <External
            href={
              selectedSubject?.metadata.state === 'known'
                ? selectedSubject.metadata.value.url
                : null
            }
          >
            #{selectedSubject?.number}
          </External>
          <Threads board={board} item={item} native={native} />
          <button type="button" onClick={() => onDetails(item)}>
            Details
          </button>
          <button
            type="button"
            aria-pressed={direction === 'prerequisites'}
            onClick={() => setDirection('prerequisites')}
          >
            Prerequisites {related(board, item, 'prerequisites').size}
          </button>
          <button
            type="button"
            aria-pressed={direction === 'dependants'}
            onClick={() => setDirection('dependants')}
          >
            Dependants {related(board, item, 'dependants').size}
          </button>
          <button
            type="button"
            title="Fit connections"
            onClick={() => fitCanvas(new Set([item.id, ...relatives]))}
          >
            <Icon kind="eye" />
          </button>
          {item.actionIds.map((id) => {
            const a = board.entities.actions[id];
            if (!a || a.kind === 'configure' || a.kind === 'preview-plan') return null;
            return (
              <button
                type="button"
                className={`fc-action-${a.kind}`}
                key={id}
                aria-label={actionLabel(board, item, a)}
                disabled={busy || a.availability.state !== 'available'}
                title={
                  a.availability.state === 'available'
                    ? actionLabel(board, item, a)
                    : a.availability.reasons.map((r) => r.message).join(' ')
                }
                onClick={() => (a.kind === 'start' ? onStart(item) : onCommand(item, a))}
              >
                <Icon kind={a.kind === 'cancel' ? 'stop' : 'play'} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function summarize(items: readonly WorkItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.status.label, (counts.get(item.status.label) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ');
}
