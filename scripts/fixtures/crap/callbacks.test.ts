import { expect, test } from 'vitest';
import * as Effect from 'effect/Effect';
import {
  branchedFactory,
  branchlessFactory,
  called,
  calledEffect,
  completedGenerator,
  constructedEffect,
  idleEntries,
  idleGenerator,
  namedDecision,
  partialGenerator,
  sameLine,
} from './callbacks';

test('construct callbacks and effects, then execute only selected bodies', () => {
  expect(branchedFactory(1)).toBeTypeOf('function');
  expect(branchlessFactory()).toBeTypeOf('function');
  expect(called(1)).toBe(2);
  expect(sameLine(1)).toBeTypeOf('function');
  expect(constructedEffect).toBeDefined();
  expect(Effect.runSync(calledEffect(1))).toBe(1);
  expect(idleGenerator(1)).toBeDefined();
  expect(idleEntries).toBe(0);
  expect(partialGenerator(1).next()).toEqual({ done: false, value: 1 });
  expect(Array.from(completedGenerator(1))).toEqual([1, 2]);
  expect(namedDecision(1)).toBe(1);
});
