import { execFileSync } from 'node:child_process';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { joinFixture as fixture } from './fixtures/join.js';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const comparison = (f: Fixture) =>
  JSON.parse(
    execFileSync(
      join(f.host.directory, 'gh'),
      ['pr', 'view', '104', '--json', 'headRefOid,baseRefName'],
      { cwd: f.host.repository, encoding: 'utf8' }
    )
  );
const publicationWrites = async (f: Fixture) =>
  (await f.host.calls()).filter(
    (call) =>
      (call.args[0] === 'pr' && call.args[1] === 'edit') ||
      (call.args[0] === 'api' && call.args.includes('POST')) ||
      (call.args[0] === 'issue' && call.args[1] === 'comment')
  ).length;

for (const phase of ['publication', 'validation'] as const) {
  it.each([
    'pinned-head',
    'unrelated-head',
    'untouched',
    'unrelated-worktree',
    'unavailable-git-metadata',
  ] as const)(`checks retained ownership before ancestry during ${phase}: %s`, async (change) => {
    const f = await fixture({
      conflict: true,
      restack: { outcome: 'SIMPLE' },
      ciFails: phase === 'validation',
    });
    try {
      if (!f.issues.prepare) throw new Error('Missing preparation');
      await Effect.runPromise(f.issues.prepare(5));
      const retained = f
        .git('worktree', 'list', '--porcelain')
        .split('\n')
        .find((line) => line.startsWith('worktree ') && line.includes('/replay-'))
        ?.slice(9);
      if (!retained) throw new Error('Missing automatic worktree');
      if (phase === 'publication') {
        // Refuse the isolated remote update after the agent's resolution has
        // been accepted. This leaves publication pending without a private seam.
        const hook = join(f.host.repository, '.git', 'hooks', 'pre-push');
        await writeFile(hook, '#!/bin/sh\nexit 1\n');
        await chmod(hook, 0o700);
        await expect(Effect.runPromise(f.issues.prepare(5))).rejects.toMatchObject({
          _tag: 'Unavailable',
        });
        await unlink(hook);
      } else {
        await Effect.runPromise(f.issues.prepare(5));
      }
      expect((await Effect.runPromise(f.issues.inspect(5))).blockersReady).toBe(false);
      expect(
        (await f.host.calls()).filter(
          (call) => call.args[1] === 'start' && call.args.includes('--title')
        )
      ).toHaveLength(1);
      const before = comparison(f);
      expect(before.baseRefName).toBe(phase === 'publication' ? 'A' : 'D');
      if (phase === 'publication') expect(before.headRefOid).toBe(f.c);
      const writesBefore = await publicationWrites(f);

      if (change === 'pinned-head' || change === 'unavailable-git-metadata')
        f.git('-C', retained, 'update-ref', '--no-deref', 'HEAD', f.host.base);
      if (change === 'unrelated-head') {
        f.git('branch', 'operator-unrelated', f.host.base);
        f.git('-C', retained, 'symbolic-ref', 'HEAD', 'refs/heads/operator-unrelated');
      }
      const blocked = !['untouched', 'unrelated-worktree'].includes(change);
      if (blocked)
        await writeFile(join(retained, 'operator.txt'), 'preserve retained operator changes');
      if (change === 'unavailable-git-metadata')
        await rename(join(retained, '.git'), join(retained, '.git.unavailable'));
      const unrelated = join(dirname(retained), 'operator-unrelated');
      if (change === 'unrelated-worktree') {
        // A different path in the same operation directory is not the retained
        // automatic worktree, even while it has unrelated pending edits.
        f.git('worktree', 'add', '--detach', unrelated, f.host.base);
        await writeFile(join(unrelated, 'operator.txt'), 'unrelated pending edits');
      }
      if (phase === 'validation') {
        const path = join(f.host.directory, 'join-live.json');
        const live = JSON.parse(await readFile(path, 'utf8'));
        live.newCI = 'SUCCESS';
        await writeFile(path, JSON.stringify(live));
      }
      const issues = f.reopen();
      if (!issues.prepare || !issues.recoveries) throw new Error('Missing resumed ports');
      if (change === 'unavailable-git-metadata')
        await expect(Effect.runPromise(issues.prepare(5))).rejects.toMatchObject({
          _tag: 'Unavailable',
        });
      else await Effect.runPromise(issues.prepare(5));
      const observed = await Effect.runPromise(issues.inspect(5));
      expect(observed.blockersReady).toBe(!blocked);
      const after = comparison(f);
      if (blocked) {
        expect(after.headRefOid).toBe(before.headRefOid);
        expect(after.baseRefName).toBe(phase === 'publication' ? 'A' : 'D');
        expect(await publicationWrites(f)).toBe(writesBefore);
        expect(await readFile(join(retained, 'operator.txt'), 'utf8')).toBe(
          'preserve retained operator changes'
        );
        if (change !== 'unavailable-git-metadata')
          expect(await Effect.runPromise(issues.recoveries())).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                active: false,
                progress: expect.stringContaining('Retained automatic conflict worktree changed'),
              }),
            ])
          );
      } else {
        expect(observed.prerequisite?.prBase).toBe('C');
        expect(after.baseRefName).toBe('D');
        if (change === 'unrelated-worktree')
          expect(await readFile(join(unrelated, 'operator.txt'), 'utf8')).toBe(
            'unrelated pending edits'
          );
      }
    } finally {
      await f.close();
    }
  });
}
