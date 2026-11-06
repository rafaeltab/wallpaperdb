// Throwaway: three factory layouts on /?variant=A|B|C. All records are illustrative fixtures.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './layout-prototype.css';

type Stage = 'planned' | 'working' | 'review';
type Item = {
  id: number;
  title: string;
  parent: number;
  stage: Stage;
  status: string;
  deps: number[];
  pr?: number;
  plus?: number;
  minus?: number;
  agent?: string;
};
const parents = [
  {
    id: 644,
    title: 'Factory command centre',
    subtitle: 'Orchestration & oversight',
    color: '#59c9b0',
  },
  { id: 602, title: 'Wallpaper discovery', subtitle: 'Search & collections', color: '#a89be7' },
];
const items: Item[] = [
  {
    id: 651,
    title: 'Build the factory command centre',
    parent: 644,
    stage: 'planned',
    status: 'Ready for agent',
    deps: [],
  },
  {
    id: 656,
    title: 'Reduce observation latency',
    parent: 644,
    stage: 'planned',
    status: 'Blocked',
    deps: [648],
  },
  {
    id: 674,
    title: 'Add admission controls to the graph',
    parent: 644,
    stage: 'planned',
    status: 'Blocked',
    deps: [651],
  },
  {
    id: 675,
    title: 'Show planner decisions inline',
    parent: 644,
    stage: 'working',
    status: 'Implementing',
    deps: [],
    agent: 'sol · implementation',
  },
  {
    id: 676,
    title: 'Recover interrupted factory jobs',
    parent: 644,
    stage: 'working',
    status: 'Reviewing code',
    deps: [],
    agent: 'astra · review',
  },
  {
    id: 649,
    title: 'Move the frontend to Vite + React',
    parent: 644,
    stage: 'review',
    status: 'Checks passed',
    deps: [],
    pr: 670,
    plus: 842,
    minus: 316,
  },
  {
    id: 650,
    title: 'Stream planner preview progress',
    parent: 644,
    stage: 'review',
    status: 'Review needed',
    deps: [649],
    pr: 671,
    plus: 214,
    minus: 42,
  },
  {
    id: 648,
    title: 'Connect T3 threads to factory work',
    parent: 644,
    stage: 'review',
    status: 'Restacking',
    deps: [650],
    pr: 672,
    plus: 381,
    minus: 57,
  },
  {
    id: 610,
    title: 'Filter wallpapers by colour',
    parent: 602,
    stage: 'planned',
    status: 'Ready for agent',
    deps: [],
  },
  {
    id: 611,
    title: 'Save a search as a collection',
    parent: 602,
    stage: 'planned',
    status: 'Blocked',
    deps: [612],
  },
  {
    id: 612,
    title: 'Index searchable wallpaper metadata',
    parent: 602,
    stage: 'working',
    status: 'Implementing',
    deps: [],
    agent: 'sol · implementation',
  },
  {
    id: 608,
    title: 'Add cursor pagination to discovery',
    parent: 602,
    stage: 'review',
    status: 'Checks failed',
    deps: [],
    pr: 668,
    plus: 126,
    minus: 28,
  },
  {
    id: 609,
    title: 'Keep search filters in the URL',
    parent: 602,
    stage: 'review',
    status: 'Checks passed',
    deps: [608],
    pr: 669,
    plus: 93,
    minus: 14,
  },
];
const stages: { id: Stage; title: string; subtitle: string }[] = [
  { id: 'planned', title: 'Planned', subtitle: 'Ready for agent · includes blocked' },
  { id: 'working', title: 'Working', subtitle: 'Active factory sessions' },
  { id: 'review', title: 'In review', subtitle: 'Pull requests · base to tip' },
];
const variants = [
  {
    id: 'A',
    name: 'Stage columns',
    description: 'Follow the factory from left to right. Parent namespaces live inside each stage.',
  },
  {
    id: 'B',
    name: 'Parent swimlanes',
    description: 'Follow one parent across the whole factory. Every row is a separate initiative.',
  },
  {
    id: 'C',
    name: 'Dependency canvas',
    description:
      'Read the relationships first. Pan across namespaces and trace blockers and PR stacks.',
  },
];
function Icon({ kind, size = 16 }: { kind: string; size?: number }) {
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
      {kind === 'pr' ? (
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M6 7v14M14 3l4 4-4 4M18 7v9M11 7h7" />
        </>
      ) : kind === 'check' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </>
      ) : kind === 'blocked' ? (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      ) : kind === 'grid' ? (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ) : kind === 'search' ? (
        <>
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 5 5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
function tone(status: string) {
  return status === 'Blocked' || status === 'Restacking'
    ? 'amber'
    : status === 'Checks failed'
      ? 'red'
      : status === 'Checks passed' || status === 'Ready for agent'
        ? 'green'
        : 'purple';
}

export function LayoutPrototype() {
  const fromUrl = () =>
    variants.find((v) => v.id === new URLSearchParams(location.search).get('variant'))?.id ?? 'A';
  const [variant, setVariant] = useState(fromUrl);
  const [search, setSearch] = useState('');
  const [parentFilter, setParentFilter] = useState('all');
  const [selected, setSelected] = useState<Item>();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const board = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<
    { key: string; d: string; stack: boolean; highlighted: boolean }[]
  >([]);
  const visible = items.filter(
    (item) =>
      (parentFilter === 'all' || String(item.parent) === parentFilter) &&
      `${item.title} ${item.id} ${item.pr ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );
  function switchTo(id: string) {
    const url = new URL(location.href);
    url.searchParams.set('variant', id);
    history.replaceState(null, '', url);
    setVariant(id);
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (event.key === 'Escape') setSelected(undefined);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        switchTo(
          variants[
            (variants.findIndex((v) => v.id === variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3
          ].id
        );
      }
    }
    const pop = () => setVariant(fromUrl());
    window.addEventListener('keydown', key);
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('popstate', pop);
    };
  }, [variant]);
  useLayoutEffect(() => {
    const root = board.current;
    if (!root) return;
    function measure() {
      if (!root) return;
      const bounds = root.getBoundingClientRect();
      const next = visible.flatMap((item) =>
        item.deps.flatMap((dep) => {
          const source = root.querySelector<HTMLElement>(`[data-node="${dep}"]`);
          const target = root.querySelector<HTMLElement>(`[data-node="${item.id}"]`);
          if (!source || !target) return [];
          const a = source.getBoundingClientRect(),
            b = target.getBoundingClientRect();
          const vertical = Math.abs(a.left - b.left) < 30;
          const x1 = vertical ? a.left - bounds.left + 22 : a.right - bounds.left;
          const y1 = vertical ? a.bottom - bounds.top : a.top - bounds.top + a.height / 2;
          const x2 = vertical ? b.left - bounds.left + 22 : b.left - bounds.left;
          const y2 = vertical ? b.top - bounds.top : b.top - bounds.top + b.height / 2;
          const bend = Math.max(35, Math.abs(x2 - x1) * 0.45);
          const d = vertical
            ? `M${x1},${y1} L${x2},${y2}`
            : `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
          return [
            {
              key: `${dep}-${item.id}`,
              d,
              stack: !!item.pr,
              highlighted: selected?.id === item.id || selected?.id === dep,
            },
          ];
        })
      );
      setLines(next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [variant, search, parentFilter, selected, collapsed]);
  function card(item: Item) {
    return (
      <button
        type="button"
        data-node={item.id}
        key={item.id}
        className={`fp-item ${selected?.id === item.id ? 'selected' : ''}`}
        onClick={() => setSelected(selected?.id === item.id ? undefined : item)}
      >
        <span className={`fp-item-icon ${item.pr ? 'green' : tone(item.status)}`}>
          <Icon kind={item.pr ? 'pr' : 'issue'} />
        </span>
        <span className="fp-item-content">
          <span className="fp-item-title">
            <span className="fp-number">#{item.pr ?? item.id}</span> {item.title}
          </span>
          <span className="fp-item-meta">
            <span className={`fp-avatar ${item.parent === 602 ? 'violet' : ''}`}>r</span>
            {item.pr ? `rafaeltab · issue #${item.id}` : (item.agent ?? 'rafaeltab / wallpaperdb')}
          </span>
          <span className="fp-item-bottom">
            <span className={`fp-status ${tone(item.status)}`}>
              <span
                className={
                  item.status === 'Implementing' || item.status === 'Restacking'
                    ? 'fp-dot pulse'
                    : 'fp-dot'
                }
              />
              {item.status}
            </span>
            {item.deps.length > 0 && (
              <span className="fp-dep">
                {item.pr ? '↳ base' : 'waits for'}{' '}
                {item.deps
                  .map((id) => {
                    const dep = items.find((i) => i.id === id);
                    return `#${item.pr ? (dep?.pr ?? id) : id}`;
                  })
                  .join(', ')}
              </span>
            )}
          </span>
        </span>
        {item.pr ? (
          <span className="fp-item-end">
            <span>
              <b>+{item.plus}</b> <em>−{item.minus}</em>
            </span>
            <span>11h ago</span>
          </span>
        ) : (
          <span className={`fp-end-icon ${tone(item.status)}`}>
            <Icon
              kind={
                item.status === 'Blocked'
                  ? 'blocked'
                  : item.status === 'Ready for agent'
                    ? 'check'
                    : 'issue'
              }
              size={14}
            />
          </span>
        )}
      </button>
    );
  }
  function namespace(parent: (typeof parents)[number], stage: Stage) {
    const records = visible.filter((i) => i.parent === parent.id && i.stage === stage);
    if (!records.length) return null;
    const key = `${parent.id}-${stage}`;
    return (
      <section key={key} className={`fp-namespace parent-${parent.id}`}>
        <button
          type="button"
          className="fp-namespace-tab"
          onClick={() =>
            setCollapsed((current) =>
              current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
            )
          }
          aria-expanded={!collapsed.includes(key)}
        >
          <span className="fp-parent-dot" style={{ background: parent.color }} />
          <span className="fp-number">#{parent.id}</span> {parent.title}
          <span className="fp-count">{records.length}</span>
          <span className="fp-chevron">{collapsed.includes(key) ? '+' : '−'}</span>
        </button>
        {!collapsed.includes(key) && (
          <div className="fp-namespace-body">
            {stage === 'review' && (
              <div className="fp-stack-label">
                ⑂ {parent.id === 644 ? 'factory / foundation' : 'discovery / search'}{' '}
                <span>base ↓ tip</span>
              </div>
            )}
            {records.map(card)}
          </div>
        )}
      </section>
    );
  }
  const current = variants.find((v) => v.id === variant) ?? variants[0];
  return (
    <div className={`fp-app variant-${variant}`}>
      <aside className="fp-rail">
        <span className="fp-brand">
          w<span>✳</span>
        </span>
        <span className="fp-rail-active" title="Factory">
          <Icon kind="grid" size={19} />
        </span>
        <span className="fp-rail-line" />
        <span className="fp-rail-bottom fp-avatar">r</span>
      </aside>
      <div className="fp-shell">
        <header className="fp-topbar">
          <div>
            <span className="fp-repo">wallpaperdb</span>
            <span className="fp-slash">/</span>
            <span>Factory</span>
            <span className="fp-prototype-tag">layout lab</span>
          </div>
          <div className="fp-top-right">
            <span className="fp-fixture-dot" />
            Illustrative data
            <span className="fp-divider" />
            No live commands
          </div>
        </header>
        <div className="fp-heading">
          <div>
            <div className="fp-eyebrow">COMMAND CENTRE</div>
            <h1>The factory, in motion.</h1>
            <p>{current.description}</p>
          </div>
          <div className="fp-summary">
            <span>
              <strong>{items.filter((i) => i.stage === 'working').length}</strong> working
            </span>
            <span>
              <strong>{items.filter((i) => i.pr).length}</strong> in review
            </span>
            <span className="amber">
              <strong>{items.filter((i) => i.status === 'Blocked').length}</strong> blocked
            </span>
          </div>
        </div>
        <div className="fp-toolbar">
          <div className="fp-toolbar-left">
            <span className="fp-view-label">
              <Icon kind="grid" size={14} />
              {current.name}
            </span>
            <span className="fp-divider" />
            <label className="fp-search">
              <Icon kind="search" size={14} />
              <input
                aria-label="Find an issue or pull request"
                placeholder="Find an issue or PR…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <label className="fp-filter">
            Parent{' '}
            <select
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              aria-label="Filter parent"
            >
              <option value="all">All initiatives</option>
              {parents.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="fp-workspace">
          <div className="fp-scroll">
            <div
              ref={board}
              className={`fp-board ${variant === 'B' ? 'fp-swimlanes' : variant === 'C' ? 'fp-canvas' : 'fp-columns'}`}
            >
              <svg className="fp-connections" aria-hidden="true">
                <defs>
                  <marker
                    id="fp-arrow"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M1 1 7 4 1 7" fill="none" stroke="context-stroke" />
                  </marker>
                </defs>
                {lines.map((line) => (
                  <path
                    key={line.key}
                    d={line.d}
                    className={`${line.stack ? 'stack' : 'blocker'} ${line.highlighted ? 'highlighted' : ''}`}
                    markerEnd="url(#fp-arrow)"
                  />
                ))}
              </svg>
              {variant === 'B' ? (
                <>
                  <div className="fp-swim-head">
                    <div className="fp-swim-label">PARENT ISSUE</div>
                    {stages.map((stage) => (
                      <div className={`fp-stage-heading ${stage.id}`} key={stage.id}>
                        <h2>
                          <span className="fp-stage-dot" />
                          {stage.title}
                          <span className="fp-count">
                            {visible.filter((i) => i.stage === stage.id).length}
                          </span>
                        </h2>
                        <p>{stage.subtitle}</p>
                      </div>
                    ))}
                  </div>
                  {parents
                    .filter((p) => parentFilter === 'all' || parentFilter === String(p.id))
                    .map((parent) => (
                      <div className="fp-swim-row" key={parent.id}>
                        <div className="fp-swim-parent">
                          <span style={{ color: parent.color }}>
                            ⌑ <span className="fp-number">#{parent.id}</span>
                          </span>
                          <h3>{parent.title}</h3>
                          <p>{parent.subtitle}</p>
                          <span>
                            {visible.filter((i) => i.parent === parent.id).length} issues across the
                            factory
                          </span>
                        </div>
                        {stages.map((stage) => (
                          <div className="fp-swim-cell" key={stage.id}>
                            {namespace(parent, stage.id) ?? (
                              <div className="fp-empty">No issues here</div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                </>
              ) : (
                stages.map((stage) => (
                  <div className={`fp-stage ${stage.id}`} key={stage.id}>
                    <div className="fp-stage-heading">
                      <h2>
                        <span className="fp-stage-dot" />
                        {stage.title}
                        <span className="fp-count">
                          {visible.filter((i) => i.stage === stage.id).length}
                        </span>
                        <span className="fp-flow-arrow">→</span>
                      </h2>
                      <p>{stage.subtitle}</p>
                    </div>
                    <div className="fp-stage-content">
                      {parents.map((parent) => namespace(parent, stage.id))}
                    </div>
                  </div>
                ))
              )}
            </div>
            {visible.length === 0 && (
              <div className="fp-no-results">
                No matching issues or pull requests. Try another search.
              </div>
            )}
          </div>
          {selected && (
            <aside className="fp-inspector">
              <div className="fp-inspector-head">
                <span>ISSUE DETAILS · FIXTURE</span>
                <button
                  type="button"
                  aria-label="Close details"
                  onClick={() => setSelected(undefined)}
                >
                  ×
                </button>
              </div>
              <span className={`fp-status ${tone(selected.status)}`}>
                <span className="fp-dot" />
                {selected.status}
              </span>
              <h2>
                <span className="fp-number">#{selected.id}</span> {selected.title}
              </h2>
              <dl>
                <dt>Parent namespace</dt>
                <dd>
                  #{selected.parent} · {parents.find((p) => p.id === selected.parent)?.title}
                </dd>
                <dt>Factory stage</dt>
                <dd>{stages.find((s) => s.id === selected.stage)?.title}</dd>
                {selected.pr && (
                  <>
                    <dt>Pull request</dt>
                    <dd className="green">⑂ #{selected.pr} · Draft</dd>
                  </>
                )}
                <dt>{selected.pr ? 'Stack base' : 'Blocked by'}</dt>
                <dd>
                  {selected.deps.length
                    ? selected.deps.map((dep) => (
                        <button
                          key={dep}
                          type="button"
                          className="fp-related"
                          onClick={() => setSelected(items.find((i) => i.id === dep))}
                        >
                          #{dep} {items.find((i) => i.id === dep)?.title} ↗
                        </button>
                      ))
                    : 'No dependencies in this fixture'}
                </dd>
                <dt>Downstream</dt>
                <dd>
                  {items
                    .filter((i) => i.deps.includes(selected.id))
                    .map((i) => (
                      <button
                        type="button"
                        className="fp-related"
                        key={i.id}
                        onClick={() => setSelected(i)}
                      >
                        #{i.id} {i.title} ↗
                      </button>
                    ))}
                  {!items.some((i) => i.deps.includes(selected.id)) && 'No dependent issues'}
                </dd>
              </dl>
              <div className="fp-inspector-note">
                Layout exploration only. These example states and relationships are not live factory
                observations.
              </div>
            </aside>
          )}
        </div>
        <footer className="fp-footer">
          <span>
            <i className="fp-legend-line" /> Blocks / waits for{' '}
            <i className="fp-legend-line solid" /> PR stack
          </span>
          <span>Click a row to trace its relationships · Parent headers collapse groups</span>
        </footer>
      </div>
      {import.meta.env.DEV && (
        <nav className="fp-switcher" aria-label="Prototype variants">
          <span className="fp-switcher-label">LAYOUT</span>
          <button
            type="button"
            aria-label="Previous variant"
            onClick={() =>
              switchTo(variants[(variants.findIndex((v) => v.id === variant) + 2) % 3].id)
            }
          >
            ←
          </button>
          {variants.map((v) => (
            <button
              type="button"
              key={v.id}
              className={variant === v.id ? 'active' : ''}
              aria-pressed={variant === v.id}
              onClick={() => switchTo(v.id)}
            >
              <span>{v.id}</span>
              {v.name}
            </button>
          ))}
          <button
            type="button"
            aria-label="Next variant"
            onClick={() =>
              switchTo(variants[(variants.findIndex((v) => v.id === variant) + 1) % 3].id)
            }
          >
            →
          </button>
        </nav>
      )}
    </div>
  );
}

// Reuse only the fixture records and small visual primitives in the next layout study.
export { items, parents, stages, Icon, tone };
export type { Item, Stage };
