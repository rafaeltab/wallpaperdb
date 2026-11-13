// THROWAWAY #717: D refines the maintainer-selected B summary + C details.
// Question: which activity hierarchy is easiest to scan? ?prototype=activity&variant=A|B|C|D
// Simulated memory only. No backend, provider calls, or production design verdict.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fakeFixture } from '../../../src/http/v2/fake-fixture';
import { Canvas } from './canvas';
import './style.css';
import './activity-prototype.css';

const names = [
  'Publishing',
  'Reviewing',
  'Implementing',
  'Restacking',
  'Recovering',
  'Planning',
  'Gathering planning context',
  'Checking plan freshness',
  'Refreshing GitHub',
  'Refreshing T3 information',
  'Waiting for CI',
  'Waiting for answers',
];
const purposes = [
  'Preparing the reviewed head for publication',
  'Independent code and spec review',
  'Building the admitted issue',
  'Updating PR bases after a prerequisite landed',
  'Establishing the outcome of a previous launch',
  'Selecting eligible work without admitting it',
  'Collecting issue, dependency and repository context',
  'Verifying the proposal against current facts',
  'Reading repository and managed PR metadata',
  'Reading managed thread and run metadata',
  'Managed PR checks remain pending between provider requests',
  'Parked managed jobs retain their question and release capacity',
];
const restrictions = [
  'Admissions are paused. Existing jobs continue.',
  'Concurrency is full. No additional active slots are available.',
  'Admission allowance is exhausted. Continuing jobs keep their reservation.',
  'No issues match the ready filter.',
  'The planner assessed candidates and found no eligible issues.',
  'Eligibility could not be established. Missing evidence is not a no-work result.',
];
type Item = { id: string; category: number; start: number | null };
const variants = ['A', 'B', 'C', 'D'];
const variantHref = (variant: string) => {
  const url = new URL(location.href);
  url.searchParams.set('variant', variant);
  return `${url.pathname}${url.search}${url.hash}`;
};
const variantNames = ['Compact ledger', 'Wide activity console', 'Inspector rail', 'Minimal B + C'];
const units = (n: number, count: number) => {
  const noun = [3, 10].includes(n) ? 'PR' : [0, 1, 2, 11].includes(n) ? 'issue' : 'operation';
  return count === 1 ? noun : `${noun}s`;
};
const seconds = (start: number, now: number) => Math.max(0, Math.floor((now - start) / 1000));
const duration = (start: number, now: number) => {
  const s = seconds(start, now);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
const age = (start: number, now: number) => {
  const s = seconds(start, now);
  return `${Math.floor(s / 3600)} hours ${Math.floor(s / 60) % 60} minutes ${s % 60} seconds ago`;
};
function initial(now: number): Item[] {
  return [
    { id: '#701', category: 2, start: now - 184000 },
    { id: '#702', category: 2, start: now - 123000 },
    { id: '#703', category: 2, start: now - 79000 },
    { id: 'PR #690', category: 3, start: now - 42000 },
    { id: 'PR #691', category: 3, start: now - 65000 },
    { id: 'GitHub', category: 8, start: now - 9000 },
    { id: '#698', category: 10, start: now - 301000 },
    { id: '#697', category: 11, start: now - 622000 },
  ];
}

function PrototypeSwitcher({
  variant,
  change,
}: {
  variant: string;
  change: (step: number) => void;
}) {
  return (
    <nav className="ap-switch" aria-label="Prototype variations">
      <a
        href={variantHref(
          variants[(variants.indexOf(variant) - 1 + variants.length) % variants.length]
        )}
        onClick={(e) => {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            change(-1);
          }
        }}
        aria-label="Previous variant"
      >
        ←
      </a>
      <span>
        <small>THROWAWAY · #717</small>
        <b>
          {variant} · {variantNames[variants.indexOf(variant)]}
        </b>
      </span>
      <a
        href={variantHref(variants[(variants.indexOf(variant) + 1) % variants.length])}
        onClick={(e) => {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            change(1);
          }
        }}
        aria-label="Next variant"
      >
        →
      </a>
    </nav>
  );
}
export default function ActivityPrototype() {
  const [now, setNow] = useState(Date.now);
  const [items, setItems] = useState(() => initial(Date.now()));
  const [lastSuccess, setLastSuccess] = useState(Date.now);
  const [failures, setFailures] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const [reasons, setReasons] = useState<number[]>([1]);
  const [paused, setPaused] = useState(false);
  const [scenario, setScenario] = useState('Concurrent work');
  const [variant, setVariant] = useState(() => {
    const v = new URLSearchParams(location.search).get('variant');
    return v && variants.includes(v) ? v : 'D';
  });
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const hoverClose = useRef<number | undefined>(undefined);
  const anchor = useRef<HTMLFieldSetElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [seed] = useState(() => fakeFixture('prototype', new Date().toISOString()));
  const board = { ...seed, meta: { ...seed.meta, factory: { ...seed.meta.factory, paused } } };
  const change = useCallback(
    (step: number) => {
      const next = variants[(variants.indexOf(variant) + step + variants.length) % variants.length];
      history.pushState(null, '', variantHref(next));
      setVariant(next);
    },
    [variant]
  );
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(location.search).get('variant');
      setVariant(value && variants.includes(value) ? value : 'D');
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) {
        clearTimeout(hoverClose.current);
        setPinned(false);
        setHovered(false);
        setFocused(false);
        setDismissed(true);
      }
    };
    window.addEventListener('popstate', sync);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('popstate', sync);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearTimeout(hoverClose.current);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        setDismissed(true);
        trigger.current?.focus();
      }
      if (
        e.target instanceof Element &&
        e.target.closest('input,textarea,select,[contenteditable]')
      )
        return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        change(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [change]);
  const groups = names.map((name, i) => {
    const active = items.filter((item) => item.category === i);
    const starts = active.flatMap((item) => (item.start === null ? [] : [item.start]));
    return { name, active, start: starts.length ? Math.max(...starts) : null };
  });
  const highest = groups.findIndex((group) => group.active.length);
  const selected = groups[highest];
  const disconnected = failures >= 3;
  const summary = disconnected
    ? 'Disconnected'
    : selected
      ? highest === 4
        ? 'Reconciling'
        : `${selected.name}${[0, 1, 2, 3, 10, 11].includes(highest) ? ` ${selected.active.length} ${units(highest, selected.active.length)}` : ''}`
      : uncertain
        ? 'Status unknown'
        : 'Idle';
  const open = !dismissed && (pinned || hovered || focused);
  const activeReasons = [...new Set([...reasons, ...(paused ? [0] : [])])].sort();
  function load(value: string) {
    const t = Date.now();
    setScenario(value);
    setFailures(0);
    setLastSuccess(t);
    setUncertain(false);
    setPaused(false);
    setReasons([]);
    if (value === 'Concurrent work') {
      setItems(initial(t));
      setReasons([1]);
    }
    if (value === 'Idle restrictions') {
      setItems([]);
      setPaused(true);
      setReasons([0, 2, 3, 4, 5]);
    }
    if (value === 'Managed waits') {
      setItems([
        { id: '#698', category: 10, start: t - 301000 },
        { id: '#697', category: 11, start: t - 622000 },
      ]);
    }
    if (value === 'Reconciling') setItems([{ id: 'launch #704', category: 4, start: t - 31000 }]);
    if (value === 'Status unknown') {
      setItems([]);
      setUncertain(true);
      setReasons([5]);
    }
    if (value === 'Timing unavailable') setItems([{ id: '#705', category: 2, start: null }]);
    if (value === 'Planning context')
      setItems([{ id: 'automatic planning', category: 6, start: t - 56000 }]);
  }
  const details =
    variant === 'D' ? (
      <section
        id="activity-details"
        className="ap-details ap-details-D"
        aria-label="Factory activity details"
      >
        {uncertain && <p className="ap-warning">Execution outcome unknown</p>}
        <div className="ap-rows">
          {groups.map((group, i) => (
            <div
              key={group.name}
              className={`ap-row ${group.active.length ? 'is-active' : ''}`}
              title={
                group.active.length
                  ? `${purposes[i]}. ${group.active.map((item) => item.id).join(', ')}`
                  : 'Inactive'
              }
            >
              <i
                className={`ap-dot ${group.active.length ? 'active' : ''}`}
                role="img"
                aria-label={group.active.length ? 'Active' : 'Inactive'}
              />
              <b>{group.name}</b>
              {group.active.length > 0 && (
                <div className="ap-metric">
                  <span>
                    {group.active.length} {units(i, group.active.length)}
                  </span>
                  <time>{group.start === null ? 'Start unknown' : duration(group.start, now)}</time>
                </div>
              )}
            </div>
          ))}
        </div>
        {activeReasons.length > 0 && (
          <div className="ap-restrictions">
            <small>New work</small>
            <ul>
              {activeReasons.map((i) => (
                <li key={i}>
                  {
                    [
                      'Admissions paused',
                      'Concurrency full',
                      'Admission allowance exhausted',
                      'No ready-filter matches',
                      'No eligible issues found by planner',
                      'Eligibility unknown',
                    ][i]
                  }
                </li>
              ))}
            </ul>
          </div>
        )}
        <footer className="ap-updated">
          {failures > 0 && (
            <span className="ap-warning">
              {disconnected ? 'Disconnected · last known data' : `Refresh failed ${failures}/3`}
            </span>
          )}
          <time dateTime={new Date(lastSuccess).toISOString()}>
            Updated{' '}
            {new Date(lastSuccess)
              .toISOString()
              .replace('T', ' ')
              .replace(/\.\d+Z$/, ' UTC')}
          </time>
          <span title={age(lastSuccess, now)}>{duration(lastSuccess, now)} ago</span>
        </footer>
      </section>
    ) : (
      <section
        id="activity-details"
        className={`ap-details ap-details-${variant}`}
        aria-label="Factory activity details"
        aria-live="off"
      >
        <header>
          <div>
            <small>{disconnected ? 'LAST KNOWN ACTIVITY' : 'FACTORY ACTIVITY'}</small>
            <h2>{summary}</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setPinned(false);
              setDismissed(true);
            }}
            aria-label="Close activity details"
          >
            ×
          </button>
        </header>
        <p className="ap-caption">
          {disconnected
            ? 'Connection lost. Retained details may be stale.'
            : 'All managed work, in delivery priority order.'}{' '}
          {uncertain && 'Execution outcome requires manual investigation.'}
        </p>
        <div className="ap-rows">
          {groups.map((group, i) => (
            <div key={group.name} className={`ap-row ${group.active.length ? 'is-active' : ''}`}>
              <span className="ap-order">{String(i + 1).padStart(2, '0')}</span>
              <i
                className={`ap-dot ${group.active.length ? 'active' : ''}`}
                role="img"
                aria-label={group.active.length ? 'Active' : 'Inactive'}
              />
              <div className="ap-row-main">
                <b>{group.name}</b>
                <small>{group.active.length ? purposes[i] : 'Inactive'}</small>
                {group.active.length > 0 && (
                  <em>{group.active.map((item) => item.id).join(' · ')}</em>
                )}
              </div>
              <div className="ap-row-metric">
                <b>
                  {group.active.length
                    ? `${group.active.length} ${units(i, group.active.length)}`
                    : '—'}
                </b>
                <small>
                  {group.active.length
                    ? group.start === null
                      ? 'Start unknown'
                      : duration(group.start, now)
                    : 'Inactive'}
                </small>
              </div>
            </div>
          ))}
        </div>
        <aside className="ap-context">
          <div>
            <small>STARTING NEW WORK</small>
            {activeReasons.length ? (
              <ul>
                {activeReasons.map((i) => (
                  <li key={i}>{restrictions[i]}</li>
                ))}
              </ul>
            ) : (
              <p>No observed admission restrictions.</p>
            )}
          </div>
          <div className="ap-freshness">
            <small>LAST SUCCESSFUL REFRESH</small>
            <p>
              {new Date(lastSuccess)
                .toISOString()
                .replace('T', ' ')
                .replace(/\.\d+Z$/, ' UTC')}
              <br />
              <span>{age(lastSuccess, now)}</span>
            </p>
            {failures > 0 && (
              <p className="ap-warning">
                {failures} consecutive failed {failures === 1 ? 'attempt' : 'attempts'}
                {!disconnected && ' · retrying'}
              </p>
            )}
            <p className="ap-note">
              Elapsed time uses the newest current start. It does not prove recent progress.
            </p>
          </div>
        </aside>
      </section>
    );
  const activity = (
    <fieldset
      ref={anchor}
      aria-label="Factory activity"
      className={`ap-anchor ap-anchor-${variant === 'D' ? 'B' : variant}`}
      onMouseEnter={() => {
        clearTimeout(hoverClose.current);
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => {
        hoverClose.current = window.setTimeout(() => setHovered(false), 450);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`ap-summary ${disconnected || (uncertain && highest < 0) ? 'ap-warning' : ''}`}
        aria-expanded={open}
        aria-controls="activity-details"
        onFocus={() => setDismissed(false)}
        onClick={() => {
          setPinned(!pinned);
          setDismissed(false);
        }}
      >
        <i className={`ap-dot ${highest >= 0 && !disconnected ? 'active' : ''}`} />
        <span>
          {variant === 'B' && <small>ACTIVITY</small>}
          <b>{summary}</b>
        </span>
        {selected && !disconnected && (
          <time>{selected.start === null ? 'Start unknown' : duration(selected.start, now)}</time>
        )}
      </button>
      {open && details}
    </fieldset>
  );
  return (
    <div className={`ap-prototype ap-variant-${variant} ${reduced ? 'ap-reduced' : ''}`}>
      <Canvas
        board={board}
        native={false}
        busy={false}
        titleMode="ellipsis"
        reach="direct"
        canConfigure
        onPause={() => setPaused((v) => !v)}
        onSettings={() => setPinned(true)}
        onPlan={() => load('Planning context')}
        onStartIssue={() => load('Concurrent work')}
        onDetails={() => {}}
        onStart={() => {}}
        onCommand={() => {}}
        activityPrototype={activity}
      />
      <details className="ap-lab" aria-label="Prototype scenario controls">
        <summary>Simulation controls</summary>
        <label>
          Scenario
          <select value={scenario} onChange={(e) => load(e.target.value)}>
            {[
              'Concurrent work',
              'Idle restrictions',
              'Managed waits',
              'Reconciling',
              'Status unknown',
              'Timing unavailable',
              'Planning context',
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="ap-actions">
          <button
            type="button"
            disabled={items.some((i) => i.id === '#new')}
            onClick={() => setItems((v) => [...v, { id: '#new', category: 2, start: Date.now() }])}
          >
            New implementer joins
          </button>
          <button
            type="button"
            disabled={!items.some((i) => i.id === '#new')}
            onClick={() => setItems((v) => v.filter((i) => i.id !== '#new'))}
          >
            Newest leaves
          </button>
          <button
            type="button"
            disabled={items.some((i) => i.id === '#publication')}
            onClick={() =>
              setItems((v) => [...v, { id: '#publication', category: 0, start: Date.now() }])
            }
          >
            Start publishing
          </button>
          <button
            type="button"
            onClick={() => setItems((v) => v.filter((i) => i.id !== '#publication'))}
          >
            Finish publishing
          </button>
          <button
            type="button"
            onClick={() => {
              setLastSuccess(Date.now());
              setFailures(0);
            }}
          >
            Successful refresh
          </button>
          <button type="button" onClick={() => setFailures((v) => v + 1)}>
            Fail refresh · {failures}/3
          </button>
        </div>
        <details>
          <summary>Admission restrictions · {activeReasons.length}</summary>
          {restrictions.map((r, i) => (
            <label className="ap-check" key={r}>
              <input
                type="checkbox"
                checked={activeReasons.includes(i)}
                onChange={() => {
                  if (i === 0) setPaused((v) => !v);
                  setReasons((v) => (v.includes(i) ? v.filter((n) => n !== i) : [...v, i]));
                }}
              />
              {r}
            </label>
          ))}
        </details>
        <label className="ap-check">
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
          Preview reduced motion
        </label>

        <details>
          <summary>Relevant simulated state</summary>
          <pre>
            {JSON.stringify(
              {
                variant,
                summary,
                items,
                restrictions: activeReasons.map((i) => restrictions[i]),
                failures,
                lastSuccess: new Date(lastSuccess).toISOString(),
                uncertain,
                excluded: { queuedRestacks: 8, unmanagedPRs: [999] },
              },
              null,
              2
            )}
          </pre>
        </details>
      </details>
      <PrototypeSwitcher variant={variant} change={change} />
    </div>
  );
}
