import { canvasLayout } from './geometry';
import type { LayoutOptions } from './geometry-types';
import type { Board } from './model';
import { createCanvasProjection, type CanvasData } from './view-model';

export type ProjectCanvasGeometry = ReturnType<typeof canvasLayout>;

/** Geometry retains positions; presentation always uses the current Project item records. */
export function bindProjectCanvasScene(geometry: ProjectCanvasGeometry, fixture: CanvasData) {
  const items = new Map(fixture.items.map((item) => [item.id, item]));
  return {
    ...geometry,
    fixture,
    boxes: geometry.boxes.flatMap((box) => {
      const item = items.get(box.id);
      return item ? [{ ...box, item }] : [];
    }),
    panels: geometry.panels.map((panel) => ({
      ...panel,
      rows: panel.rows.flatMap((row) => {
        const item = items.get(row.item.id);
        return item ? [{ ...row, item }] : [];
      }),
    })),
  };
}

/** Owns stable Project item identities and invalidation of geometry across snapshots. */
export function createProjectCanvasScene() {
  const project = createCanvasProjection();
  let projected: { board: Board; fixture: CanvasData } | undefined;
  let previous: { key: string; geometry: ProjectCanvasGeometry } | undefined;
  return (board: Board, options: LayoutOptions) => {
    if (projected?.board !== board) projected = { board, fixture: project(board) };
    const fixture = projected.fixture;
    const key = JSON.stringify({
      items: fixture.items.map((item) => ({
        id: item.id,
        parent: item.parent,
        stage: item.stage,
        pr: item.pr,
        issueNumbers: item.issueNumbers.map((issue) => issue.number),
        thread: item.thread,
      })),
      metadata: Object.entries(fixture.metadata).map(([id, meta]) => ({
        id,
        number: meta.number,
        title: meta.title,
        labels: meta.labels.map((label) => label.name),
        labelsKnown: meta.labelsKnown,
        priority: meta.priority,
        size: meta.size,
        priorityRank: meta.priorityRank,
        sizeRank: meta.sizeRank,
        projectKnown: meta.projectKnown,
      })),
      parentIds: fixture.parentIds,
      parentOf: fixture.parentOf,
      stacks: fixture.stackSpecs,
      connections: fixture.connections,
      titleMode: options.titleMode,
      expandedNames: [...options.expandedNames].sort(),
      hoverName: options.hoverName,
      collapsed: [...(options.collapsed ?? [])].sort(),
    });
    if (previous?.key !== key) previous = { key, geometry: canvasLayout(fixture, options) };
    return {
      geometry: previous.geometry,
      layout: bindProjectCanvasScene(previous.geometry, fixture),
    };
  };
}
