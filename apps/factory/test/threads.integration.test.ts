import { threadStoreContract } from './fixtures/thread-store-contract.js';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { t3Metadata } from '../src/adapters/t3/index.js';
import { sqliteThreads } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
it('translates the installed metadata-only MCP contract, paginates and persists only allowed metadata across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-threads-'));
  try {
    const binary = join(directory, 't3');
    await writeFile(join(directory, 'auth'), 'controlled-only', { mode: 0o600 });
    await writeFile(
      binary,
      `#!/usr/bin/env node
const [command,tool,input] = process.argv.slice(2);
if(command !== 'acp-mcp-call') process.exit(1);
const args = JSON.parse(input);
let value;
if(tool === 't3_environment_read') value = {environmentId:'installed-environment',preferences:{secret:'must not persist'}};
else if(tool === 't3_thread_list' && args.projectId === 'project' && args.includeSubagents === false && args.limit === 100) value = args.cursor === 0 ? {threads:[{threadId:'mcp:t/1',title:'Issue648 is not evidence',status:'running',createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-06T00:00:00.000Z',pullRequests:[{repository:'rafaeltab/wallpaperdb',number:672,url:'https://github.com/rafaeltab/wallpaperdb/pull/672'}],conversation:'do not persist'}],nextCursor:1} : {threads:[{threadId:'legacy',title:'Older incomplete metadata',status:'idle',linkedPullRequest:null}],nextCursor:null};
else process.exit(2);
console.log(JSON.stringify({structuredContent:value}));
`
    );
    await chmod(binary, 0o700);
    const source = t3Metadata({
      binary,
      project: directory,
      projectId: 'project',
      mcpEndpoint: 'http://127.0.0.1:1/mcp',
      mcpAuthorizationFile: join(directory, 'auth'),
    });
    const facts = await Effect.runPromise(source.read());
    expect(facts).toEqual({
      environmentId: 'installed-environment',
      projectId: 'project',
      threads: [
        {
          threadId: 'mcp:t/1',
          title: 'Issue648 is not evidence',
          status: 'running',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-06T00:00:00.000Z',
          branch: null,
          worktree: null,
          pullRequests: [
            {
              repository: 'rafaeltab/wallpaperdb',
              number: 672,
              url: 'https://github.com/rafaeltab/wallpaperdb/pull/672',
            },
          ],
        },
        {
          threadId: 'legacy',
          title: 'Older incomplete metadata',
          status: 'idle',
          branch: null,
          worktree: null,
          createdAt: null,
          updatedAt: null,
          pullRequests: [],
        },
      ],
    });
    initializeState(directory);
    await Effect.runPromise(sqliteThreads(directory).save({ observedAt: 10, facts }));
    expect(await Effect.runPromise(sqliteThreads(directory).read())).toEqual({
      observedAt: 10,
      facts,
    });
    await writeFile(
      binary,
      "#!/usr/bin/env node\nconsole.log(JSON.stringify({structuredContent:process.argv[3] === 't3_environment_read' ? {environmentId:'e'} : {threads:[],nextCursor:0}}));"
    );
    expect((await Effect.runPromise(Effect.exit(source.read())))._tag).toBe('Failure');
    expect(await Effect.runPromise(sqliteThreads(directory).read())).toEqual({
      observedAt: 10,
      facts,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

threadStoreContract('SQLite T3 metadata store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-thread-contract-'));
  initializeState(directory);
  return {
    store: sqliteThreads(directory),
    close: () => rm(directory, { recursive: true, force: true }),
  };
});
