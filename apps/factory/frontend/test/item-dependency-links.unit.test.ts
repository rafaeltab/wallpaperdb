import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeItemDependencyLinks,
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
