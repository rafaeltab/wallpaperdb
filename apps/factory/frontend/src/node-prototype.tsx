// Throwaway node-canvas study. All states, parents, dependencies, checks and reviews are fixtures.
// Thread destinations below come from evidenced /api/threads metadata; no live commands are sent.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import './node-prototype.css';
import reviewerAvatar from './prototype-reviewer.png';
import { routeSelection } from './prototype-routing';

type Stage = 'planned' | 'working' | 'review';
type CheckState = 'passed' | 'failed' | 'running';
type Issue = {
  id: number;
  title: string;
  parent?: number;
  stage: Stage;
  status: string;
  deps: number[];
  pr?: number;
  thread?: string;
  checks?: CheckState[];
  approved?: boolean;
};
const foundation = 'c9ba7a79-9738-4af8-80c9-61ca104f6874';
const thread519 = 'mcp:758d0180-70e1-4210-ac30-9705944a4a47';
const parents = [
  { id: 644, title: 'Factory command centre', color: '#61c6a7' },
  { id: 602, title: 'Wallpaper discovery', color: '#b29bdc' },
];
const checks = ['CI', 'E2E', 'Coverage', 'Types'];
const review: Issue[] = [
  {
    id: 646,
    pr: 653,
    title: 'Persist and observe bounded planner attempts',
    parent: 644,
    thread: foundation,
  },
  {
    id: 515,
    pr: 524,
    title: 'Share mutation infrastructure without losing service-specific isolation',
    thread: 'mcp:d2a425ca-9696-4146-aec5-554d830ba751',
  },
  {
    id: 647,
    pr: 657,
    title: 'Retain GitHub observations and refresh local operations views',
    parent: 644,
    thread: foundation,
  },
  {
    id: 658,
    pr: 664,
    title: 'Make unused Tags service opt-in for local startup',
    parent: 602,
    thread: '9ed8321b-9acb-4a35-95d7-e6814cb996ef',
  },
  {
    id: 527,
    pr: 531,
    title: 'Record mutation support decisions beside their owners',
    thread: 'mcp:09b62e4a-fc1c-4245-afdf-74b876885867',
  },
  {
    id: 649,
    pr: 670,
    title: 'Extract factory operations into Vite and React',
    parent: 644,
    thread: foundation,
  },
  {
    id: 663,
    pr: 669,
    title: 'Find test files outside the Vitest configuration and make discovery consistent',
    parent: 602,
    thread: '1d3f638d-dc41-447d-817f-307997f69fa1',
  },
  {
    id: 528,
    pr: 532,
    title: 'Make mutation resolver inputs deterministic',
    thread: 'mcp:36b240d8-3a92-4896-9715-1b592cb5b961',
  },
  {
    id: 650,
    pr: 671,
    title: 'Use metadata planner context and durable handoff progress',
    parent: 644,
    thread: foundation,
  },
  {
    id: 519,
    pr: 561,
    title: 'Activate browser and jsdom mutation testing for frontend workflows',
    parent: 602,
    thread: thread519,
  },
  {
    id: 520,
    pr: 602,
    title: 'Activate subprocess mutation testing with isolated temporary workspaces',
    thread: 'mcp:b61e21de-cb5f-4647-b479-0c1594fb6f3f',
  },
  {
    id: 648,
    pr: 672,
    title: 'Retain T3 metadata and supported thread links',
    parent: 644,
    thread: foundation,
  },
].map<Issue>((item, index) => ({
  ...item,
  stage: 'review',
  status: index === 11 ? 'Restacking' : 'Draft',
  deps: [],
  approved: index % 3 !== 2,
  checks:
    index === 10
      ? ['passed', 'failed', 'passed', 'passed']
      : index > 8
        ? ['passed', 'running', 'running', 'passed']
        : ['passed', 'passed', 'passed', 'passed'],
}));
const issues: Issue[] = [
  {
    id: 674,
    title: 'Add admission controls to the graph without interrupting jobs already in progress',
    parent: 644,
    stage: 'planned',
    status: 'Blocked',
    deps: [651],
  },
  {
    id: 651,
    title: 'Build the factory command centre',
    parent: 644,
    stage: 'planned',
    status: 'Blocked',
    deps: [645, 668],
  },
  {
    id: 656,
    title: 'Reduce observation latency',
    parent: 644,
    stage: 'planned',
    status: 'Blocked',
    deps: [645],
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
    title:
      'Save a search as a collection and preserve its ordering when new wallpapers are indexed',
    parent: 602,
    stage: 'planned',
    status: 'Blocked',
    deps: [668],
  },
  {
    id: 680,
    title: 'Improve keyboard navigation in the wallpaper detail view',
    stage: 'planned',
    status: 'Ready for agent',
    deps: [],
  },
  {
    id: 681,
    title: 'Keep download filenames consistent',
    stage: 'planned',
    status: 'Ready for agent',
    deps: [],
  },
  {
    id: 682,
    title: 'Recover failed uploads after a browser reconnect without creating duplicate assets',
    stage: 'planned',
    status: 'Blocked',
    deps: [555],
  },
  {
    id: 645,
    title: 'Persist factory execution state in SQLite with safe legacy import',
    parent: 644,
    stage: 'working',
    status: 'Implementing',
    deps: [648],
    thread: 'mcp:97234656-7780-4162-8809-d89a95def354',
  },
  {
    id: 668,
    title: 'Automate coding rules with repository scripts',
    parent: 602,
    stage: 'working',
    status: 'Reviewing code',
    deps: [663],
    thread: 'efe6d4bb-9c10-419a-a03a-d0f99753a05c',
  },
  {
    id: 555,
    title: 'Reject changed-byte replay for rejected or cancelled candidates',
    stage: 'working',
    status: 'Manual recovery',
    deps: [520],
    thread: 'mcp:ad6112dc-7cf3-446b-b887-d6b017c84dbb',
  },
  ...review,
];
const CARD_W = 332,
  CARD_H = 132,
  STEP = 174,
  GAP = 30;
const groupDefs = [
  { id: 644, label: 'Factory command centre', x: 50, width: CARD_W * 2 + GAP },
  { id: 602, label: 'Wallpaper discovery', x: 50 + CARD_W * 2 + GAP + 55, width: CARD_W },
  {
    id: undefined,
    label: 'Independent issues',
    x: 50 + CARD_W * 3 + GAP + 110,
    width: CARD_W * 2 + GAP,
  },
];
const PLANNED_WIDTH = groupDefs[2].x + groupDefs[2].width + 50;
const ranks = new Map<number, number>();
function rank(id: number): number {
  const cached = ranks.get(id);
  if (cached !== undefined) return cached;
  const item = issues.find((i) => i.id === id);
  // PR ordering comes exclusively from the stack, never issue dependencies.
  const value = item?.pr ? 0 : !item?.deps.length ? 0 : 1 + Math.max(...item.deps.map(rank));
  ranks.set(id, value);
  return value;
}
issues.forEach((item) => rank(item.id));
type Placed = { item: Issue; x: number; y: number; width: number; height: number };
const placed: Placed[] = [];
const areas: { stage: Stage; title: string; y: number; height: number }[] = [];
let cursor = 30;
for (const stage of ['planned', 'working'] as const) {
  const records = issues.filter((i) => i.stage === stage);
  const levels = [...new Set(records.map((i) => rank(i.id)))].sort((a, b) => b - a);
  const height = 82 + levels.length * STEP;
  areas.push({ stage, title: stage === 'planned' ? 'Planned' : 'Working', y: cursor, height });
  for (const group of groupDefs)
    for (const [row, level] of levels.entries()) {
      records
        .filter((i) => i.parent === group.id && rank(i.id) === level)
        .forEach((item, col) =>
          placed.push({
            item,
            x: group.x + col * (CARD_W + GAP),
            y: cursor + 83 + row * STEP,
            width: CARD_W,
            height: CARD_H,
          })
        );
    }
  cursor += height + 62;
}
const REVIEW_Y = cursor;
const PR_H = 74;
const stressFixture = new URLSearchParams(location.search).get('scenario') === 'mixed12';
const expandedStacks = new URLSearchParams(location.search).get('expanded') === '1';
const stackSpecs = stressFixture
  ? [
      {
        id: 'mixed12',
        name: 'Mixed-parent stack',
        ids: review.map((item) => item.id),
        x: 50,
        width: 800,
      },
    ]
  : [
      { id: 'factory', name: 'Factory foundation', ids: [646, 649, 650, 648], x: 50, width: 800 },
      {
        id: 'mixed',
        name: 'Mixed-parent stack',
        ids: [515, 647, 658, 528, 519],
        x: 940,
        width: 800,
      },
    ];
const independentReviews = stressFixture
  ? []
  : review.filter((item) => [527, 663, 520].includes(item.id));
const dependentPRs = new Set(issues.filter((item) => !item.pr).flatMap((item) => item.deps));
const stackContents = stackSpecs.map((stack) => {
  const folded = stack.ids.length > 7 && !expandedStacks;
  const rows: { id?: number; count?: number; offset: number; height: number }[] = [];
  let offset = 36,
    hidden = 0;
  for (const id of [...stack.ids].reverse()) {
    const visible =
      !folded ||
      id === stack.ids[0] ||
      id === stack.ids[stack.ids.length - 1] ||
      dependentPRs.has(id);
    if (!visible) {
      hidden++;
      continue;
    }
    if (hidden) {
      rows.push({ count: hidden, offset, height: 30 });
      offset += 30;
      hidden = 0;
    }
    rows.push({ id, offset, height: PR_H });
    offset += PR_H;
  }
  return { ...stack, folded, rows, height: offset + 8 };
});
const REVIEW_BASE = REVIEW_Y + 65 + Math.max(...stackContents.map((stack) => stack.height));
const stacks = stackContents.map((stack) => ({ ...stack, y: REVIEW_BASE - stack.height }));
for (const stack of stacks) {
  for (const row of stack.rows) {
    const item = review.find((candidate) => candidate.id === row.id);
    if (item)
      placed.push({
        item,
        x: stack.x + 20,
        y: stack.y + row.offset,
        width: stack.width - 30,
        height: row.height,
      });
  }
}
independentReviews.forEach((item, index) =>
  placed.push({
    item,
    x: 1840 + index * 400,
    y: REVIEW_BASE - CARD_H - 8,
    width: 370,
    height: CARD_H,
  })
);
const WORLD_W = Math.max(PLANNED_WIDTH, ...placed.map((p) => p.x + p.width + 70));
const WORLD_H = REVIEW_BASE + 70;
areas.push({ stage: 'review', title: 'In review', y: REVIEW_Y, height: WORLD_H - REVIEW_Y - 25 });
function changeFixture(key: string, value: string) {
  const url = new URL(location.href);
  url.searchParams.set(key, value);
  url.searchParams.set('focus', 'review');
  location.assign(url.href);
}
function color(status: string) {
  return status === 'Implementing'
    ? 'blue'
    : status === 'Reviewing code'
      ? 'purple'
      : status === 'Blocked' || status === 'Manual recovery' || status === 'Restacking'
        ? 'amber'
        : 'green';
}
function Glyph({ type, size = 15 }: { type: string; size?: number }) {
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
      {type === 'pr' ? (
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M6 7v14M12 3l5 4-5 4M17 7v9" />
        </>
      ) : type === 'passed' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </>
      ) : type === 'failed' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6m0-6-6 6" />
        </>
      ) : type === 'running' ? (
        <>
          <circle cx="12" cy="12" r="9" strokeDasharray="24 12" />
          <path d="M12 7v5l3 2" />
        </>
      ) : type === 'gear' ? (
        <>
          <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 1 3h4l2-2 3 1 3-3-1-3 2-2-2-3-3-1-1-3Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : type === 'thread' ? (
        <>
          <rect x="3" y="4" width="18" height="13" rx="3" />
          <path d="m7 17-1 4 6-4M7 9h10m-10 4h6" />
        </>
      ) : type === 'fit' ? (
        <>
          <path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2" />
        </>
      )}
    </svg>
  );
}
function IssueNumber({ item }: { item: Issue }) {
  return (
    <span className="nc-identifiers">
      {item.pr && (
        <>
          <a
            className="green"
            href={`https://github.com/rafaeltab/wallpaperdb/pull/${item.pr}`}
            target="_blank"
            rel="noreferrer"
            title={`Pull request #${item.pr}`}
          >
            <Glyph type="pr" />#{item.pr}
          </a>
          <span className="nc-centre-dot">·</span>
        </>
      )}
      <a
        className={item.pr ? 'nc-issue-ref' : ''}
        href={`https://github.com/rafaeltab/wallpaperdb/issues/${item.id}`}
        target="_blank"
        rel="noreferrer"
        title={`Issue #${item.id}`}
      >
        <Glyph type="issue" size={item.pr ? 12 : 14} />#{item.id}
      </a>
    </span>
  );
}
function ThreadLinks({ item }: { item: Issue }) {
  if (!item.thread) return null;
  const path = `${encodeURIComponent('65a55dad-0df9-496d-bdad-21a139b9456d')}/${encodeURIComponent(item.thread)}`;
  return (
    <span className="nc-thread-links">
      <a
        href={`https://app.t3.codes/${path}`}
        target="_blank"
        rel="noreferrer"
        title="Open evidenced T3 thread in browser"
      >
        <Glyph type="thread" size={12} />
        T3 ↗
      </a>
      <a href={`t3code://threads/${path}`} title="Open T3 desktop app">
        ⌘
      </a>
    </span>
  );
}
function Status({ item }: { item: Issue }) {
  return (
    <span className={`nc-status ${color(item.status)}`}>
      <i />
      {item.status}
    </span>
  );
}
function CI({ item }: { item: Issue }) {
  return (
    <span className="nc-ci">
      {item.checks?.map((state, index) => (
        <span
          className={`nc-check ${state}`}
          key={checks[index]}
          title={`${checks[index]}: ${state}`}
          aria-label={`${checks[index]}: ${state}`}
        >
          <Glyph type={state} size={14} />
          <span>{checks[index]}</span>
        </span>
      ))}
    </span>
  );
}
function Reviewer({ item }: { item: Issue }) {
  return (
    <span
      className={`nc-reviewer ${item.approved ? 'approved' : ''}`}
      title={`Rafael: ${item.approved ? 'approved' : 'review requested'} · mock review`}
    >
      <img src={reviewerAvatar} width="19" height="19" alt="Rafael" />
      {item.approved ? (
        <span className="nc-review-tick">✓</span>
      ) : (
        <span className="nc-review-pending">·</span>
      )}
    </span>
  );
}
function ParentBadge({ id }: { id?: number }) {
  const parent = parents.find((p) => p.id === id);
  return (
    <span className="nc-parent-badge" style={{ color: parent?.color ?? '#858593' }}>
      {parent ? (
        <>
          <i style={{ background: parent.color }} />#{id} {parent.title}
        </>
      ) : (
        'No parent'
      )}
    </span>
  );
}
function IssueMetadata({ item }: { item: Issue }) {
  const labels =
    item.parent === 644
      ? ['factory', item.id % 2 ? 'frontend' : 'backend']
      : item.parent === 602
        ? ['enhancement', 'discovery']
        : item.id % 2
          ? ['bug', 'reliability']
          : ['tooling'];
  const priority = item.status === 'Manual recovery' ? 'P0' : item.id % 3 === 0 ? 'P1' : 'P2';
  const size = ['XS', 'S', 'M', 'L', 'XL'][item.id % 5];
  return (
    <div className="nc-issue-metadata">
      <span
        className={`nc-priority ${priority.toLowerCase()}`}
        title={`GitHub Project priority: ${priority} · mock value`}
      >
        ▰ {priority}
      </span>
      <span className="nc-size" title={`GitHub Project size: ${size} · mock value`}>
        {size}
      </span>
      <span className="nc-meta-separator" />
      {labels.map((label) => (
        <span key={label} className={`nc-label nc-label-${label}`}>
          {label}
        </span>
      ))}
    </div>
  );
}
const connections = issues
  .filter((item) => !item.pr)
  .flatMap((item) => item.deps.map((id) => ({ source: id, target: item.id })));
const routingNodes = placed.map((p) => ({
  stacked: stacks.some((stack) => stack.ids.includes(p.item.id)),
  id: p.item.id,
  x: p.x,
  y: p.y,
  width: p.width,
  height: p.height,
}));
const routingObstacles = [
  ...stacks.map((stack) => ({ x: stack.x, y: stack.y, width: stack.width, height: stack.height })),
  ...areas.map((area) => ({ x: 20, y: area.y - 12, width: 160, height: 24 })),
  ...areas
    .filter((area) => area.stage !== 'review')
    .flatMap((area) =>
      groupDefs.flatMap((group) => {
        const records = placed.filter(
          (p) => p.item.stage === area.stage && p.item.parent === group.id
        );
        if (!records.length) return [];
        return [
          {
            x: group.x - 15,
            y: Math.min(...records.map((p) => p.y)) - 34,
            width: group.label.length * 7 + 65,
            height: 28,
          },
        ];
      })
    ),
];

export function NodePrototype() {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 15, y: 10, scale: 0.7 });
  const drag = useRef<
    { pointer: number; x: number; y: number; vx: number; vy: number } | undefined
  >(undefined);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<number>();
  const routing = useMemo(
    () => routeSelection(routingNodes, connections, routingObstacles, WORLD_W, WORLD_H),
    []
  );
  const neighborEdges = new Map(
    routing.routes
      .filter((edge) => edge.source === selected || edge.target === selected)
      .map((edge) => [edge.source === selected ? edge.target : edge.source, edge])
  );
  function selectCard(id: number) {
    setSelected((current) => (current === id ? undefined : id));
  }
  function fitConnections() {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds || !selected) return;
    const activeRoutes = routing.routes.filter(
      (edge) => edge.source === selected || edge.target === selected
    );
    const records = placed.filter((p) => p.item.id === selected || neighborEdges.has(p.item.id));
    const minX =
      Math.min(
        ...records.map((p) => p.x),
        ...activeRoutes.flatMap((edge) => edge.points.map((p) => p.x))
      ) - 50;
    const minY =
      Math.min(
        ...records.map((p) => p.y),
        ...activeRoutes.flatMap((edge) => edge.points.map((p) => p.y))
      ) - 50;
    const maxX =
      Math.max(
        ...records.map((p) => p.x + p.width),
        ...activeRoutes.flatMap((edge) => edge.points.map((p) => p.x))
      ) + 50;
    const maxY =
      Math.max(
        ...records.map((p) => p.y + p.height),
        ...activeRoutes.flatMap((edge) => edge.points.map((p) => p.y))
      ) + 50;
    const scale = Math.min(
      1,
      (bounds.width - 60) / (maxX - minX),
      (bounds.height - 145) / (maxY - minY)
    );
    setView({
      scale,
      x: (bounds.width - (maxX - minX) * scale) / 2 - minX * scale,
      y: 20 - minY * scale,
    });
  }
  const [settings, setSettings] = useState(false);
  const [paused, setPaused] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [allowance, setAllowance] = useState(1);
  const [preview, setPreview] = useState(false);
  const [start, setStart] = useState(false);
  const [issueInput, setIssueInput] = useState('');
  const [context, setContext] = useState('');
  const [notice, setNotice] = useState('');
  const [cancelled, setCancelled] = useState<number[]>([]);
  const [resumed, setResumed] = useState<number[]>([]);
  function fit() {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const scale = Math.min((bounds.width - 60) / WORLD_W, (bounds.height - 60) / WORLD_H, 1);
    setView({ x: (bounds.width - WORLD_W * scale) / 2, y: 20, scale });
  }
  function zoom(factor: number, point?: { x: number; y: number }) {
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const p = point ?? { x: bounds.width / 2, y: bounds.height / 2 };
    setView((current) => {
      const scale = Math.max(0.18, Math.min(1.8, current.scale * factor));
      return {
        x: p.x - ((p.x - current.x) * scale) / current.scale,
        y: p.y - ((p.y - current.y) * scale) / current.scale,
        scale,
      };
    });
  }
  function jump(stage: Stage) {
    const area = areas.find((a) => a.stage === stage);
    if (!area) return;
    const bounds = viewport.current?.getBoundingClientRect();
    if (!bounds) return;
    const scale = 0.9;
    setView({ scale, x: 20, y: 20 - area.y * scale });
  }
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    setView({
      x: 15,
      y: new URLSearchParams(location.search).get('focus') === 'review' ? 20 - REVIEW_Y * 0.9 : 12,
      scale: 0.9,
    });
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('.nc-floating, .nc-controls, .nc-minimap')) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey || (!event.shiftKey && Math.abs(event.deltaX) < 1)) {
        const p = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        setView((current) => {
          const scale = Math.max(
            0.18,
            Math.min(1.8, current.scale * Math.exp(-event.deltaY * 0.002))
          );
          return {
            x: p.x - ((p.x - current.x) * scale) / current.scale,
            y: p.y - ((p.y - current.y) * scale) / current.scale,
            scale,
          };
        });
      } else
        setView((current) => ({
          ...current,
          x: current.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: current.y - (event.shiftKey ? 0 : event.deltaY),
        }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')
      )
        return;
      if (event.key === 'Escape') {
        setSettings(false);
        setPreview(false);
        setStart(false);
        setSelected(undefined);
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(1.2);
      }
      if (event.key === '-') {
        event.preventDefault();
        zoom(1 / 1.2);
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fit();
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        setView((v) => ({
          ...v,
          x: v.x + (event.key === 'ArrowLeft' ? 65 : event.key === 'ArrowRight' ? -65 : 0),
          y: v.y + (event.key === 'ArrowUp' ? 65 : event.key === 'ArrowDown' ? -65 : 0),
        }));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest(
        'a,button,input,textarea,select,.nc-node,.nc-floating,.nc-controls,.nc-minimap'
      ) ||
      event.button !== 0
    )
      return;
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      vx: view.x,
      vy: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    setView((v) => ({
      ...v,
      x: current.vx + event.clientX - current.x,
      y: current.vy + event.clientY - current.y,
    }));
  }
  function stopDrag() {
    drag.current = undefined;
    setDragging(false);
  }
  const selectedItem = issues.find((i) => i.id === selected);
  const linked = new Set([
    selected,
    ...(issues.find((i) => i.id === selected)?.deps ?? []),
    ...issues.filter((i) => i.deps.includes(selected ?? -1)).map((i) => i.id),
  ]);
  function simulate(action: string) {
    setNotice(`${action} · simulated only`);
  }
  return (
    <div className="nc-app">
      <header className="nc-toolbar">
        <strong>Factory</strong>
        <span className={`nc-runtime ${paused ? 'amber' : 'green'}`}>
          <i />
          {paused ? 'Paused' : 'Running'}
        </span>
        <span className="nc-toolbar-muted">{3 - cancelled.length} working</span>
        <span className="nc-toolbar-muted">12 PRs</span>
        <span className="nc-mock">Mock data & controls</span>
        <span className="nc-toolbar-space" />
        <select
          aria-label="Fixture scenario"
          value={stressFixture ? 'mixed12' : 'varied'}
          onChange={(event) => changeFixture('scenario', event.target.value)}
        >
          <option value="varied">Varied stacks</option>
          <option value="mixed12">12-PR mixed stack</option>
        </select>
        <button
          type="button"
          className="nc-top-button"
          onClick={() => {
            setPreview(!preview);
            setStart(false);
            setSettings(false);
          }}
        >
          ◇ Preview plan
        </button>
        <button
          type="button"
          className="nc-top-button"
          onClick={() => {
            setStart(!start);
            setPreview(false);
            setSettings(false);
          }}
        >
          + Start issue
        </button>
        <button
          type="button"
          className={`nc-top-button ${paused ? 'green' : ''}`}
          onClick={() => {
            setPaused(!paused);
            simulate(paused ? 'Admissions resumed' : 'Admissions paused');
          }}
        >
          {paused ? '▶ Resume' : 'Ⅱ Pause'}
        </button>
        <button
          type="button"
          className={`nc-gear ${settings ? 'active' : ''}`}
          aria-label="Factory settings"
          aria-expanded={settings}
          onClick={() => {
            setSettings(!settings);
            setStart(false);
            setPreview(false);
          }}
        >
          <Glyph type="gear" size={18} />
        </button>
      </header>
      <div
        ref={viewport}
        className={`nc-viewport ${dragging ? 'dragging' : ''}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
      >
        <div
          className="nc-world"
          style={{
            width: WORLD_W,
            height: WORLD_H,
            transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
          }}
        >
          {areas.map((area) => (
            <div
              className={`nc-area nc-area-${area.stage}`}
              key={area.stage}
              style={{ top: area.y, width: WORLD_W - 70, height: area.height }}
            >
              <div className="nc-area-title">
                <i />
                {area.title}
                <span>{issues.filter((i) => i.stage === area.stage).length}</span>
              </div>
              {area.stage !== 'review' &&
                groupDefs
                  .filter((group) =>
                    issues.some((i) => i.stage === area.stage && i.parent === group.id)
                  )
                  .map((group) => (
                    <div
                      className={`nc-namespace ${group.id === undefined ? 'ungrouped' : ''}`}
                      key={group.id ?? 'independent'}
                      style={{
                        left: group.x - 35,
                        top:
                          Math.min(
                            ...placed
                              .filter(
                                (p) => p.item.stage === area.stage && p.item.parent === group.id
                              )
                              .map((p) => p.y)
                          ) -
                          area.y -
                          34,
                        width: group.width + 20,
                        height:
                          Math.max(
                            ...placed
                              .filter(
                                (p) => p.item.stage === area.stage && p.item.parent === group.id
                              )
                              .map((p) => p.y + p.height)
                          ) -
                          Math.min(
                            ...placed
                              .filter(
                                (p) => p.item.stage === area.stage && p.item.parent === group.id
                              )
                              .map((p) => p.y)
                          ) +
                          48,
                      }}
                    >
                      <span className="nc-namespace-title">
                        {group.id ? (
                          <>
                            <i
                              style={{ background: parents.find((p) => p.id === group.id)?.color }}
                            />
                            <a
                              href={`https://github.com/rafaeltab/wallpaperdb/issues/${group.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              #{group.id}
                            </a>
                            {group.label}
                          </>
                        ) : (
                          group.label
                        )}
                      </span>
                    </div>
                  ))}
            </div>
          ))}
          <svg className="nc-edges" width={WORLD_W} height={WORLD_H} aria-hidden="true">
            <defs>
              {routing.routes.map((edge) => (
                <marker
                  key={edge.key}
                  id={`nc-arrow-${edge.key}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M2 2L8 5L2 8" fill="none" stroke={edge.color} strokeWidth="1.8" />
                </marker>
              ))}
            </defs>
            {routing.routes.map((edge) => (
              <g key={edge.key}>
                <path className="nc-route-halo" d={edge.d} />
                <path
                  className={`nc-route ${selected ? (edge.source === selected || edge.target === selected ? 'active' : 'muted') : ''}`}
                  data-connection={edge.key}
                  data-route-points={JSON.stringify(edge.points)}
                  d={edge.d}
                  stroke={edge.color}
                  markerEnd={`url(#nc-arrow-${edge.key})`}
                />
              </g>
            ))}
          </svg>
          <svg className="nc-route-ports" width={WORLD_W} height={WORLD_H} aria-hidden="true">
            {routing.routes
              .filter((edge) => edge.source === selected || edge.target === selected)
              .flatMap((edge) =>
                [edge.points[0], edge.points[edge.points.length - 1]].map((point, index) => (
                  <g key={`${edge.key}-${index}`} transform={`translate(${point.x},${point.y})`}>
                    <circle r="9" fill="#101017" stroke={edge.color} strokeWidth="1.5" />
                    <text fill={edge.color} textAnchor="middle" dominantBaseline="central">
                      {edge.label}
                    </text>
                  </g>
                ))
              )}
          </svg>
          {stacks.map((stack) => (
            <section
              className="nc-stack"
              key={stack.id}
              style={{ left: stack.x, top: stack.y, width: stack.width, height: stack.height }}
            >
              <div className="nc-stack-heading">
                <Glyph type="pr" />
                <span className="nc-stack-name">{stack.name}</span>
                <span>{stack.ids.length} PRs</span>
                <span className="nc-stack-composition">base ↓</span>
                {stack.ids.length > 7 && (
                  <button
                    type="button"
                    onClick={() => changeFixture('expanded', expandedStacks ? '0' : '1')}
                  >
                    {expandedStacks ? 'Fold' : 'Expand all'}
                  </button>
                )}
              </div>
              <div className="nc-stack-rail" />
              {stack.rows
                .filter((row) => !row.id)
                .map((row) => (
                  <button
                    type="button"
                    className="nc-stack-fold"
                    key={row.offset}
                    style={{ top: row.offset, height: row.height }}
                    onClick={() => changeFixture('expanded', '1')}
                  >
                    ··· {row.count} more PRs
                  </button>
                ))}
            </section>
          ))}
          {independentReviews.length > 0 && (
            <div
              className="nc-independent-heading"
              style={{ left: 1840, top: REVIEW_BASE - CARD_H - 40 }}
            >
              Independent pull requests
            </div>
          )}
          {placed.map((position) => {
            const { item } = position;
            const active = resumed.includes(item.id) ? { ...item, status: 'Implementing' } : item;
            return (
              <div
                key={item.id}
                data-issue={item.id}
                tabIndex={0}
                role="group"
                aria-label={`Trace dependencies for issue #${item.id}`}
                onClick={(event) => {
                  if (!(event.target as Element).closest('a,button,input,textarea,select'))
                    selectCard(item.id);
                }}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === 'Enter' || event.key === ' ')
                  ) {
                    event.preventDefault();
                    selectCard(item.id);
                  }
                }}
                className={`nc-node ${item.pr ? 'nc-pr-node' : ''} ${item.pr && !stacks.some((stack) => stack.ids.includes(item.id)) ? 'nc-independent-pr' : ''} ${selected === item.id ? 'selected' : ''} ${neighborEdges.has(item.id) ? 'nc-related' : ''} ${selected && !linked.has(item.id) ? 'dimmed' : ''} ${cancelled.includes(item.id) ? 'cancelled' : ''}`}
                style={{
                  left: position.x,
                  top: position.y,
                  width: position.width,
                  height: position.height,
                  borderColor: neighborEdges.get(item.id)?.color,
                }}
              >
                <span className="nc-port nc-port-top" />
                <span className="nc-port nc-port-bottom" />
                {item.pr && stacks.some((stack) => stack.ids.includes(item.id)) && (
                  <span className="nc-stack-junction" />
                )}
                {item.pr &&
                  issues.some((candidate) => !candidate.pr && candidate.deps.includes(item.id)) && (
                    <span className="nc-pr-outlet" />
                  )}
                <div className="nc-node-identity">
                  <IssueNumber item={item} />
                  {neighborEdges.has(item.id) && (
                    <span
                      className="nc-relation-tag"
                      title={
                        neighborEdges.get(item.id)?.source === item.id
                          ? 'Selected issue depends on this'
                          : 'This issue depends on the selected issue'
                      }
                      style={{ color: neighborEdges.get(item.id)?.color }}
                    >
                      {neighborEdges.get(item.id)?.label}
                      {!item.pr && (
                        <>
                          {' '}
                          ·{' '}
                          {neighborEdges.get(item.id)?.source === item.id
                            ? 'Prerequisite'
                            : 'Dependant'}
                        </>
                      )}
                    </span>
                  )}
                  {item.pr ? <ParentBadge id={item.parent} /> : <Status item={active} />}
                </div>
                <button
                  type="button"
                  className="nc-node-title"
                  onClick={() => selectCard(item.id)}
                  title={item.title}
                >
                  {item.title}
                </button>
                <IssueMetadata item={item} />
                <div className="nc-node-footer">
                  {item.pr ? (
                    <>
                      <CI item={item} />
                      <Reviewer item={item} />
                      {item.status === 'Restacking' && <Status item={item} />}
                    </>
                  ) : (
                    <span className="nc-node-blockers">
                      {cancelled.includes(item.id) ? (
                        'Cancelled · simulated'
                      ) : item.deps.length ? (
                        <>
                          {item.stage === 'working' ? 'Waiting on ' : 'Blocked by '}
                          {item.deps.map((id, index) => (
                            <span key={id}>
                              {index ? ', ' : ''}
                              <button type="button" onClick={() => setSelected(id)}>
                                #{id}
                              </button>
                            </span>
                          ))}
                        </>
                      ) : (
                        'Ready for agent'
                      )}
                    </span>
                  )}
                  <span className="nc-node-spacer" />
                  <ThreadLinks item={item} />
                </div>
              </div>
            );
          })}
        </div>
        <nav className="nc-controls" aria-label="Canvas navigation">
          <button type="button" onClick={() => jump('planned')}>
            Planned
          </button>
          <button type="button" onClick={() => jump('working')}>
            Working
          </button>
          <button type="button" onClick={() => jump('review')}>
            In review
          </button>
          <span className="nc-control-divider" />
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
            −
          </button>
          <span className="nc-zoom-value">{Math.round(view.scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>
            +
          </button>
          <button type="button" aria-label="Fit all nodes" title="Fit all · F" onClick={fit}>
            <Glyph type="fit" />
          </button>
          <button type="button" title="100%" onClick={() => setView({ x: 10, y: 5, scale: 1 })}>
            1:1
          </button>
        </nav>
        <div className="nc-canvas-hint">
          Drag to pan · Scroll to zoom · Click a card to trace dependencies
        </div>
        <svg
          className="nc-minimap"
          style={{ width: 150, height: (150 * WORLD_H) / WORLD_W }}
          viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
          aria-label="Canvas minimap"
          role="img"
          onPointerDown={(e) => {
            e.stopPropagation();
            const bounds = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - bounds.left) / bounds.width) * WORLD_W;
            const y = ((e.clientY - bounds.top) / bounds.height) * WORLD_H;
            const element = viewport.current;
            if (element)
              setView((v) => ({
                ...v,
                x: element.clientWidth / 2 - x * v.scale,
                y: element.clientHeight / 2 - y * v.scale,
              }));
          }}
        >
          {areas.map((a) => (
            <rect
              key={a.stage}
              x="20"
              y={a.y}
              width={WORLD_W - 40}
              height={a.height}
              className="nc-map-area"
            />
          ))}
          {placed.map((p) => (
            <rect
              key={p.item.id}
              x={p.x}
              y={p.y}
              width={p.width}
              height={p.height}
              className={`nc-map-node ${color(p.item.status)}`}
            />
          ))}
          <rect
            x={-view.x / view.scale}
            y={-view.y / view.scale}
            width={(viewport.current?.clientWidth ?? 1200) / view.scale}
            height={(viewport.current?.clientHeight ?? 800) / view.scale}
            className="nc-map-view"
          />
        </svg>
      </div>
      {selectedItem && (
        <div className="nc-selection nc-floating">
          <span className="nc-selected-label">#{selectedItem.id}</span>
          <span>
            {selectedItem.deps.length} prerequisites ·{' '}
            {issues.filter((item) => !item.pr && item.deps.includes(selectedItem.id)).length}{' '}
            dependants
          </span>
          <button type="button" onClick={fitConnections}>
            Fit connections
          </button>
          {routing.failed && <span className="red">Unable to route this selection</span>}
          {selectedItem.stage === 'working' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setResumed((current) => [...current, selectedItem.id]);
                  simulate(`Resume #${selectedItem.id}`);
                }}
              >
                Resume
              </button>
              <button
                type="button"
                className="red"
                onClick={() => {
                  setCancelled((current) =>
                    current.includes(selectedItem.id) ? current : [...current, selectedItem.id]
                  );
                  simulate(`Cancel #${selectedItem.id}`);
                }}
              >
                Cancel job
              </button>
            </>
          )}
          <button type="button" aria-label="Clear selection" onClick={() => setSelected(undefined)}>
            ×
          </button>
        </div>
      )}
      {settings && (
        <section className="nc-settings nc-floating" aria-label="Factory settings">
          <div className="nc-panel-heading">
            <strong>Settings</strong>
            <button type="button" aria-label="Close settings" onClick={() => setSettings(false)}>
              ×
            </button>
          </div>
          <label>
            Concurrent jobs
            <input
              type="number"
              min="1"
              max="20"
              value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <p>How many jobs can run together.</p>
          <label>
            Distinct issue allowance
            <input
              type="number"
              min="-1"
              value={allowance}
              onChange={(e) => setAllowance(Math.max(-1, Number(e.target.value)))}
            />
          </label>
          <p>Admission limit. Use −1 for unlimited.</p>
          <label className="nc-toggle">
            <span>Pause new admissions</span>
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          </label>
          <div className="nc-settings-state">
            {concurrency} concurrent · {allowance === -1 ? 'Unlimited' : allowance} admissions ·{' '}
            {paused ? 'Paused' : 'Enabled'}
          </div>
          <button
            type="button"
            className="nc-panel-primary"
            onClick={() => {
              simulate('Settings saved locally');
              setSettings(false);
            }}
          >
            Apply locally
          </button>
          <small>Prototype settings reset on reload. Live controls are untouched.</small>
        </section>
      )}
      {preview && (
        <section className="nc-plan nc-floating" aria-label="Simulated plan preview">
          <div className="nc-panel-heading">
            <strong>
              Plan preview <span>Simulated</span>
            </strong>
            <button type="button" aria-label="Close plan preview" onClick={() => setPreview(false)}>
              ×
            </button>
          </div>
          <div className="nc-plan-progress">
            <Glyph type="passed" />
            <span>Gathered</span>
            <span>→</span>
            <Glyph type="passed" />
            <span>Planned</span>
            <span>→</span>
            <Glyph type="passed" />
            <span>Validated</span>
          </div>
          <div className="nc-plan-selection">
            <span className="green">Proposed</span>
            {issues
              .filter((i) => i.stage === 'planned' && !i.deps.length)
              .slice(0, allowance === -1 ? undefined : allowance)
              .map((i) => (
                <div key={i.id}>
                  <IssueNumber item={i} />
                  <span>{i.title}</span>
                </div>
              ))}
          </div>
          <p>
            Blocked issues remain outside this example selection. No planner was called and no work
            was dispatched.
          </p>
          <button
            type="button"
            className="nc-panel-primary"
            onClick={() => simulate('Preview refreshed locally')}
          >
            Refresh simulation
          </button>
        </section>
      )}
      {start && (
        <form
          className="nc-start nc-floating"
          onSubmit={(e) => {
            e.preventDefault();
            simulate(`Start issue #${issueInput}`);
            setStart(false);
          }}
        >
          <div className="nc-panel-heading">
            <strong>
              Start issue <span>Simulated</span>
            </strong>
            <button type="button" aria-label="Close start issue" onClick={() => setStart(false)}>
              ×
            </button>
          </div>
          <label>
            Issue number
            <input
              type="number"
              min="1"
              required
              value={issueInput}
              onChange={(e) => setIssueInput(e.target.value)}
            />
          </label>
          <label>
            Execution context
            <textarea
              value={context}
              maxLength={16000}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Optional maintainer context…"
            />
          </label>
          <button type="submit" className="nc-panel-primary">
            Simulate start
          </button>
        </form>
      )}
      {notice && (
        <div className="nc-notice" role="status">
          {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
