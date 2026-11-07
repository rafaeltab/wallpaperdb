import type { FactoryV2Snapshot } from '../../../../src/http/index.js';
import { scenarioBoard } from './board';

/** Three sibling dependants wrap into a second row; #461 is also a parent namespace. */
export function issueRoutingBoard(seed: FactoryV2Snapshot): FactoryV2Snapshot {
  const numbers = [250, 457, 460, 461, 462];
  return scenarioBoard(seed, {
    items: numbers.map((number) => ({
      id: number,
      stage: 'planned',
      status: 'Blocked',
      deps: number === 250 ? [] : [250],
      parent: number === 462 ? 461 : undefined,
    })),
    metadata: Object.fromEntries(
      numbers.map((number) => [
        number,
        {
          number,
          title: `Issue ${number}`,
          url: '',
          priority: null,
          size: null,
          labels: [
            { name: 'feature', color: '123456' },
            { name: 'ready-for-agent', color: '006600' },
          ],
        },
      ])
    ),
    parentIds: [461],
    parentOf: {},
    stackSpecs: [],
    synthetic: true,
  });
}
