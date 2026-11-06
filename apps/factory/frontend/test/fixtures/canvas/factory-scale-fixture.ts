// Throwaway, deterministic stress data. Synthetic numbers, metadata and relationships are not GitHub facts.
import type { IssueMetadata } from './factory-metadata-fixture';

export type CanvasItem = {
  id: number;
  parent?: number;
  stage: 'planned' | 'working' | 'review';
  deps: number[];
  status: string;
  pr?: number;
  draft?: boolean;
  thread?: string;
  checks?: ('passed' | 'failed' | 'running')[];
  approved?: boolean;
  conflicts?: boolean;
  synthetic?: boolean;
  sourceIssue?: number;
};

export type FixtureBundle = {
  items: CanvasItem[];
  metadata: Record<number, IssueMetadata>;
  parentIds: number[];
  // A parent can itself belong to another parent. Keys are child parent IDs, values are ancestor IDs.
  parentOf: Record<number, number>;
  stackSpecs: { key: string; ids: number[]; stacked: boolean }[];
  synthetic: boolean;
};

const titles = [
  'Keep wallpaper downloads consistent after a browser reconnect',
  'Make cached factory observations available while a remote provider is unavailable',
  'Preserve collection ordering when newly indexed wallpapers match an existing saved search',
  'Explain why an admission is blocked without losing its parent issue and dependency context',
  'Recover interrupted uploads without creating duplicate assets or repeating completed processing stages',
  'Expose planner progress and pending validation results across long-running attempts, reconnections and interrupted agent sessions',
  'Route connected work through the factory',
  'Display every review and CI result',
];
const areas = [
  'Factory observations and autonomous issue delivery',
  'Wallpaper discovery and saved collections',
  'Upload recovery and durable processing',
  'Agent tooling and validation infrastructure',
  'Search ranking and colour extraction',
  'Authentication and personal preferences',
  'Review publication and dependency stacks',
  'Asset storage and download delivery',
  'Activity history and notification preferences',
  'Metadata indexing and migration recovery',
];
const labelSets = [
  [
    { name: 'agent infrastructure', color: '056c3c' },
    { name: 'ready-for-agent', color: '0E8A16' },
  ],
  [
    { name: 'bug', color: 'b60205' },
    { name: 'needs-info', color: 'FBCA04' },
    { name: 'future-work', color: 'D0D7DE' },
  ],
  [{ name: 'feature', color: '1d0547' }],
  [],
  [
    { name: 'testability', color: '5f7610' },
    { name: 'synthetic:very-long-label-for-layout-exploration', color: '1177aa' },
    { name: 'needs-triage', color: 'D4C5F9' },
    { name: 'releasability', color: 'fa6b49' },
  ],
];

function stackSpecs(items: CanvasItem[], prefix: string) {
  const reviewed = items.filter((item) => item.stage === 'review');
  const independent = reviewed.filter((_, index) => index % 7 === 0);
  const stacked = reviewed.filter((_, index) => index % 7 !== 0);
  const specs: FixtureBundle['stackSpecs'] = [];
  let index = 0;
  for (let cursor = 0; cursor < stacked.length; ) {
    // A mix of short stacks and stacks large enough to exercise folded ranges.
    const length = [3, 6, 2, 9, 4][index % 5];
    specs.push({
      key: `${prefix}-stack-${index + 1}`,
      ids: stacked.slice(cursor, cursor + length).map((item) => item.id),
      stacked: true,
    });
    cursor += length;
    index++;
  }
  if (independent.length) {
    specs.push({
      key: `${prefix}-independent`,
      ids: independent.map((item) => item.id),
      stacked: false,
    });
  }
  return specs;
}

export function buildScaleFixture(count: 100 | 200 | 300): FixtureBundle {
  const parentIds = Array.from({ length: Math.ceil(count / 30) }, (_, index) => 900_001 + index);
  const metadata: Record<number, IssueMetadata> = {};
  parentIds.forEach((id, index) => {
    metadata[id] = {
      number: id,
      title:
        index === 0
          ? 'Synthetic parent 1: Factory observations, autonomous issue delivery, durable recovery, dependency-aware planning and coordinated publication across several review stacks'
          : `Synthetic parent ${index + 1}: ${areas[index % areas.length]}`,
      url: '',
      labels: [{ name: 'spec', color: '5319e7' }],
      priority: index % 3 === 0 ? null : 'P2',
      size: index % 4 === 0 ? null : 'XL',
    };
  });
  const items: CanvasItem[] = Array.from({ length: count }, (_, index) => {
    const id = 100_001 + index;
    const slot = index % 20;
    const stage = slot < 9 ? 'planned' : slot < 14 ? 'working' : 'review';
    const parent = index % 7 < 2 ? undefined : parentIds[Math.floor(index / 20) % parentIds.length];
    metadata[id] = {
      number: id,
      title: `Synthetic ${index + 1}: ${titles[index % titles.length]}`,
      url: '',
      labels: labelSets[index % labelSets.length].map((label) => ({ ...label })),
      priority:
        index % 16 === 4 ? 'P0' : index % 4 === 0 ? null : ['P0', 'P1', 'P2', 'P3'][index % 4],
      size: index % 3 === 0 ? null : ['XS', 'S', 'M', 'L', 'XL'][index % 5],
    };
    return {
      id,
      parent,
      stage,
      deps: [],
      synthetic: true,
      status:
        stage === 'planned'
          ? 'Ready'
          : stage === 'working'
            ? index % 2 === 0
              ? 'Implementing'
              : 'Reviewing code'
            : 'Draft',
      ...(stage === 'review'
        ? {
            pr: 200_001 + index,
            draft: index % 3 === 0,
            checks: [
              'passed',
              index % 4 === 0 ? 'failed' : 'passed',
              index % 3 === 0 ? 'running' : 'passed',
              'passed',
            ],
            approved: index % 3 !== 0,
            conflicts: index % 11 === 0,
          }
        : {}),
    };
  });
  const working = items.filter((item) => item.stage === 'working');
  const reviewed = items.filter((item) => item.stage === 'review');
  items.forEach((item, index) => {
    if (item.stage === 'working' && index % 4 === 1) {
      const candidates = reviewed.filter((candidate) => candidate.parent === item.parent);
      const dep =
        candidates[index % Math.max(candidates.length, 1)] ?? reviewed[index % reviewed.length];
      if (dep) item.deps.push(dep.id);
    }
    if (item.stage === 'planned' && index % 5 === 0) {
      const candidates = working.filter((candidate) => candidate.parent === item.parent);
      const dep =
        candidates[index % Math.max(candidates.length, 1)] ?? working[index % working.length];
      if (dep) item.deps.push(dep.id);
    }
    if (item.stage === 'planned' && index % 13 === 0) {
      const previous = items
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.stage === 'planned' && candidate.parent === item.parent);
      if (previous && !item.deps.includes(previous.id)) item.deps.push(previous.id);
    }
    if (item.stage === 'planned' && item.deps.length) item.status = 'Blocked';
  });
  return {
    items,
    metadata,
    parentIds,
    parentOf: {},
    stackSpecs: stackSpecs(items, `synthetic-${count}`),
    synthetic: true,
  };
}

export function buildNestedFixture(
  items: CanvasItem[],
  metadata: Record<number, IssueMetadata>
): FixtureBundle {
  const root = 910_001;
  const platform = 910_002;
  const copiedItems = items.map((item) => ({ ...item, deps: [...item.deps] }));
  return {
    items: copiedItems,
    metadata: {
      ...metadata,
      [root]: {
        number: root,
        title:
          'Synthetic ancestor: Make autonomous delivery understandable and recoverable across the entire repository',
        url: '',
        labels: [{ name: 'spec', color: '5319e7' }],
        priority: null,
        size: null,
      },
      [platform]: {
        number: platform,
        title:
          'Synthetic intermediate parent: Factory execution, observation and review orchestration',
        url: '',
        labels: [{ name: 'agent infrastructure', color: '056c3c' }],
        priority: null,
        size: 'XL',
      },
    },
    parentIds: [root, platform, 644, 628],
    parentOf: { [platform]: root, 644: platform, 628: root },
    stackSpecs: stackSpecs(copiedItems, 'nested'),
    synthetic: true,
  };
}
