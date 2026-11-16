import { stageHeadingWidth, type canvasLayout } from './geometry';
import { routeCanvas, type Edge, type Rect } from './routing';

/** Ordered geometry only. Earlier links affect the paths chosen for later links. */
export type ItemDependencyLinkInput = {
  nodes: Rect[];
  edges: Edge[];
  width: number;
  height: number;
};
export type ItemDependencyLink = ReturnType<typeof routeCanvas>[number];

export function createItemDependencyLinkInput(
  layout: ReturnType<typeof canvasLayout>
): ItemDependencyLinkInput {
  const nodes: Rect[] = [
    ...layout.boxes,
    ...layout.headerNodes,
    ...layout.aggregateNodes,
    ...layout.groups
      .filter((group) => !group.parent)
      .map((group, index) => ({
        id: -4_000_000 - index,
        x: group.x,
        y: group.y,
        width: group.collapsed ? group.headingWidth : group.width,
        height: group.head,
      })),
    ...layout.panels.map((panel, index) => ({
      id: -500 - index,
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: 32,
    })),
    ...layout.areas.map((area, index) => ({
      id: -100 - index,
      x: 20,
      y: area.y - 10,
      width: stageHeadingWidth,
      height: 20,
    })),
    ...[...layout.groups, ...layout.panels].flatMap((group, index) =>
      [
        [group.x, group.y],
        [group.x + group.width, group.y],
        [group.x, group.y + group.height],
        [group.x + group.width, group.y + group.height],
      ].map(([x, y], corner) => ({
        id: -1000 - index * 4 - corner,
        x,
        y,
        width: 0,
        height: 0,
      }))
    ),
  ];
  return {
    // Box includes the full Project item; it must not cross the worker seam.
    nodes: nodes.map(({ id, x, y, width, height, stacked, header, bottomPort }) => ({
      id,
      x,
      y,
      width,
      height,
      stacked,
      header,
      bottomPort: bottomPort ? { ...bottomPort } : undefined,
    })),
    edges: layout.routingConnections.map(({ source, target }) => ({ source, target })),
    width: layout.width,
    height: layout.height,
  };
}

export function computeItemDependencyLinks(input: ItemDependencyLinkInput): ItemDependencyLink[] {
  return routeCanvas(input.nodes, input.edges, input.width, input.height);
}
