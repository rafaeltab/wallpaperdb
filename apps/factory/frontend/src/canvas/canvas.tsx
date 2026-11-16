import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Action, WorkItem } from '../../../src/http/index.js';
import type { Board } from './model';
import {
  createProjectCanvasScene,
  bindProjectCanvasScene,
  type ProjectCanvasGeometry,
} from './project-canvas-scene';
import {
  createItemDependencyLinkInput,
  type ItemDependencyLinkInput,
} from './item-dependency-links';
import { useItemDependencyLinks } from './use-item-dependency-links';
import { ProjectCanvasViewport, type ProjectCanvasViewportHandle } from './project-canvas-viewport';
import { ProjectCanvasTooltip, type ProjectCanvasTooltipHandle } from './project-canvas-tooltip';
import { useProjectCanvasMotion } from './project-canvas-motion';
import { ProjectItemPresentation } from './project-item-presentation';
import { relationshipHighlights, stages } from './geometry';
import type {
  Box,
  CanvasFocus,
  Stage,
  TitleMode,
  RelationshipMode,
  RelationshipDirection,
} from './geometry-types';
import { AttentionControl } from './sources';
import {
  CanvasContext,
  Icon,
  Identity,
  StackSummary,
  statusAppearance,
  CanvasThread,
} from './canvas-presentation';
import { actionLabel, retryExplanation } from './presentation';
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
  notice,
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
  notice?: ReactNode;
}) {
  const [scene] = useState(createProjectCanvasScene);
  const motionRoot = useProjectCanvasMotion();
  const tooltip = useRef<ProjectCanvasTooltipHandle>(null);
  const viewport = useRef<ProjectCanvasViewportHandle>(null);
  const hideTooltip = useCallback(() => tooltip.current?.hide(), []);
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
  const targetScene = useMemo(
    () => scene(board, { titleMode, expandedNames, hoverName, collapsed }),
    [scene, board, titleMode, expandedNames, hoverName, collapsed]
  );
  const dependencyInput = useMemo(
    () => createItemDependencyLinkInput(targetScene.geometry),
    [targetScene.geometry]
  );
  const routing = useItemDependencyLinks(dependencyInput);
  const published = useRef<
    { input: ItemDependencyLinkInput; geometry: ProjectCanvasGeometry } | undefined
  >(undefined);
  if (routing.input === dependencyInput)
    published.current = { input: dependencyInput, geometry: targetScene.geometry };
  const geometry = published.current?.geometry ?? targetScene.geometry;
  const fixture = useMemo(
    () =>
      geometry.fixture === targetScene.layout.fixture
        ? targetScene.layout.fixture
        : {
            ...targetScene.layout.fixture,
            metadata: { ...geometry.fixture.metadata, ...targetScene.layout.fixture.metadata },
          },
    [geometry, targetScene.layout.fixture]
  );
  const data = useMemo(() => bindProjectCanvasScene(geometry, fixture), [geometry, fixture]);
  const routingMatchesGeometry = routing.input === published.current?.input;
  const routes = useMemo(() => {
    if (!routingMatchesGeometry) return [];
    // Deleted Project items disappear immediately; remove their links in the same render.
    const endpoints = new Set(
      [...data.boxes, ...data.headerNodes, ...data.aggregateNodes].map((node) => node.id)
    );
    const items = new Set([...fixture.items.map((item) => item.id), ...fixture.parentIds]);
    return routing.links.filter(
      (link) =>
        endpoints.has(link.source) &&
        endpoints.has(link.target) &&
        data.routeRelationships
          .get(`${link.source}-${link.target}`)
          ?.some((dependency) => items.has(dependency.source) && items.has(dependency.target))
    );
  }, [
    routingMatchesGeometry,
    routing.links,
    data.boxes,
    data.headerNodes,
    data.aggregateNodes,
    data.routeRelationships,
    fixture.items,
    fixture.parentIds,
  ]);
  const issueMetadata = fixture.metadata;
  const candidateFocus = locked ?? hovered;
  const focus =
      attentionOnly || !candidateFocus || !targetScene.layout.fixture.metadata[candidateFocus.id]
        ? undefined
        : candidateFocus,
    active = focus?.id,
    direction =
      relationshipFilter?.instance === focus?.instance
        ? (relationshipFilter?.direction ?? 'both')
        : 'both';
  const paused = board.meta.factory.paused;
  const records = data.fixture.items;
  const attentionItems = records.filter((item) => item.item.attention.state === 'required');
  const attentionIds = new Set(attentionItems.map((item) => item.id));
  const allParents = useMemo(() => {
    const parents = { ...data.fixture.parentOf };
    for (const item of records) if (item.parent) parents[item.id] = item.parent;
    return parents;
  }, [data.fixture.parentOf, records]);
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
  const { prerequisites, dependants, related, highlightedParents, activeEdges } = useMemo(
    () =>
      relationshipHighlights(
        active,
        data.fixture.selectionConnections ?? data.connections,
        allParents,
        data.fixture.parentIds,
        reach,
        direction,
        data.fixture.selectionContextIds
      ),
    [
      active,
      data.fixture.selectionConnections,
      data.connections,
      allParents,
      data.fixture.parentIds,
      reach,
      direction,
      data.fixture.selectionContextIds,
    ]
  );
  const isActiveRoute = (r: { source: number; target: number }) =>
    data.routeRelationships
      .get(`${r.source}-${r.target}`)
      ?.some((e) => activeEdges.has(`${e.source}-${e.target}`)) ?? false;
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
    hideTooltip();
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
    hideTooltip();
  }
  function collapseAll() {
    setCollapsed(new Set(data.areas.flatMap((area) => sectionKeys(area.id))));
    hideTooltip();
  }
  function sectionKeys(stage: Stage) {
    return stage === 'review'
      ? data.fixture.stackSpecs.map((s) => `stack:${s.key}`)
      : [...data.fixture.parentIds, 'none'].map((id) => `${stage}-${id}`);
  }
  function collapseSection(stage: Stage) {
    setCollapsed((current) => new Set([...current, ...sectionKeys(stage)]));
    hideTooltip();
  }
  function expandSection(stage: Stage) {
    const keys = new Set(sectionKeys(stage));
    setCollapsed((current) => new Set([...current].filter((key) => !keys.has(key))));
    hideTooltip();
  }
  function expandAll() {
    setCollapsed(new Set());
    hideTooltip();
  }
  function fitActive() {
    const ns = [...data.boxes, ...data.headerNodes].filter((n) => related.has(n.id));
    if (!ns.length) return;
    const x = Math.min(...ns.map((n) => n.x)),
      y = Math.min(...ns.map((n) => n.y));
    viewport.current?.fit({
      x: x - 20,
      y: y - 20,
      width: Math.max(...ns.map((n) => n.x + n.width)) - x + 40,
      height: Math.max(...ns.map((n) => n.y + n.height)) - y + 40,
    });
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttentionOnly(false);
        setLocked(undefined);
        setHovered(undefined);
        setRelationshipFilter(undefined);
        hideTooltip();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [hideTooltip]);
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
      isRelated = !attentionOnly && active !== undefined && connected && !isActive;
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
                : (item.pr && isHighlighted) ||
                    (attentionOnly && connected) ||
                    (active !== undefined && connected)
                  ? statusAppearance(itemStatus).color
                  : undefined,
            '--cc-status-color': statusAppearance(itemStatus).color,
          } as CSSProperties
        }
      >
        <ProjectItemPresentation
          item={item}
          metadata={meta}
          titleMode={titleMode}
          titleExpanded={expandedName(`issue:${item.id}`)}
          parentExpanded={expandedName(`badge:${item.id}`)}
          parentHighlighted={!!item.parent && highlightedParents.has(item.parent)}
        />
      </div>
    );
  }
  const activeGroup = data.groups.find((g) => g.key === focus?.instance);
  const activeRecord = records.find((i) => i.id === active),
    incident = routes.filter(isActiveRoute);
  const context = useMemo(() => ({ data: fixture, board, native }), [fixture, board, native]);
  return (
    <CanvasContext.Provider value={context}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Background clicks clear canvas selection; Escape provides the keyboard action. */}
      <div
        role="presentation"
        ref={motionRoot}
        className={`cc-app cc-titles-${titleMode} cc-highlight-${highlightStyle}`}
        style={{ '--cc-label-column': `${data.labelColumn}px` } as React.CSSProperties}
        onPointerMove={(event) => tooltip.current?.show(event.target as Element)}
        onPointerLeave={() => {
          hideTooltip();
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
          <AttentionControl
            board={board}
            count={attentionIds.size}
            active={attentionOnly}
            onToggle={toggleAttention}
          />
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
        {notice}
        {routing.error && (
          <p role="alert">Item dependency links unavailable: {routing.error.message}</p>
        )}
        <ProjectCanvasViewport
          ref={viewport}
          width={data.width}
          height={data.height}
          areas={data.areas}
          boxes={data.boxes}
          onCollapse={collapseAll}
          onExpand={expandAll}
          onNavigate={hideTooltip}
          suppressCanvasClick={suppressCanvasClick}
          pending={routing.pending}
          initializing={!published.current && routing.pending}
          empty={
            !records.length && (
              <p className="cc-empty">
                {board.meta.coverage.state === 'complete'
                  ? 'No work items.'
                  : 'Work items unavailable. Check source coverage.'}
              </p>
            )
          }
          overlay={
            <>
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
                    {activeGroup && (
                      <span>{stages.find((s) => s.id === activeGroup.stage)?.name}</span>
                    )}
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
                          if (
                            !action ||
                            action.kind === 'configure' ||
                            action.kind === 'preview-plan'
                          )
                            return null;
                          const label = actionLabel(board, activeRecord.item, action);
                          return (
                            <button
                              key={id}
                              type="button"
                              className={`cc-action-${action.kind}`}
                              aria-label={label}
                              title={action.kind === 'retry' ? retryExplanation : undefined}
                              disabled={busy || action.availability.state !== 'available'}
                              data-tip={
                                action.availability.state === 'available'
                                  ? action.kind === 'retry'
                                    ? retryExplanation
                                    : label
                                  : action.availability.reasons.map((r) => r.message).join(' ')
                              }
                              onClick={() =>
                                action.kind === 'start'
                                  ? onStart(activeRecord.item)
                                  : onCommand(activeRecord.item, action)
                              }
                            >
                              {action.kind === 'retry' ? (
                                label
                              ) : (
                                <Icon kind={action.kind === 'cancel' ? 'stop' : 'play'} />
                              )}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          }
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
                  className={attentionOnly || active ? (isActiveRoute(r) ? 'active' : 'muted') : ''}
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
          <svg className="cc-endpoints" width={data.width} height={data.height} aria-hidden="true">
            {incident.flatMap((r) =>
              [r.points[0], r.points[r.points.length - 1]].map((p) => (
                <g key={`${r.key}-${p.x}-${p.y}`} transform={`translate(${p.x},${p.y})`}>
                  <circle r="3" fill="#111117" stroke={r.color} strokeWidth="1.5" />
                </g>
              ))
            )}
          </svg>
        </ProjectCanvasViewport>
        {children}
        <ProjectCanvasTooltip
          ref={tooltip}
          metadata={targetScene.layout.fixture.metadata}
          titleMode={titleMode}
          onHoverName={setHoverName}
        />
      </div>
    </CanvasContext.Provider>
  );
}
