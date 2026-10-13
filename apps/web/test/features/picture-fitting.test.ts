import { expect, it } from 'vitest';
import { pictureAnimationFramePlan } from '../../src/features/picture-editor';

it('combines excessive frame intervals without rounding or dropping elapsed time', () => {
  expect(pictureAnimationFramePlan([20, 20, 20, 20, 20], 40)).toEqual([
    { index: 0, duration: 40 },
    { index: 2, duration: 60 },
  ]);
});

it.each([
  [[20, 20, 20], 0, [{ index: 0, duration: 20 }, { index: 1, duration: 20 }, { index: 2, duration: 20 }]],
  [[100, 200, 300], 50, [{ index: 0, duration: 100 }, { index: 1, duration: 200 }, { index: 2, duration: 300 }]],
  [[20, 30, 20, 30, 20], 40, [{ index: 0, duration: 50 }, { index: 2, duration: 70 }]],
  [[20, 20, 20, 100, 20, 20], 40, [{ index: 0, duration: 60 }, { index: 3, duration: 100 }, { index: 4, duration: 40 }]],
  [[20], 50, [{ index: 0, duration: 20 }]],
  [[20, 20], 50, [{ index: 0, duration: 20 }, { index: 1, duration: 20 }]],
  [[16777205, 20], 16777215, [{ index: 0, duration: 16777205 }, { index: 1, duration: 20 }]],
] as const)('preserves intervals %j at minimum %i', (durations, minimum, expected) => {
  expect(pictureAnimationFramePlan(durations, minimum)).toEqual(expected);
});

it.each([0, -1, 1.5, 16777216])('rejects unrepresentable source timing %s', (duration) => {
  expect(() => pictureAnimationFramePlan([duration], 40)).toThrow(/timing/);
});
