// Read-only GitHub issue / project 7 snapshot. Workflow states and relationships in the canvas are simulated.
export type IssueMetadata = {
  number: number;
  title: string;
  url: string;
  labels: { name: string; color: string }[];
  priority: string | null;
  size: string | null;
};
export const issueMetadata: Record<number, IssueMetadata> = {
  '8': {
    number: 8,
    title: 'Color filtering',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/8',
    labels: [
      {
        name: 'feature',
        color: '1d0547',
      },
      {
        name: 'needs-triage',
        color: 'D4C5F9',
      },
    ],
    priority: 'P1',
    size: 'L',
  },
  '483': {
    number: 483,
    title: 'Require user approval before significant task scope changes',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/483',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: 'P1',
    size: null,
  },
  '515': {
    number: 515,
    title: 'Validate PostgreSQL mutation activation and stage-owned reuse',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/515',
    labels: [
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '519': {
    number: 519,
    title: 'Validate browser and jsdom mutation activation or record exclusions',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/519',
    labels: [
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '520': {
    number: 520,
    title: 'Validate subprocess and deployed-artifact mutation activation',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/520',
    labels: [
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '527': {
    number: 527,
    title:
      'Record maintained mutation support decisions for helper, docs and configuration workspaces',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/527',
    labels: [
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '528': {
    number: 528,
    title: 'Make URL resolver inputs deterministic and validate native mutations',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/528',
    labels: [
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '555': {
    number: 555,
    title: 'Reject changed-byte replay for rejected or cancelled candidates',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/555',
    labels: [
      {
        name: 'bug',
        color: 'b60205',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '612': {
    number: 612,
    title: 'Fix the Wallpaper deployment fixture released-port startup race',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/612',
    labels: [
      {
        name: 'needs-triage',
        color: 'D4C5F9',
      },
    ],
    priority: null,
    size: null,
  },
  '627': {
    number: 627,
    title: 'Assess mutation coverage gaps and choose which expansions are worthwhile',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/627',
    labels: [
      {
        name: 'ready-for-human',
        color: '1D76DB',
      },
    ],
    priority: null,
    size: null,
  },
  '628': {
    number: 628,
    title: 'Spec: speed up staged mutation checks with selective service reuse',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/628',
    labels: [
      {
        name: 'ready-for-human',
        color: '1D76DB',
      },
      {
        name: 'spec',
        color: '5319e7',
      },
    ],
    priority: null,
    size: null,
  },
  '630': {
    number: 630,
    title: 'Color Extractor quarantine recovery can leave a delivery unacknowledged after restart',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/630',
    labels: [
      {
        name: 'needs-triage',
        color: 'D4C5F9',
      },
    ],
    priority: null,
    size: null,
  },
  '642': {
    number: 642,
    title: 'Reject gain-map JPEGs with fragmented extended XMP',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/642',
    labels: [
      {
        name: 'bug',
        color: 'b60205',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '644': {
    number: 644,
    title: 'Spec: rebuild factory observation, planning reliability and frontend foundations',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/644',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'spec',
        color: '5319e7',
      },
    ],
    priority: null,
    size: null,
  },
  '645': {
    number: 645,
    title: 'Factory: migrate durable state to SQLite with Drizzle',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/645',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '646': {
    number: 646,
    title: 'Factory: expose planner attempts and recover confirmed launch rejections',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/646',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '647': {
    number: 647,
    title: 'Factory: cache GitHub observations and decouple dashboard reads from reconciliation',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/647',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '648': {
    number: 648,
    title: 'Factory: retain T3 thread metadata and use supported thread links',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/648',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '649': {
    number: 649,
    title: 'Factory: replace embedded page strings with a Vite React HTTP frontend',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/649',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '650': {
    number: 650,
    title: 'Factory: redesign planner context, measure messages and expose progress',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/650',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '651': {
    number: 651,
    title: 'Factory: design the graph command centre and visual plan workflow',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/651',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'needs-info',
        color: 'FBCA04',
      },
      {
        name: 'future-work',
        color: 'D0D7DE',
      },
    ],
    priority: null,
    size: null,
  },
  '656': {
    number: 656,
    title: 'Factory: hillclimb test-suite duration to at most five minutes',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/656',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'ready-for-agent',
        color: '0E8A16',
      },
    ],
    priority: null,
    size: null,
  },
  '658': {
    number: 658,
    title: 'Make unused Tags service opt-in for local startup',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/658',
    labels: [],
    priority: null,
    size: null,
  },
  '660': {
    number: 660,
    title: 'Migrate biome-test-rules to TypeScript',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/660',
    labels: [],
    priority: null,
    size: null,
  },
  '663': {
    number: 663,
    title: 'Migrate tooling and Biome rule tests to Vitest',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/663',
    labels: [],
    priority: null,
    size: null,
  },
  '666': {
    number: 666,
    title: 'Investigate lost Docker queue timeout recovery guidance',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/666',
    labels: [
      {
        name: 'agent infrastructure',
        color: '056c3c',
      },
      {
        name: 'needs-triage',
        color: 'D4C5F9',
      },
    ],
    priority: null,
    size: null,
  },
  '668': {
    number: 668,
    title: 'Automate mechanical coding guidelines and agent workflow checks',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/668',
    labels: [],
    priority: null,
    size: null,
  },
};
