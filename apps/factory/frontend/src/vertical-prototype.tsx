// Throwaway: three vertical factory layouts on /?variant=A|B|C. In-memory fixtures only.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { items, parents, stages, Icon, tone, type Item } from './layout-prototype';
import './vertical-prototype.css';

type LayoutProps = {
  records: Item[];
  selected?: Item;
  select: (item: Item) => void;
  collapsed: string[];
  toggle: (key: string) => void;
};
const variants = [
  { id: 'A', name: 'Namespace bands' },
  { id: 'B', name: 'Issue outline' },
  { id: 'C', name: 'Dependency tracks' },
];
function Status({ item }: { item: Item }) {
  return (
    <span className={`vp-status ${tone(item.status)}`}>
      <span
        className={
          ['Implementing', 'Restacking'].includes(item.status) ? 'vp-dot vp-pulse' : 'vp-dot'
        }
      />
      {item.status}
    </span>
  );
}
function ParentLabel({ id }: { id: number }) {
  const parent = parents.find((p) => p.id === id);
  return (
    <>
      <span className="vp-parent-mark" style={{ background: parent?.color }} />
      <span className="vp-number">#{id}</span>
      <span>{parent?.title}</span>
    </>
  );
}
function Dependencies({
  item,
  select,
  compact = false,
}: {
  item: Item;
  select: LayoutProps['select'];
  compact?: boolean;
}) {
  return (
    <span className="vp-dependencies">
      {item.deps.map((dep) => {
        const base = items.find((i) => i.id === dep);
        return (
          base && (
            <button
              type="button"
              className={item.pr ? 'vp-dep green' : 'vp-dep amber'}
              key={dep}
              onClick={() => select(base)}
              title={`${item.pr ? 'Stacked on' : 'Blocked by'} #${base.pr && item.pr ? base.pr : dep}: ${base.title}`}
            >
              <span>{item.pr ? '⑂' : '↳'}</span>
              {!compact && (item.pr ? 'base ' : 'waits ')}#{item.pr ? (base.pr ?? dep) : dep}
            </button>
          )
        );
      })}
    </span>
  );
}
function Diff({ item }: { item: Item }) {
  return item.pr ? (
    <span className="vp-diff">
      <b>+{item.plus}</b>
      <em>−{item.minus}</em>
    </span>
  ) : null;
}
function StageHeading({ stage, count }: { stage: (typeof stages)[number]; count: number }) {
  return (
    <h2 className={`vp-stage-heading ${stage.id}`}>
      <span className="vp-stage-dot" />
      {stage.title}
      <span className="vp-count">{count}</span>
    </h2>
  );
}

// A: status bands, horizontal UML namespaces, flat single-line issues and linked dependency pills.
export function VariantA(props: LayoutProps) {
  return (
    <div className="vp-bands">
      {stages.map((stage) => (
        <section className="vp-band" key={stage.id}>
          <StageHeading
            stage={stage}
            count={props.records.filter((i) => i.stage === stage.id).length}
          />
          <div className="vp-horizontal-parents">
            {parents.map((parent) => {
              const records = props.records.filter(
                (i) => i.parent === parent.id && i.stage === stage.id
              );
              if (!records.length) return null;
              const key = `A-${parent.id}-${stage.id}`;
              const closed = props.collapsed.includes(key);
              return (
                <section className="vp-namespace" key={parent.id}>
                  <button
                    type="button"
                    className="vp-namespace-title"
                    aria-expanded={!closed}
                    onClick={() => props.toggle(key)}
                  >
                    <ParentLabel id={parent.id} />
                    <span className="vp-count">{records.length}</span>
                    <span className="vp-collapse">{closed ? '+' : '−'}</span>
                  </button>
                  {!closed && (
                    <div>
                      {records.map((item) => (
                        <div
                          className={`vp-flat-row ${props.selected?.id === item.id ? 'selected' : ''}`}
                          key={item.id}
                        >
                          <button
                            type="button"
                            className="vp-flat-main"
                            onClick={() => props.select(item)}
                          >
                            <span className={item.pr ? 'green' : tone(item.status)}>
                              <Icon kind={item.pr ? 'pr' : 'issue'} size={14} />
                            </span>
                            <span className="vp-number">#{item.pr ?? item.id}</span>
                            <span className="vp-title">{item.title}</span>
                            <Status item={item} />
                          </button>
                          <div className="vp-flat-extra">
                            <Dependencies item={item} select={props.select} compact />
                            <Diff item={item} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
function outline(records: Item[]): { item: Item; depth: number }[] {
  const ids = new Set(records.map((i) => i.id));
  const walk = (item: Item, depth: number): { item: Item; depth: number }[] => [
    { item, depth },
    ...records.filter((i) => i.deps[0] === item.id).flatMap((i) => walk(i, depth + 1)),
  ];
  return records.filter((i) => !i.deps.some((id) => ids.has(id))).flatMap((i) => walk(i, 0));
}
// B: continuous dense outline, parent tree branches, nested dependency chains instead of boxes.
export function VariantB(props: LayoutProps) {
  return (
    <div className="vp-outline">
      {stages.map((stage) => (
        <section className="vp-outline-stage" key={stage.id}>
          <StageHeading
            stage={stage}
            count={props.records.filter((i) => i.stage === stage.id).length}
          />
          {parents.map((parent) => {
            const records = props.records.filter(
              (i) => i.parent === parent.id && i.stage === stage.id
            );
            if (!records.length) return null;
            const key = `B-${parent.id}-${stage.id}`;
            const closed = props.collapsed.includes(key);
            return (
              <div className="vp-tree-parent" key={parent.id}>
                <button
                  type="button"
                  className="vp-tree-heading"
                  aria-expanded={!closed}
                  onClick={() => props.toggle(key)}
                >
                  <span className="vp-tree-arrow">{closed ? '▸' : '▾'}</span>
                  <ParentLabel id={parent.id} />
                  <span className="vp-count">{records.length}</span>
                </button>
                {!closed && (
                  <div className="vp-tree-children">
                    {outline(records).map(({ item, depth }) => (
                      <div
                        className={`vp-tree-row ${props.selected?.id === item.id ? 'selected' : ''}`}
                        key={item.id}
                        style={{ marginLeft: depth * 25 }}
                      >
                        <span className={`vp-tree-elbow ${item.pr ? 'green' : ''}`} />
                        <button
                          type="button"
                          className="vp-tree-main"
                          onClick={() => props.select(item)}
                        >
                          <span className={item.pr ? 'green' : tone(item.status)}>
                            <Icon kind={item.pr ? 'pr' : 'issue'} size={15} />
                          </span>
                          <span className="vp-number">#{item.pr ?? item.id}</span>
                          <span className="vp-title">{item.title}</span>
                        </button>
                        <span className="vp-tree-meta">
                          {item.agent ?? (item.pr ? `issue #${item.id}` : '')}
                        </span>
                        <Dependencies item={item} select={props.select} />
                        <Status item={item} />
                        <Diff item={item} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
// C: parent tracks with vertical stages, two-line nodes, actual dependency rails across stages.
export function VariantC(props: LayoutProps) {
  const root = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<
    {
      id: string;
      d: string;
      stack: boolean;
      selected: boolean;
      label: string;
      x: number;
      y: number;
    }[]
  >([]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    function measure() {
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      setPaths(
        props.records.flatMap((item) =>
          item.deps.flatMap((id, index) => {
            const source = element.querySelector<HTMLElement>(`[data-track-node="${id}"]`);
            const target = element.querySelector<HTMLElement>(`[data-track-node="${item.id}"]`);
            const track = target?.closest('.vp-track');
            if (!source || !target || !track) return [];
            const a = source.getBoundingClientRect(),
              b = target.getBoundingClientRect(),
              c = track.getBoundingClientRect();
            const x1 = a.left - bounds.left,
              x2 = b.left - bounds.left;
            const y1 = a.top - bounds.top + a.height / 2,
              y2 = b.top - bounds.top + b.height / 2;
            const x = c.left - bounds.left + 13 + ((item.id + index) % 3) * 9;
            return [
              {
                id: `${id}-${item.id}`,
                d: `M${x1},${y1} H${x} V${y2} H${x2 - 3}`,
                stack: !!item.pr,
                selected: props.selected?.id === item.id || props.selected?.id === id,
                label: item.pr ? 'stack' : `#${id}`,
                x: x + 3,
                y: (y1 + y2) / 2,
              },
            ];
          })
        )
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [props.records, props.collapsed, props.selected]);
  return (
    <div className="vp-tracks" ref={root}>
      <svg className="vp-track-lines" aria-hidden="true">
        <defs>
          <marker
            id="vp-arrow"
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
        {paths.map((path) => (
          <g
            key={path.id}
            className={`${path.stack ? 'stack' : 'blocker'} ${path.selected ? 'focused' : ''}`}
          >
            <path d={path.d} markerEnd="url(#vp-arrow)" />
            {path.selected && (
              <text x={path.x} y={path.y}>
                {path.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {parents.map((parent) => {
        const records = props.records.filter((i) => i.parent === parent.id);
        if (!records.length) return null;
        return (
          <section className="vp-track" key={parent.id}>
            <h2 className="vp-track-title">
              <ParentLabel id={parent.id} />
              <span className="vp-count">{records.length}</span>
            </h2>
            {stages.map((stage) => {
              const group = records.filter((i) => i.stage === stage.id);
              const key = `C-${parent.id}-${stage.id}`,
                closed = props.collapsed.includes(key);
              return (
                <section className="vp-track-stage" key={stage.id}>
                  <button
                    type="button"
                    className="vp-track-stage-toggle"
                    aria-expanded={!closed}
                    onClick={() => props.toggle(key)}
                  >
                    <StageHeading stage={stage} count={group.length} />
                    <span>{closed ? '+' : '−'}</span>
                  </button>
                  {!closed && (
                    <div className="vp-track-nodes">
                      {group.length === 0 ? (
                        <span className="vp-empty">—</span>
                      ) : (
                        group.map((item) => (
                          <button
                            type="button"
                            data-track-node={item.id}
                            key={item.id}
                            className={`vp-node ${props.selected?.id === item.id ? 'selected' : ''}`}
                            onClick={() => props.select(item)}
                          >
                            <span className="vp-node-port" />
                            <span className="vp-node-top">
                              <span className={item.pr ? 'green' : tone(item.status)}>
                                <Icon kind={item.pr ? 'pr' : 'issue'} size={15} />
                              </span>
                              <span className="vp-number">#{item.pr ?? item.id}</span>
                              <span className="vp-title">{item.title}</span>
                              <Diff item={item} />
                            </span>
                            <span className="vp-node-bottom">
                              <Status item={item} />
                              <span className="vp-node-meta">
                                {item.agent ?? (item.pr ? `issue #${item.id}` : 'Ready for agent')}
                                {item.deps.length > 0 &&
                                  ` · ${item.pr ? 'base' : 'waits'} #${item.pr ? (items.find((i) => i.id === item.deps[0])?.pr ?? item.deps[0]) : item.deps[0]}`}
                              </span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
export function VerticalPrototype() {
  const readVariant = () =>
    variants.find((v) => v.id === new URLSearchParams(location.search).get('variant'))?.id ?? 'A';
  const [variant, setVariant] = useState(readVariant);
  const [selected, setSelected] = useState<Item>();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  function switchTo(id: string) {
    const url = new URL(location.href);
    url.searchParams.set('variant', id);
    history.replaceState(null, '', url);
    setVariant(id);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,[contenteditable="true"]')
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
    };
    const pop = () => setVariant(readVariant());
    window.addEventListener('keydown', key);
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('popstate', pop);
    };
  }, [variant]);
  const records = items.filter(
    (item) =>
      (filter === 'all' || String(item.parent) === filter) &&
      `${item.title} ${item.id} ${item.pr ?? ''}`.toLowerCase().includes(search.toLowerCase())
  );
  const props: LayoutProps = {
    records,
    selected,
    select: (item) => setSelected((current) => (current?.id === item.id ? undefined : item)),
    collapsed,
    toggle: (key) =>
      setCollapsed((current) =>
        current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
      ),
  };
  return (
    <div className={`vp-app vp-variant-${variant}`}>
      <header className="vp-toolbar">
        <span className="vp-toolbar-title">Factory</span>
        <span className="vp-toolbar-count">
          <i className="vp-dot purple" />3 working<span className="vp-separator">/</span>5 in review
          <span className="vp-separator">/</span>
          <span className="amber">3 blocked</span>
        </span>
        <span className="vp-toolbar-spacer" />
        <label className="vp-search">
          <Icon kind="search" size={13} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find issue or PR…"
            aria-label="Find issue or pull request"
          />
        </label>
        <select
          aria-label="Filter parent"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All parents</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              #{parent.id} {parent.title}
            </option>
          ))}
        </select>
        <span className="vp-fixture">Mock data</span>
      </header>
      <main className="vp-main">
        {variant === 'A' ? (
          <VariantA {...props} />
        ) : variant === 'B' ? (
          <VariantB {...props} />
        ) : (
          <VariantC {...props} />
        )}{' '}
        {!records.length && <p className="vp-empty">No matches.</p>}
      </main>
      {selected && (
        <aside className="vp-detail" aria-label="Issue details">
          <div className="vp-detail-heading">
            <span className="vp-number">
              Issue #{selected.id}
              {selected.pr ? ` · PR #${selected.pr}` : ''}
            </span>
            <button type="button" aria-label="Close details" onClick={() => setSelected(undefined)}>
              ×
            </button>
          </div>
          <h2>{selected.title}</h2>
          <Status item={selected} />
          <p className="vp-detail-parent">
            <ParentLabel id={selected.parent} />
          </p>
          <div className="vp-detail-relations">
            <span>{selected.pr ? 'Stack base' : 'Blocked by'}</span>
            {selected.deps.length ? (
              selected.deps.map((id) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setSelected(items.find((i) => i.id === id))}
                >
                  #{id} {items.find((i) => i.id === id)?.title} ↗
                </button>
              ))
            ) : (
              <p>None</p>
            )}
            <span>Downstream</span>
            {items.some((i) => i.deps.includes(selected.id)) ? (
              items
                .filter((i) => i.deps.includes(selected.id))
                .map((i) => (
                  <button type="button" key={i.id} onClick={() => setSelected(i)}>
                    #{i.id} {i.title} ↗
                  </button>
                ))
            ) : (
              <p>None</p>
            )}
          </div>
          <small>Illustrative fixture · no live commands</small>
        </aside>
      )}
      {import.meta.env.DEV && (
        <nav className="vp-switcher" aria-label="Prototype variants">
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
              aria-pressed={variant === v.id}
              className={variant === v.id ? 'active' : ''}
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
