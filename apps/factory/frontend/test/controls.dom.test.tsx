import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { SchedulerControls } from '../src/app';
import type { ScheduleSnapshot } from '../src/api';
const snapshot: ScheduleSnapshot = {
  state: { revision: 1, concurrency: 1, allowance: 1, paused: true, admissions: [] },
  jobs: [],
  localWork: [],
  observations: { state: 'initial', stale: true },
};
afterEach(cleanup);
it('keeps sequential keyboard entry of unlimited and positive limits until submission', async () => {
  const submitted: unknown[] = [];
  const user = userEvent.setup();
  render(
    <SchedulerControls
      snapshot={snapshot}
      pending={false}
      command={async (_path, command) => {
        submitted.push(command);
        return { state: { ...snapshot.state, revision: 2 } };
      }}
    />
  );
  const concurrency = screen.getByLabelText<HTMLInputElement>('Concurrency');
  await user.clear(concurrency);
  await user.type(concurrency, '-1');
  expect(concurrency.value).toBe('-1');
  const allowance = screen.getByLabelText<HTMLInputElement>('Distinct issue allowance');
  await user.clear(allowance);
  await user.type(allowance, '12');
  expect(allowance.value).toBe('12');
  await user.click(screen.getByRole('button', { name: 'Save scheduler controls' }));
  expect(submitted).toEqual([{ revision: 1, concurrency: -1, allowance: 12, paused: true }]);
});
it('preserves a replacement draft when the earlier save response arrives', async () => {
  const user = userEvent.setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received = false;
  render(
    <SchedulerControls
      snapshot={snapshot}
      pending={false}
      command={async () => {
        received = true;
        await gate;
        return { state: { ...snapshot.state, revision: 2, concurrency: 3 } };
      }}
    />
  );
  const field = screen.getByLabelText<HTMLInputElement>('Concurrency');
  await user.clear(field);
  await user.type(field, '3');
  await user.click(screen.getByRole('button', { name: 'Save scheduler controls' }));
  expect(received).toBe(true);
  await user.clear(field);
  await user.type(field, '4');
  await act(async () => {
    release();
    await gate;
  });
  expect(field.value).toBe('4');
  // A completed response must not quietly adopt a new base for this newer draft.
  expect(screen.getByText(/Editing revision 1/)).toBeTruthy();
});
