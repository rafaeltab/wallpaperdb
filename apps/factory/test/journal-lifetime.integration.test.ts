import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { joinFixture } from './fixtures/join.js';

it.each(['interrupted', 'idle'] as const)(
  'settles an %s native journal write before composition close releases its state directory',
  async (mode) => {
    const f = await joinFixture({ conflict: true, restack: { outcome: 'SIMPLE' } });
    const original = fs.promises.mkdtemp;
    const interception = vi.spyOn(fs.promises, 'mkdtemp');
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let armed = true;
    let running: Awaited<ReturnType<typeof startFactory>> | undefined;
    try {
      await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
      const owning = `${f.host.directory}/owning-C`;
      f.git('worktree', 'add', owning, 'C');
      await fs.promises.writeFile(`${owning}/writer.txt`, 'retained uncommitted work');
      await Effect.runPromise(
        fileScheduleStore(f.host.directory).save({
          revision: 0,
          concurrency: 1,
          allowance: 1,
          paused: true,
          admissions: [],
        })
      );
      // Gate the real native operation, not an application helper or synthetic scheduler.
      interception.mockImplementation(async (...args) => {
        if (armed && String(args[0]).startsWith(`${f.host.directory}/joins/`)) {
          armed = false;
          entered();
          await held;
        }
        return original(...args);
      });
      syncBuiltinESMExports();
      running = await startFactory({
        FACTORY_PROJECT: f.host.repository,
        FACTORY_T3_PROJECT_ID: 'project-id',
        FACTORY_BASE: f.host.base,
        FACTORY_T3_BINARY: f.host.binary,
        FACTORY_STATE: f.host.directory,
        FACTORY_PORT: '0',
      });
      if (mode === 'interrupted')
        await Promise.race([
          writing,
          delay(10000).then(() => {
            throw new Error('Journal write not reached');
          }),
        ]);
      else expect((await running.app.inject('/health')).statusCode).toBe(200);
      const closing = running.close();
      if (mode === 'interrupted') {
        expect(
          await Promise.race([closing.then(() => 'closed'), delay(100).then(() => 'pending')])
        ).toBe('pending');
        release();
      }
      await closing;
      expect(
        (await f.host.calls()).filter(
          (call) =>
            call.binary === 't3' &&
            ['start', 'send'].includes(call.args[1]) &&
            !call.args.includes('--help')
        )
      ).toEqual([]);
    } catch (error) {
      process.stdout.write(`Journal lifetime ${mode} body failure: ${String(error)}\n`);
      throw error;
    } finally {
      release();
      await running?.close();
      interception.mockRestore();
      syncBuiltinESMExports();
      await f.close();
    }
  }
);
