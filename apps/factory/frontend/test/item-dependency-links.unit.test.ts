import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeItemDependencyLinks,
  createItemDependencyLinkRouter,
  type ItemDependencyLinkInput,
  type ItemDependencyLink,
} from '../src/canvas/item-dependency-links';
import { projectCanvasLinkScenarios } from './fixtures/canvas/project-canvas-links';

it('preserves a missing Project item dependency endpoint without inventing a link', () => {
  expect(
    computeItemDependencyLinks({
      nodes: [],
      edges: [{ source: 1, target: 2 }],
      width: 100,
      height: 100,
    })
  ).toEqual([]);
});

const goldens: { name: string; input: ItemDependencyLinkInput; links: ItemDependencyLink[] }[] =
  JSON.parse(
    readFileSync(new URL('./fixtures/canvas/item-dependency-links.json', import.meta.url), 'utf8')
  );

it.each(goldens)(
  'preserves exact Project canvas dependency-link geometry for $name',
  ({ input, links }) => {
    expect(computeItemDependencyLinks(input)).toEqual(links);
  },
  // Coverage instrumentation makes the 300-item correctness fixtures exceed the
  // default five seconds. Performance comparisons live in the benchmark command.
  30000
);

it('assembles the same compact geometry for production, tests and the worker', () => {
  expect(JSON.parse(JSON.stringify(projectCanvasLinkScenarios()))).toEqual(
    goldens.map(({ name, input }) => ({ name, input }))
  );
});

it('leaves Project canvas input geometry unchanged while computing links', () => {
  const fixture = goldens.find((golden) => golden.name === 'varied-ellipsis');
  if (!fixture) throw new Error('Missing varied Project canvas fixture');
  const input = structuredClone(fixture.input);
  for (const node of input.nodes) {
    if (node.bottomPort) Object.freeze(node.bottomPort);
    Object.freeze(node);
  }
  for (const edge of input.edges) Object.freeze(edge);
  Object.freeze(input.nodes);
  Object.freeze(input.edges);
  Object.freeze(input);
  expect(computeItemDependencyLinks(input)).toEqual(fixture.links);
  expect(input).toEqual(fixture.input);
});

const separated: ItemDependencyLinkInput = {
  nodes: [
    { id: 1, x: 400, y: 60, width: 100, height: 60 },
    { id: 2, x: 60, y: 60, width: 100, height: 60 },
    { id: 3, x: 400, y: 1400, width: 100, height: 60 },
    { id: 4, x: 60, y: 1400, width: 100, height: 60 },
    { id: 5, x: 1000, y: 1400, width: 100, height: 60 },
  ],
  edges: [
    { source: 1, target: 2 },
    { source: 3, target: 4 },
  ],
  width: 1800,
  height: 2000,
};

it('publishes each finished dependency link in the existing routing order', () => {
  const route = createItemDependencyLinkRouter();
  const progress = route(separated);
  const first = progress.next();
  expect(first.done).toBe(false);
  expect(first.value).toMatchObject({ source: 1, target: 2 });
  const second = progress.next();
  expect(second.done).toBe(false);
  expect(second.value).toMatchObject({ source: 3, target: 4 });
  expect(progress.next().done).toBe(true);
  expect([first.value, second.value]).toEqual(computeItemDependencyLinks(separated));
});

it('retains an unaffected link across distant geometry changes without rerouting it', () => {
  const route = createItemDependencyLinkRouter();
  const before = [...route(separated)];
  const changed = {
    ...separated,
    nodes: separated.nodes.map((node) => (node.id === 5 ? { ...node, x: 1200 } : node)),
  };
  const after = [...route(changed)];
  expect(after[0]).toBe(before[0]);
  expect(after).toEqual(computeItemDependencyLinks(changed));
});

it('does not reuse a link when nearby geometry can change its search axes', () => {
  const route = createItemDependencyLinkRouter();
  const before = [...route(separated)];
  const changed = {
    ...separated,
    nodes: [...separated.nodes, { id: 6, x: 240, y: 40, width: 60, height: 100 }],
  };
  const after = [...route(changed)];
  expect(after[0]).not.toBe(before[0]);
  expect(after).toEqual(computeItemDependencyLinks(changed));
});

it('invalidates ordered labels and colors when dependency order changes', () => {
  const route = createItemDependencyLinkRouter();
  const before = [...route(separated)];
  const changed = { ...separated, edges: [...separated.edges].reverse() };
  const after = [...route(changed)];
  expect(after[0]).not.toBe(before[1]);
  expect(after[1]).not.toBe(before[0]);
  expect(after).toEqual(computeItemDependencyLinks(changed));
});

it('retains a later unaffected route even when an earlier distant route changes', () => {
  const route = createItemDependencyLinkRouter();
  const before = [...route(separated)];
  const changed = {
    ...separated,
    nodes: separated.nodes.map((node) => (node.id === 1 ? { ...node, x: 420 } : node)),
  };
  const after = [...route(changed)];
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after).toEqual(computeItemDependencyLinks(changed));
});

it('invalidates a shared source fan when a future dependency changes its terminal', () => {
  const route = createItemDependencyLinkRouter();
  const before = [...route(separated)];
  const changed = { ...separated, edges: [...separated.edges, { source: 1, target: 4 }] };
  const after = [...route(changed)];
  expect(after[0]).not.toBe(before[0]);
  expect(after[0].points[0]).not.toEqual(before[0].points[0]);
  expect(after).toEqual(computeItemDependencyLinks(changed));
});

it('validates failed search windows before reusing a fallback link', () => {
  const route = createItemDependencyLinkRouter();
  const input: ItemDependencyLinkInput = {
    ...separated,
    edges: separated.edges.slice(0, 1),
    nodes: [...separated.nodes, { id: 6, x: 0, y: 0, width: 1000, height: 1000 }],
  };
  const before = [...route(input)];
  expect(before[0].failed).toBe(true);
  const changed = {
    ...input,
    nodes: [...input.nodes, { id: 7, x: 900, y: 20, width: 10, height: 10 }],
  };
  const after = [...route(changed)];
  expect(after[0]).not.toBe(before[0]);
  expect(after).toEqual(computeItemDependencyLinks(changed));
});

it.each(goldens)(
  'reuses exactly the validated links in a repeated $name scene',
  ({ input, links }) => {
    const route = createItemDependencyLinkRouter();
    const first = [...route(input)];
    const repeat = [...route(structuredClone(input))];
    expect(first).toEqual(links);
    expect(repeat).toEqual(links);
    repeat.forEach((link, index) => {
      expect(link).toBe(first[index]);
    });
  },
  30000
);
