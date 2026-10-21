import { describe, it } from 'vitest';
import { controlledProfiles } from '../helpers/profiles.js';
import { cases, type Fixture } from './contract.js';

function controlledFixture(): Fixture {
  const controlled = controlledProfiles();
  return {
    store: controlled.store,
    occurrences: async () => controlled.transitions.length,
    dispose: async () => {},
  };
}

describe('existing capability controlled adapter', () => {
  for (const test of cases)
    it(test.id, async () => {
      const fixture = controlledFixture();
      try {
        await test.check(fixture);
      } finally {
        await fixture.dispose();
      }
    });
});
