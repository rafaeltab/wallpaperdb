import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { fakeV2Server, type FactoryV2Snapshot } from '../../src/http/index.js';
import { FactoryApp } from '../src/canvas/app';
import { FactoryClient } from '../src/canvas/client';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('requires an explicit seen acknowledgement for the displayed failures and keeps resume separate', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const app = fakeV2Server({ epoch: 'notices' });
  const sample = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
  await app.close();
  const actionId = `action:acknowledge-planning-failures/${sample.meta.factory.id}` as const;
  const failure = {
    attemptId: 'attempt-1',
    code: 'model-deadline' as const,
    message: 'Automatic planning did not complete within its model deadline.',
    attemptStartedAt: '2026-11-08T12:00:00.000Z',
    modelHandedOffAt: '2026-11-08T12:03:00.000Z',
    deadline: '2026-11-08T12:13:00.000Z',
    failedAt: '2026-11-08T12:14:00.000Z',
    attemptElapsedMs: 840000,
    modelElapsedMs: 660000,
    threadId: null,
    runId: 'exact-run',
  };
  let board: FactoryV2Snapshot = {
    ...sample,
    meta: {
      ...sample.meta,
      factory: {
        ...sample.meta.factory,
        paused: true,
        actionIds: [...sample.meta.factory.actionIds, actionId],
        planning: {
          maximumAttempts: 3,
          consecutiveModelDeadlineFailures: 3,
          pendingNoticeCount: 2,
          notice: {
            id: 'planning-notice:first',
            version: 'first-v1',
            createdAt: failure.failedAt,
            acknowledgedAt: null,
            failures: [failure],
          },
        },
      },
    },
    entities: {
      ...sample.entities,
      actions: {
        ...sample.entities.actions,
        [actionId]: {
          id: actionId,
          version: 'first-action',
          kind: 'acknowledge-planning-failures',
          targetId: sample.meta.factory.id,
          availability: { state: 'available', precondition: 'exact-first-rows', validUntil: null },
        },
      },
    },
  };
  const posted: unknown[] = [];
  const client = new FactoryClient(async (_path, init) => {
    if (init?.method === 'POST') {
      const command = JSON.parse(String(init.body));
      posted.push(command);
      const notice = board.meta.factory.planning.notice!;
      const next =
        posted.length === 1
          ? {
              ...notice,
              id: 'planning-notice:second' as const,
              version: 'second-v1',
              failures: [{ ...failure, attemptId: 'attempt-2' }],
            }
          : { ...notice, version: 'second-seen', acknowledgedAt: '2026-11-08T13:00:00.000Z' };
      board = {
        ...board,
        meta: {
          ...board.meta,
          factory: {
            ...board.meta.factory,
            planning: {
              ...board.meta.factory.planning,
              pendingNoticeCount: 2 - posted.length,
              notice: next,
            },
          },
        },
        entities: {
          ...board.entities,
          actions: {
            ...board.entities.actions,
            [actionId]: {
              ...board.entities.actions[actionId],
              availability: {
                state: 'available',
                precondition: 'exact-second-rows',
                validUntil: null,
              },
            },
          },
        },
      };
      return new Response(
        JSON.stringify({
          commandId: command.commandId,
          state: 'succeeded',
          version: 'done',
          actionId,
          acceptedAt: failure.failedAt,
          completedAt: failure.failedAt,
          reasons: [],
          result: null,
          resultingCursor: null,
        })
      );
    }
    return new Response(JSON.stringify(board));
  });
  const user = userEvent.setup();
  render(<FactoryApp client={client} />);
  await screen.findByRole('heading', { name: 'Planning needs attention' });
  expect(screen.getByText(/2 pending planning failure notices/)).toBeTruthy();
  expect(screen.getByText(/Model elapsed: 660.0 seconds/)).toBeTruthy();
  expect(screen.getByText(/Attempt elapsed: 840.0 seconds/)).toBeTruthy();
  expect(screen.getByText(/2026-11-08T12:03:00.000Z/)).toBeTruthy();
  expect(posted).toHaveLength(0);
  const resume = screen.getByRole<HTMLButtonElement>('button', { name: /Resume/ });
  expect(resume.disabled).toBe(true);
  const acknowledge = screen.getByRole('button', { name: 'Acknowledge seen' });
  await user.click(acknowledge);
  await waitFor(() => expect(screen.queryByText(/2 pending planning failure notices/)).toBeNull());
  expect(posted[0]).toMatchObject({
    kind: 'acknowledge-planning-failures',
    precondition: 'exact-first-rows',
    payload: {},
  });
  expect(document.activeElement).toBe(acknowledge);
  await user.click(screen.getByRole('button', { name: 'Acknowledge seen' }));
  await screen.findByRole('heading', { name: 'Seen planning failures' });
  expect(screen.getByText('Inspect seen failure details')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /Resume/ }).disabled).toBe(false);
  expect(posted).toHaveLength(2);
  expect(posted[1]).toMatchObject({
    kind: 'acknowledge-planning-failures',
    precondition: 'exact-second-rows',
  });
});
