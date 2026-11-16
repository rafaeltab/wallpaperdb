import { expect, it } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { createProjectCanvasScene } from '../src/canvas/project-canvas-scene';

it('reuses Project canvas geometry while exposing the latest Project item status and actions', async () => {
  const app = fakeV2Server({ epoch: 'scene-reuse' });
  try {
    const board = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const scene = createProjectCanvasScene();
    const options = { titleMode: 'ellipsis' as const, expandedNames: new Set<string>() };
    const before = scene(board, options);
    const item = Object.values(board.entities.items)[0];
    const updated = {
      ...item,
      version: 'new-version',
      status: { ...item.status, label: 'Reviewing code', active: true },
      actionIds: [],
    };
    const next = scene(
      {
        ...board,
        entities: { ...board.entities, items: { ...board.entities.items, [item.id]: updated } },
      },
      options
    );
    expect(next.geometry).toBe(before.geometry);
    expect(next.layout.boxes.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(
      before.layout.boxes.map(({ x, y, width, height }) => ({ x, y, width, height }))
    );
    expect(next.layout.fixture.items.find((value) => value.item.id === item.id)?.item).toBe(
      updated
    );
    expect(next.layout.boxes.find((value) => value.item.item.id === item.id)?.item.status).toBe(
      'Reviewing code'
    );
    const collapsed = scene(board, { ...options, collapsed: new Set(['planned-none']) });
    expect(collapsed.geometry).not.toBe(before.geometry);
  } finally {
    await app.close();
  }
});

it('invalidates Project canvas geometry for displayed text, rank, topology and display options', async () => {
  const app = fakeV2Server({ epoch: 'scene-invalidation' });
  try {
    const board = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const issue = board.entities.issues['issue:1001'];
    const item = board.entities.items['item:1001'];
    if (issue.metadata.state !== 'known' || issue.project.state !== 'known')
      throw new Error('Expected known Project item metadata');
    const updates: FactoryV2Snapshot[] = [
      {
        ...board,
        entities: {
          ...board.entities,
          issues: {
            ...board.entities.issues,
            [issue.id]: {
              ...issue,
              metadata: {
                ...issue.metadata,
                value: { ...issue.metadata.value, title: 'A different displayed title' },
              },
            },
          },
        },
      },
      {
        ...board,
        entities: {
          ...board.entities,
          issues: {
            ...board.entities.issues,
            [issue.id]: {
              ...issue,
              project: {
                ...issue.project,
                value: { ...issue.project.value, priority: { id: 'P0', name: 'P0', rank: 0 } },
              },
            },
          },
        },
      },
      {
        ...board,
        entities: {
          ...board.entities,
          items: { ...board.entities.items, [item.id]: { ...item, section: 'working' } },
        },
      },
      { ...board, entities: { ...board.entities, relationships: {} } },
      { ...board, entities: { ...board.entities, items: {} } },
    ];
    const options = { titleMode: 'ellipsis' as const, expandedNames: new Set<string>() };
    for (const update of updates) {
      const scene = createProjectCanvasScene();
      const before = scene(board, options);
      expect(scene(update, options).geometry).not.toBe(before.geometry);
    }
    const scene = createProjectCanvasScene();
    const before = scene(board, options);
    expect(scene(structuredClone(board), options).geometry).toBe(before.geometry);
    expect(scene(board, { ...options, titleMode: 'wrap' }).geometry).not.toBe(before.geometry);
  } finally {
    await app.close();
  }
});
