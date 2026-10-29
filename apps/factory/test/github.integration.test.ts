import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import { protocol } from './fixtures/setup.js';
it('translates external issue observations and rejects unverified or malformed dependency evidence', async () => {
  const host = await protocol();
  const path = process.env.PATH;
  const fixture = process.env.FACTORY_FIXTURE;
  process.env.PATH = host.directory + ':' + path;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const adapter = githubIssues({ project: host.repository, base: host.base, prerequisites: [] });
    expect(await Effect.runPromise(adapter.inspect(576))).toEqual({
      open: true,
      author: 'rafaeltab',
      labels: ['ready-for-agent'],
      blockersReady: true,
      url: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
    });
    await host.save({ blockers: [{ number: 573, state: 'open' }] });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    await host.save({ body: '## Blocked by\nhttps://github.com/rafaeltab/wallpaperdb/issues/573' });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    for (const body of ['Blocked by: #573', '## Blocked by\n- #573', 'Blocked by: #573, #574']) {
      await host.save({ body });
      expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: false });
    }
    await host.save({ body: 'Parent: #573' });
    expect(await Effect.runPromise(adapter.inspect(576))).toMatchObject({ blockersReady: true });
    const verified = githubIssues({
      project: host.repository,
      base: host.base,
      prerequisites: [{ issue: 573, pr: 591, commit: host.base }],
    });
    await host.save({ blockers: [{ number: 573, state: 'open' }], prHead: host.base });
    expect(await Effect.runPromise(verified.inspect(576))).toMatchObject({ blockersReady: true });
    await host.save({ blockers: [{ number: 573, state: 'open' }], prHead: 'b'.repeat(40) });
    expect(await Effect.runPromise(verified.inspect(576))).toMatchObject({ blockersReady: false });
    await host.save({ githubMalformed: true });
    await expect(Effect.runPromise(adapter.inspect(576))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
  } finally {
    process.env.PATH = path;
    if (fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = fixture;
    await host.cleanup();
  }
});
