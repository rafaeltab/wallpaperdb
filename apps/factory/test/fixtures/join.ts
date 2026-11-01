import { execFileSync } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { githubIssues } from '../../src/adapters/github/index.js';
import { protocol } from './setup.js';
export async function joinFixture(
  options: {
    conflict?: boolean;
    context?: string;
    owningThreadId?: string;
    restack?: {
      loseLaunch?: boolean;
      repair?: boolean;
      staleRun?: boolean;
      mcp?: boolean;
      outcome?: 'SIMPLE' | 'COMPLEX';
      review?: boolean;
      stale?: boolean;
      question?: string;
    };
    substantial?: boolean;
    duplicate?: boolean;
    multiple?: boolean;
    cCommits?: number;
    reverse?: boolean;
    groups?: boolean;
    descendant?: boolean;
    merge?: boolean;
    writer?: boolean | 'completed';
    owningWorktree?: 'clean' | 'dirty';
    ciFails?: boolean;
    lose?: 'base' | 'group' | 'evidence';
    staleHead?: boolean;
    corruptGrouping?: boolean;
  } = {}
) {
  const host = await protocol();
  const previous = process.env.PATH;
  const fixture = process.env.FACTORY_FIXTURE;
  process.env.PATH = `${host.directory}:${previous}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
  const commit = async (name: string) => {
    await writeFile(
      join(
        host.repository,
        (options.conflict || options.duplicate) && ['D', 'C'].includes(name)
          ? 'shared.txt'
          : `${name}.txt`
      ),
      options.duplicate && ['D', 'C'].includes(name)
        ? 'same'
        : options.substantial && ['D', 'C'].includes(name)
          ? `export const behavior = () => '${name}';`
          : name
    );
    git('add', '.');
    git('commit', '-m', name);
    return git('rev-parse', 'HEAD');
  };
  const rootBranch = git('branch', '--show-current');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  execFileSync('git', ['init', '--bare', join(host.directory, 'remote.git')]);
  git('remote', 'add', 'origin', join(host.directory, 'remote.git'));
  git('switch', '-c', 'A');
  const a = await commit('A');
  git('switch', '-c', 'B');
  const b = await commit('B');
  git('switch', '-c', 'D');
  let d = await commit('D');
  if (options.merge) {
    git('switch', '-c', 'side', a);
    await commit('M');
    git('switch', 'D');
    git('merge', '--no-ff', 'side', '-m', 'merge');
    d = git('rev-parse', 'HEAD');
  }
  git('switch', '-c', 'C', a);
  let c = await commit('C');
  for (let index = 2; index <= (options.cCommits ?? (options.multiple ? 2 : 1)); index++)
    c = await commit(`C${index}`);
  git('push', 'origin', 'A', 'B', 'C', 'D');
  if (options.descendant) git('branch', 'F', c);
  git('switch', '--detach', host.base);
  if (options.owningWorktree) {
    const path = join(host.directory, 'owning-C');
    git('worktree', 'add', path, 'C');
    if (options.owningWorktree === 'dirty')
      await writeFile(join(path, 'C.txt'), 'uncommitted writer change');
  }
  if (options.staleHead) {
    const hook = join(host.repository, '.git', 'hooks', 'pre-push');
    await writeFile(
      hook,
      `#!/bin/sh
git --git-dir='${join(host.directory, 'remote.git')}' update-ref refs/heads/C ${d}
`
    );
    await chmod(hook, 0o700);
  }
  await host.save({
    lost: false,
    restack: options.restack,
    joinWriter: options.descendant ? true : options.writer,
    joinWriterBranch: options.descendant ? 'F' : 'C',
    join: {
      lose: options.lose,
      blockers: options.reverse
        ? [
            { number: 4, state: 'open' },
            { number: 3, state: 'open' },
          ]
        : undefined,
      originalHeads: { 101: a, 102: b, 103: d, 104: c },
      groups: options.groups
        ? [
            { number: 9, pull_requests: [{ number: 101 }, { number: 104 }] },
            { number: 10, pull_requests: [{ number: 102 }, { number: 103 }] },
          ]
        : undefined,
      newCI: options.ciFails ? 'FAILURE' : 'SUCCESS',
      corruptGrouping: options.corruptGrouping,
      evidence: `https://github.com/rafaeltab/wallpaperdb/pull/103 ${d}\nhttps://github.com/rafaeltab/wallpaperdb/pull/104 ${c}`,
      prs: {
        101: { branch: 'A', base: rootBranch },
        102: { branch: 'B', base: 'A' },
        103: { branch: 'D', base: 'B' },
        104: { branch: 'C', base: 'A' },
      },
      members: [101, 102, 103].map(
        (number) => `https://github.com/rafaeltab/wallpaperdb/pull/${number}`
      ),
    },
  });
  await writeFile(join(host.directory, 'mcp-auth'), 'controlled-protocol');
  const mcp = options.restack?.mcp
    ? {
        mcpEndpoint: 'http://controlled.invalid/mcp',
        mcpAuthorizationFile: join(host.directory, 'mcp-auth'),
      }
    : {};
  const issues = githubIssues({
    project: host.repository,
    base: host.base,
    prerequisites: [
      { issue: 3, pr: 103, commit: d },
      {
        issue: 4,
        pr: 104,
        commit: c,
        context: options.context,
        owningThreadId: options.owningThreadId,
      },
    ],
    joins: {
      directory: join(host.directory, 'joins'),
      binary: host.binary,
      projectId: 'project-id',
      ...mcp,
    },
  });
  return {
    host,
    git,
    d,
    c,
    issues,
    reopen: () =>
      githubIssues({
        project: host.repository,
        base: host.base,
        prerequisites: [
          { issue: 3, pr: 103, commit: d },
          {
            issue: 4,
            pr: 104,
            commit: c,
            context: options.context,
            owningThreadId: options.owningThreadId,
          },
        ],
        joins: {
          directory: join(host.directory, 'joins'),
          binary: host.binary,
          projectId: 'project-id',
          ...mcp,
        },
      }),
    close: async () => {
      process.env.PATH = previous;
      if (fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = fixture;
      await host.cleanup();
    },
  };
}
