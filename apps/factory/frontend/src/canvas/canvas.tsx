import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as Pointer,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Action, WorkItem } from '../../../src/http/index.js';
import type { Board } from './model';
import { createCanvasProjection } from './view-model';
import { canvasLayout, relationshipHighlights, stages } from './geometry';
import type {
  Box,
  CanvasFocus,
  Stage,
  TitleMode,
  RelationshipMode,
  RelationshipDirection,
} from './geometry-types';
import { routeCanvas } from './routing';
import {
  CanvasContext,
  Icon,
  Identity,
  Fields,
  Labels,
  ParentTag,
  Status,
  StackSummary,
  statusAppearance,
  CanvasThread,
  CanvasEvidence,
} from './canvas-presentation';
import { actionLabel } from './presentation';
import './canvas.css';
export function Canvas({
  board,
  native,
  busy,
  titleMode,
  reach,
  onDetails,
  onStart,
  onCommand,
  onSettings,
  onPlan,
  onStartIssue,
  onPause,
  canConfigure,
  children,
}: {
  board: Board;
  native: boolean;
  busy: boolean;
  titleMode: TitleMode;
  reach: RelationshipMode;
  onDetails: (item: WorkItem) => void;
  onStart: (item: WorkItem) => void;
  onCommand: (item: WorkItem, action: Action) => void;
  onSettings: () => void;
  onPlan: () => void;
  onStartIssue: () => void;
  onPause: () => void;
  canConfigure: boolean;
  children?: ReactNode;
}) {
  const [projection] = useState(createCanvasProjection);
  const fixture = useMemo(() => projection(board), [projection, board]);
  const issueMetadata = fixture.metadata;
  const highlightStyle = 'status-glow';
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set()),
    [hoverName, setHoverName] = useState<string>();
  const [hovered, setHovered] = useState<CanvasFocus>(),
    [locked, setLocked] = useState<CanvasFocus>();
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [relationshipFilter, setRelationshipFilter] = useState<{
    instance: string;
    direction: Exclude<RelationshipDirection, 'both'>;
  }>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const candidateFocus = locked ?? hovered;
  const focus =
      attentionOnly || !candidateFocus || !fixture.metadata[candidateFocus.id]
        ? undefined
        : candidateFocus,
    active = focus?.id,
    direction =
      relationshipFilter?.instance === focus?.instance
        ? (relationshipFilter?.direction ?? 'both')
        : 'both';
  const paused = board.meta.factory.paused;
  const [tooltip, setTooltip] = useState<{
    text: string;
    x: number;
    y: number;
    above: boolean;
    labels?: number;
  }>();
  const tipAnchor = useRef<Element | null>(null);
  useEffect(() => {
    if (tooltip?.labels && !issueMetadata[tooltip.labels]) {
      tipAnchor.current = null;
      setTooltip(undefined);
    }
  }, [issueMetadata, tooltip]);
  const data = useMemo(
    () => canvasLayout(fixture, { titleMode, expandedNames, hoverName, collapsed }),
    [fixture, titleMode, expandedNames, hoverName, collapsed]
  );
  const records = data.fixture.items;
  const attentionItems = records.filter((item) => item.item.attention.state === 'required');
  const attentionIds = new Set(attentionItems.map((item) => item.id));
  const allParents: Record<number, number> = { ...data.fixture.parentOf };
  for (const item of records) if (item.parent) allParents[item.id] = item.parent;
  const expandedName = (key: string) =>
    titleMode === 'expand' && (expandedNames.has(key) || hoverName === key);
  function title(text: string, key: string, className = 'cc-title') {
    return (
      <span
        className={className}
        data-expanded={expandedName(key)}
        data-expand-title={titleMode === 'expand' ? key : undefined}
        data-tip={titleMode === 'expand' ? undefined : text}
      >
        {text}
      </span>
    );
  }
  const routes = useMemo(
    () =>
      routeCanvas(
        [
          ...data.boxes,
          ...data.headerNodes,
          ...data.aggregateNodes,
          ...data.groups
            .filter((g) => !g.parent)
            .map((g, i) => ({
              id: -4_000_000 - i,
              x: g.x,
              y: g.y,
              width: g.collapsed ? g.headingWidth : g.width,
              height: g.head,
            })),
          ...data.panels.map((p, i) => ({
            id: -500 - i,
            x: p.x,
            y: p.y,
            width: p.width,
            height: 32,
          })),
          ...data.areas.map((a, i) => ({
            id: -100 - i,
            x: 20,
            y: a.y - 10,
            width: 310,
            height: 20,
          })),
          ...[...data.groups, ...data.panels].flatMap((g, i) =>
            [
              [g.x, g.y],
              [g.x + g.width, g.y],
              [g.x, g.y + g.height],
              [g.x + g.width, g.y + g.height],
            ].map(([x, y], j) => ({ id: -1000 - i * 4 - j, x, y, width: 0, height: 0 }))
          ),
        ],
        data.routingConnections,
        data.width,
        data.height
      ),
    [data]
  );
  const { prerequisites, dependants, related, highlightedParents, activeEdges } =
    relationshipHighlights(
      active,
      data.fixture.selectionConnections ?? data.connections,
      allParents,
      data.fixture.parentIds,
      reach,
      direction,
      data.fixture.selectionContextIds
    );
  const isActiveRoute = (r: { source: number; target: number }) =>
    data.routeRelationships
      .get(`${r.source}-${r.target}`)
      ?.some((e) => activeEdges.has(`${e.source}-${e.target}`)) ?? false;
  const [view, setView] = useState(() => ({
      x: 12,
      y:
        new URLSearchParams(location.search).get('focus') === 'review'
          ? 20 - (data.areas.find((a) => a.id === 'review')?.y ?? 0) * 0.9
          : 12,
      scale: 0.9,
    })),
    [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    drag = useRef<
      { id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | undefined
    >(undefined);
  const suppressCanvasClick = useRef(false);
  function lock(id: number, instance = `item:${id}`) {
    setAttentionOnly(false);
    setRelationshipFilter(undefined);
    setLocked((current) => (current?.instance === instance ? undefined : { id, instance }));
  }
  function filterRelationships(next: Exclude<RelationshipDirection, 'both'>) {
    if (!focus) return;
    setLocked(focus);
    setRelationshipFilter(
      direction === next ? undefined : { instance: focus.instance, direction: next }
    );
  }
  function toggleAttention() {
    setAttentionOnly(!attentionOnly);
    setLocked(undefined);
    setHovered(undefined);
    setRelationshipFilter(undefined);
    setTooltip(undefined);
    if (attentionOnly) return;
    const keys = new Set(
      data.fixture.stackSpecs
        .filter((stack) => stack.ids.some((id) => attentionIds.has(id)))
        .map((stack) => `stack:${stack.key}`)
    );
    for (const item of attentionItems) {
      if (item.stage === 'review') continue;
      keys.add(`${item.stage}-${item.parent ?? 'none'}`);
      for (let parent = item.parent; parent !== undefined; parent = data.fixture.parentOf[parent])
        keys.add(`${item.stage}-${parent}`);
    }
    setCollapsed((current) => new Set([...current].filter((key) => !keys.has(key))));
  }
  function toggleCollapsed(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setTooltip(undefined);
  }
  function collapseAll() {
    setCollapsed(new Set(data.areas.flatMap((area) => sectionKeys(area.id))));
    setTooltip(undefined);
  }
  function sectionKeys(stage: Stage) {
    return stage === 'review'
      ? data.fixture.stackSpecs.map((s) => `stack:${s.key}`)
      : [...data.fixture.parentIds, 'none'].map((id) => `${stage}-${id}`);
  }
  function collapseSection(stage: Stage) {
    setCollapsed((current) => new Set([...current, ...sectionKeys(stage)]));
    setTooltip(undefined);
  }
  function expandSection(stage: Stage) {
    const keys = new Set(sectionKeys(stage));
    setCollapsed((current) => new Set([...current].filter((key) => !keys.has(key))));
    setTooltip(undefined);
  }
  function expandAll() {
    setCollapsed(new Set());
    setTooltip(undefined);
  }
  function fit(rect?: { x: number; y: number; width: number; height: number }) {
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    const r = rect ?? { x: 0, y: 0, width: data.width, height: data.height };
    const scale = Math.min(
      1,
      (box.width - 60) / (r.width + 40),
      (box.height - 110) / (r.height + 40)
    );
    setView({ scale, x: (box.width - r.width * scale) / 2 - r.x * scale, y: 20 - r.y * scale });
  }
  function fitActive() {
    const ns = [...data.boxes, ...data.headerNodes].filter((n) => related.has(n.id));
    if (!ns.length) return;
    const x = Math.min(...ns.map((n) => n.x)),
      y = Math.min(...ns.map((n) => n.y));
    fit({
      x: x - 20,
      y: y - 20,
      width: Math.max(...ns.map((n) => n.x + n.width)) - x + 40,
      height: Math.max(...ns.map((n) => n.y + n.height)) - y + 40,
    });
  }
  function jump(stage: Stage) {
    const area = data.areas.find((a) => a.id === stage);
    if (area) setView((v) => ({ ...v, x: 12, y: 20 - area.y * v.scale }));
  }
  const zoom = useCallback((factor: number, p?: { x: number; y: number }) => {
    const el = viewport.current;
    if (!el) return;
    const point = p ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    setView((v) => {
      const scale = Math.min(1.8, Math.max(0.02, v.scale * factor));
      return {
        scale,
        x: point.x - ((point.x - v.x) * scale) / v.scale,
        y: point.y - ((point.y - v.y) * scale) / v.scale,
      };
    });
  }, []);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.cc-controls,.cc-minimap,.cc-selection')) return;
      event.preventDefault();
      setTooltip(undefined);
      if (event.ctrlKey || event.metaKey || (!event.shiftKey && Math.abs(event.deltaX) < 1)) {
        const rect = el.getBoundingClientRect();
        zoom(Math.exp(-event.deltaY * 0.002), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else
        setView((v) => ({
          ...v,
          x: v.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: v.y - (event.shiftKey ? 0 : event.deltaY),
        }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttentionOnly(false);
        setLocked(undefined);
        setHovered(undefined);
        setRelationshipFilter(undefined);
        setTooltip(undefined);
      }
      if ((event.target as Element).closest('input,textarea,select,button,a')) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fit();
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(1.2);
      }
      if (event.key === '-') {
        event.preventDefault();
        zoom(1 / 1.2);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function pointerDown(e: Pointer<HTMLDivElement>) {
    if (
      (e.target as Element).closest(
        '.cc-item,.cc-parent-head,.cc-selection,button,a,input,select,textarea,.cc-minimap'
      ) ||
      e.button !== 0
    )
      return;
    suppressCanvasClick.current = false;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: Pointer<HTMLDivElement>) {
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
      if (!d.moved) return;
      setDragging(true);
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
    }
  }
  function endDrag() {
    if (drag.current) suppressCanvasClick.current = drag.current.moved;
    drag.current = undefined;
    setDragging(false);
  }
  function showTip(event: Pointer<HTMLDivElement>) {
    const name =
      (event.target as Element).closest('[data-expand-title]')?.getAttribute('data-expand-title') ??
      undefined;
    if (titleMode === 'expand') setHoverName((current) => (current === name ? current : name));
    const anchor = (event.target as Element).closest('[data-tip],[data-label-list]');
    if (anchor === tipAnchor.current) return;
    tipAnchor.current = anchor;
    if (!anchor) {
      setTooltip(undefined);
      return;
    }
    const labelId = anchor.getAttribute('data-label-list');
    const text = labelId ? 'Labels' : anchor.getAttribute('data-tip');
    if (!text) return;
    const r = anchor.getBoundingClientRect();
    setTooltip({
      text,
      x: Math.max(8, Math.min(window.innerWidth - 368, r.left)),
      y: r.bottom + 7,
      above: r.bottom > window.innerHeight - 110,
      labels: labelId ? Number(labelId) : undefined,
    });
  }
  function attributes(id: number, instance = `item:${id}`) {
    return {
      'data-card': id,
      'data-focus-instance': instance,
      tabIndex: 0,
      role: 'group',
      'aria-label': `Select ${issueMetadata[id].title}`,
      onPointerEnter: () => setHovered({ id, instance }),
      onPointerLeave: () =>
        setHovered((current) => (current?.instance === instance ? undefined : current)),
      onFocus: () => setHovered({ id, instance }),
      onBlur: () => setHovered((current) => (current?.instance === instance ? undefined : current)),
      onClick: (e: React.MouseEvent) => {
        if (!(e.target as Element).closest('a,button')) {
          const key = (e.target as Element)
            .closest('[data-expand-title]')
            ?.getAttribute('data-expand-title');
          if (key && titleMode === 'expand')
            setExpandedNames((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          lock(id, instance);
        }
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          lock(id, instance);
        }
      },
    };
  }
  function itemCard(box: Box) {
    const { item } = box,
      meta = issueMetadata[item.id],
      itemStatus = item.status,
      isActive = active === item.id,
      isHighlighted = attentionOnly ? attentionIds.has(item.id) : isActive,
      connected = attentionOnly ? attentionIds.has(item.id) : related.has(item.id),
      isRelated = !attentionOnly && active !== undefined && connected && !isActive,
      edge = routes.find(
        (r) =>
          isActiveRoute(r) &&
          data.routeRelationships
            .get(`${r.source}-${r.target}`)
            ?.some((e) => e.source === item.id || e.target === item.id)
      );
    return (
      <div
        key={item.id}
        {...attributes(item.id)}
        className={`cc-item ${item.pr ? `cc-pr-row ${box.stacked ? '' : 'cc-solo-pr'}` : 'cc-issue-card'} ${item.active ? 'cc-active-job' : ''} ${isHighlighted ? 'cc-selected' : ''} ${isRelated ? 'cc-related' : ''} ${(attentionOnly || active !== undefined) && !connected ? 'cc-dimmed' : ''} `}
        style={
          {
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
            borderColor:
              isHighlighted && item.active
                ? undefined
                : (item.pr && isHighlighted) || (attentionOnly && connected)
                  ? highlightStyle === 'status-glow'
                    ? statusAppearance(itemStatus).color
                    : undefined
                  : active !== undefined && connected
                    ? highlightStyle === 'status-glow'
                      ? statusAppearance(itemStatus).color
                      : edge?.color
                    : undefined,
            '--cc-status-color': statusAppearance(itemStatus).color,
          } as CSSProperties
        }
      >
        {item.pr ? (
          <>
            <div className="cc-pr-top">
              <Identity item={item} />
              {<CanvasThread item={item} />}
              {title(meta.title, `issue:${item.id}`)}
              <Status status={itemStatus} active={item.active} />
              <Fields id={item.id} />
            </div>
            <div className="cc-pr-bottom">
              <Labels id={item.id} />
              <ParentTag
                parent={item.parent}
                nameKey={`badge:${item.id}`}
                mode={titleMode}
                expanded={expandedName(`badge:${item.id}`)}
                highlighted={!!item.parent && highlightedParents.has(item.parent)}
              />
              <CanvasEvidence item={item} />
            </div>
          </>
        ) : (
          <>
            <div className="cc-issue-top">
              <Identity item={item} />
              {<CanvasThread item={item} />}
              <Status status={itemStatus} active={item.active} />
              <Fields id={item.id} />
            </div>
            {title(meta.title, `issue:${item.id}`)}
            {(!!meta.labels.length || !meta.labelsKnown) && (
              <div className="cc-issue-bottom">
                <Labels id={item.id} />
              </div>
            )}
          </>
        )}
      </div>
    );
  }
  const activeGroup = data.groups.find((g) => g.key === focus?.instance);
  const activeRecord = records.find((i) => i.id === active),
    incident = routes.filter(isActiveRoute);
  return (
    <CanvasContext.Provider value={{ data: fixture, board, native }}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Background clicks clear canvas selection; Escape provides the keyboard action. */}
      <div
        role="presentation"
        className={`cc-app cc-titles-${titleMode} cc-highlight-${highlightStyle}`}
        style={{ '--cc-label-column': `${data.labelColumn}px` } as React.CSSProperties}
        onPointerMove={showTip}
        onPointerLeave={() => {
          tipAnchor.current = null;
          setTooltip(undefined);
          setHoverName(undefined);
        }}
        onClick={(e) => {
          if (
            !suppressCanvasClick.current &&
            !(e.target as Element).closest(
              '.cc-item,.cc-parent-head,.cc-selection,button,a,input,select,textarea,.cc-minimap'
            )
          ) {
            setAttentionOnly(false);
            setLocked(undefined);
            setHovered(undefined);
            setRelationshipFilter(undefined);
          }
          suppressCanvasClick.current = false;
        }}
      >
        <header className="cc-toolbar">
          <strong>Factory</strong>
          <span
            className={`cc-runtime ${paused ? 'cc-amber' : 'cc-green'}`}
            data-tip={
              paused
                ? 'New admissions are paused. Existing jobs continue.'
                : 'The factory can accept eligible work within its concurrency and admission limits.'
            }
          >
            <i />
            {paused ? 'Paused' : 'Running'}
          </span>
          <button
            type="button"
            className="cc-attention-toggle"
            aria-label={`Highlight ${attentionIds.size} items needing human attention`}
            aria-pressed={attentionOnly}
            disabled={attentionIds.size === 0 && !attentionOnly}
            data-tip="Highlight work the server identifies as needing human attention."
            onClick={toggleAttention}
          >
            <Icon kind="attention" size={13} />
            <span className="cc-attention-count">
              {attentionIds.size}
              {board.meta.coverage.state !== 'complete' ? '+' : ''}
            </span>{' '}
            need attention
          </button>
          {board.meta.dataMode === 'fake' && (
            <span className="cc-fixture" data-tip="Fake v2 server · commands are simulated">
              Fake data · commands are simulated
            </span>
          )}
          {Object.values(board.entities.items).some((i) => i.attention.state === 'unknown') && (
            <span className="cc-muted">Attention partly unknown</span>
          )}
          <span className="cc-toolbar-space" />
          <button type="button" onClick={onPlan}>
            ◇ Preview plan
          </button>
          <button type="button" onClick={onStartIssue}>
            + Start issue
          </button>
          <button
            type="button"
            onClick={onPause}
            disabled={busy || !canConfigure}
            data-tip="Pause new admissions. Existing jobs continue."
          >
            {paused ? '▶ Resume' : 'Ⅱ Pause'}
          </button>
          <button
            type="button"
            className="cc-settings-button"
            aria-label="Factory settings"
            onClick={onSettings}
          >
            <Icon kind="gear" size={18} />
          </button>
        </header>
        <div
          className={`cc-viewport ${dragging ? 'dragging' : ''}`}
          ref={viewport}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <div
            className="cc-world"
            style={{
              width: data.width,
              height: data.height,
              transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
            }}
          >
            {data.areas.map((area) => (
              <section
                className="cc-area"
                data-area={area.id}
                key={area.id}
                style={{ left: 16, top: area.y, width: area.width - 16, height: area.height }}
              >
                <h2>
                  <i className={`cc-stage-dot ${area.id}`} />
                  {area.name}
                  <span>{records.filter((i) => i.stage === area.id).length}</span>
                  <button
                    type="button"
                    aria-label={`Collapse all ${area.name}`}
                    onClick={() => collapseSection(area.id)}
                  >
                    <Icon kind="collapse" size={12} />
                    Collapse all
                  </button>
                  <button
                    type="button"
                    aria-label={`Expand all ${area.name}`}
                    onClick={() => expandSection(area.id)}
                  >
                    <Icon kind="expand" size={12} />
                    Expand all
                  </button>
                </h2>
              </section>
            ))}
            {data.groups.map((group) => (
              <section
                className={`cc-parent-group ${group.parent ? '' : 'cc-unparented'} ${group.collapsed ? 'cc-collapsed' : ''} ${highlightedParents.has(group.parent ?? -1) ? 'cc-group-selected' : ''}`}
                key={group.key}
                data-group={group.key}
                style={
                  {
                    left: group.x,
                    top: group.y,
                    width: group.width,
                    height: group.height,
                    zIndex: 1 + group.depth * 0.1,
                    '--cc-parent-accent':
                      group.parent === fixture.parentIds[0] ? '#62bea0' : '#b19ad8',
                    borderColor: highlightedParents.has(group.parent ?? -1)
                      ? routes.find(
                          (r) =>
                            (r.source === active && r.target === group.parent) ||
                            (r.target === active && r.source === group.parent)
                        )?.color
                      : undefined,
                  } as CSSProperties
                }
              >
                {group.parent ? (
                  <div
                    {...attributes(group.parent, group.key)}
                    className={`cc-parent-head ${focus?.instance === group.key ? 'cc-parent-focused' : ''}`}
                    style={{ height: group.head - (group.collapsed ? 2 : 0) }}
                  >
                    <button
                      type="button"
                      className={`cc-collapse ${group.collapsed ? '' : 'cc-expanded'}`}
                      aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} parent #${issueMetadata[group.parent].number} in ${stages.find((s) => s.id === group.stage)?.name}`}
                      aria-expanded={!group.collapsed}
                      onClick={() => toggleCollapsed(group.key)}
                    >
                      <Icon kind={group.collapsed ? 'expand' : 'collapse'} size={14} />
                    </button>
                    <i
                      className={
                        group.parent === fixture.parentIds[0] ? 'cc-dot-green' : 'cc-dot-purple'
                      }
                    />
                    <span className="cc-heading-text cc-parent-copy">
                      {issueMetadata[group.parent].url ? (
                        <a
                          className="cc-parent-number"
                          href={issueMetadata[group.parent].url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          #{issueMetadata[group.parent].number ?? '?'}
                        </a>
                      ) : (
                        <span
                          className="cc-synthetic-number cc-parent-number"
                          data-tip="GitHub destination unavailable"
                        >
                          #{issueMetadata[group.parent].number ?? '?'}
                        </span>
                      )}
                      {title(
                        issueMetadata[group.parent].title,
                        `parent:${group.stage}:${group.parent}`,
                        'cc-parent-name'
                      )}
                      <span className="cc-group-count">{group.ids.length}</span>
                    </span>
                  </div>
                ) : (
                  <div
                    className="cc-parent-head cc-no-parent-heading"
                    style={{
                      height: group.head,
                      width: group.collapsed ? group.headingWidth : undefined,
                    }}
                  >
                    <button
                      type="button"
                      className={`cc-collapse ${group.collapsed ? '' : 'cc-expanded'}`}
                      aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} unparented issues in ${stages.find((s) => s.id === group.stage)?.name}`}
                      aria-expanded={!group.collapsed}
                      onClick={() => toggleCollapsed(group.key)}
                    >
                      <Icon kind={group.collapsed ? 'expand' : 'collapse'} size={14} />
                    </button>
                    <span className="cc-heading-text cc-unparented-copy">
                      <span>Unparented issues</span>
                      <span className="cc-group-count">{group.ids.length}</span>
                    </span>
                  </div>
                )}
              </section>
            ))}
            {data.panels.map((panel) => (
              <section
                key={panel.key}
                className={`cc-pr-panel ${panel.stacked ? 'cc-stacked' : 'cc-independent'} ${panel.collapsed ? 'cc-collapsed' : ''}`}
                data-stack={panel.key}
                style={
                  {
                    left: panel.x,
                    top: panel.y,
                    width: panel.width,
                    height: panel.height,
                  } as CSSProperties
                }
              >
                <div className="cc-panel-title">
                  <button
                    type="button"
                    className={`cc-collapse ${panel.collapsed ? '' : 'cc-expanded'}`}
                    aria-label={`${panel.collapsed ? 'Expand' : 'Collapse'} ${panel.stacked ? 'stack' : 'independent PRs'} ${panel.key}`}
                    aria-expanded={!panel.collapsed}
                    onClick={() => toggleCollapsed(`stack:${panel.key}`)}
                  >
                    <Icon kind={panel.collapsed ? 'expand' : 'collapse'} size={14} />
                  </button>

                  <span className="cc-stack-heading">
                    {!panel.stacked && panel.name}
                    <StackSummary items={records.filter((i) => panel.ids.includes(i.id))} />
                    {panel.stacked && !panel.collapsed && (
                      <span className="cc-base-direction">tip ↑ · base ↓</span>
                    )}
                  </span>
                </div>
              </section>
            ))}
            <svg className="cc-lines" width={data.width} height={data.height} aria-hidden="true">
              <defs>
                {routes.map((r) => (
                  <marker
                    id={`cc-arrow-${r.key}`}
                    key={r.key}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="m2 2 6 3-6 3" fill="none" stroke={r.color} strokeWidth="1.8" />
                  </marker>
                ))}
              </defs>
              {[...routes]
                .sort((a, b) => Number(isActiveRoute(a)) - Number(isActiveRoute(b)))
                .map((r) => (
                  <g
                    key={r.key}
                    className={
                      attentionOnly || active ? (isActiveRoute(r) ? 'active' : 'muted') : ''
                    }
                  >
                    <path className="cc-line-halo" d={r.d} />
                    <path
                      className="cc-line"
                      data-edge={r.key}
                      data-points={JSON.stringify(r.points)}
                      data-failed={r.failed}
                      d={r.d}
                      stroke={r.color}
                      markerStart={`url(#cc-arrow-${r.key})`}
                    />
                  </g>
                ))}
            </svg>
            {data.boxes.map(itemCard)}
            <svg
              className="cc-endpoints"
              width={data.width}
              height={data.height}
              aria-hidden="true"
            >
              {incident.flatMap((r) =>
                [r.points[0], r.points[r.points.length - 1]].map((p) => (
                  <g key={`${r.key}-${p.x}-${p.y}`} transform={`translate(${p.x},${p.y})`}>
                    <circle r="3" fill="#111117" stroke={r.color} strokeWidth="1.5" />
                  </g>
                ))
              )}
            </svg>
          </div>
          {!records.length && (
            <p className="cc-empty">
              {board.meta.coverage.state === 'complete'
                ? 'No work items.'
                : 'Work items unavailable. Check source coverage.'}
            </p>
          )}
          <nav className="cc-controls" aria-label="Canvas navigation">
            <button type="button" aria-label="Collapse all sections" onClick={collapseAll}>
              <Icon kind="collapse" size={13} />
              Collapse all
            </button>
            <button type="button" aria-label="Expand all sections" onClick={expandAll}>
              <Icon kind="expand" size={13} />
              Expand all
            </button>
            <i />
            {stages
              .filter((s) => data.areas.some((area) => area.id === s.id))
              .map((s) => (
                <button type="button" key={s.id} onClick={() => jump(s.id)}>
                  {s.name}
                </button>
              ))}
            <i />
            <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
              −
            </button>
            <span>{Math.round(view.scale * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>
              +
            </button>
            <button type="button" aria-label="Fit all nodes" onClick={() => fit()}>
              <Icon kind="fit" />
            </button>
          </nav>
          {active && (
            <div className="cc-selection" role="toolbar" aria-label="Selected item actions">
              <div className="cc-selection-content">
                <strong className="cc-selection-identity">
                  {activeRecord ? (
                    <Identity item={activeRecord} />
                  ) : issueMetadata[active]?.url ? (
                    <a href={issueMetadata[active].url} target="_blank" rel="noreferrer">
                      #{issueMetadata[active].number ?? '?'}
                    </a>
                  ) : (
                    <span data-tip="GitHub destination unavailable">
                      #{issueMetadata[active].number ?? '?'}
                    </span>
                  )}
                </strong>
                {activeRecord && <CanvasThread item={activeRecord} />}
                {activeGroup && <span>{stages.find((s) => s.id === activeGroup.stage)?.name}</span>}
                <button
                  type="button"
                  className="cc-relationship-filter"
                  aria-label="Highlight prerequisites"
                  aria-pressed={direction === 'prerequisites'}
                  data-tip="Highlight only prerequisites. Click again to show both directions."
                  onClick={() => filterRelationships('prerequisites')}
                >
                  {prerequisites.size} prerequisites
                </button>
                <button
                  type="button"
                  className="cc-relationship-filter"
                  aria-label="Highlight dependants"
                  aria-pressed={direction === 'dependants'}
                  data-tip="Highlight only dependants. Click again to show both directions."
                  onClick={() => filterRelationships('dependants')}
                >
                  {dependants.size} dependants
                </button>
              </div>
              <div className="cc-selection-actions">
                <button
                  type="button"
                  aria-label="Fit connections"
                  data-tip="Fit highlighted connections"
                  onClick={fitActive}
                >
                  <Icon kind="eye" />
                </button>
                {activeRecord && (
                  <>
                    <button type="button" onClick={() => onDetails(activeRecord.item)}>
                      Details
                    </button>
                    {activeRecord.item.actionIds.map((id) => {
                      const action = board.entities.actions[id];
                      if (!action || action.kind === 'configure' || action.kind === 'preview-plan')
                        return null;
                      const label = actionLabel(board, activeRecord.item, action);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`cc-action-${action.kind}`}
                          aria-label={label}
                          disabled={busy || action.availability.state !== 'available'}
                          data-tip={
                            action.availability.state === 'available'
                              ? label
                              : action.availability.reasons.map((r) => r.message).join(' ')
                          }
                          onClick={() =>
                            action.kind === 'start'
                              ? onStart(activeRecord.item)
                              : onCommand(activeRecord.item, action)
                          }
                        >
                          <Icon kind={action.kind === 'cancel' ? 'stop' : 'play'} />
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}
          <svg
            className="cc-minimap"
            viewBox={`0 0 ${data.width} ${data.height}`}
            preserveAspectRatio="none"
            style={{ width: 144, height: Math.min(160, (144 * data.height) / data.width) }}
            aria-label="Canvas minimap"
            onPointerDown={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect(),
                x = ((e.clientX - r.left) / r.width) * data.width,
                y = ((e.clientY - r.top) / r.height) * data.height;
              const el = viewport.current;
              if (el)
                setView((v) => ({
                  ...v,
                  x: el.clientWidth / 2 - x * v.scale,
                  y: el.clientHeight / 2 - y * v.scale,
                }));
            }}
          >
            {data.areas.map((a) => (
              <rect
                key={a.id}
                className="cc-map-area"
                x="16"
                y={a.y}
                width={a.width - 32}
                height={a.height}
              />
            ))}
            {data.boxes.map((b) => (
              <rect
                className={`cc-map-card ${b.item.stage}`}
                key={b.id}
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
              />
            ))}
            <rect
              className="cc-map-view"
              x={-view.x / view.scale}
              y={-view.y / view.scale}
              width={(viewport.current?.clientWidth ?? 1280) / view.scale}
              height={(viewport.current?.clientHeight ?? 800) / view.scale}
            />
          </svg>
        </div>
        {children}
        {tooltip && (!tooltip.labels || issueMetadata[tooltip.labels]) && (
          <div
            className="cc-tooltip"
            role="tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.above ? undefined : tooltip.y,
              bottom: tooltip.above ? window.innerHeight - tooltip.y + 20 : undefined,
            }}
          >
            {tooltip.labels ? (
              <>
                <strong>Labels</strong>
                <div className="cc-tooltip-labels">
                  {issueMetadata[tooltip.labels].labels.map((l) => (
                    <span
                      className="cc-label"
                      key={l.name}
                      style={{
                        color: `color-mix(in srgb,#${l.color} 45%,#edf2ef)`,
                        borderColor: `#${l.color}80`,
                        background: `#${l.color}25`,
                      }}
                    >
                      {l.name}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              tooltip.text
            )}
          </div>
        )}
      </div>
    </CanvasContext.Provider>
  );
}
