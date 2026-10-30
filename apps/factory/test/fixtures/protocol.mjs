#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const config = JSON.parse(readFileSync(process.env.FACTORY_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
appendFileSync(
  join(config.directory, 'calls.jsonl'),
  JSON.stringify({ binary: basename(process.argv[1]), args }) + '\n'
);
const mcpSend = args[0] === 'acp-mcp-call' && args[1] === 't3_thread_send';
if (mcpSend) {
  const input = JSON.parse(args[2]);
  args.splice(0, args.length, 'thread', 'send', input.threadId, input.message);
}
const flag = (name) => args[args.indexOf(name) + 1];
const reply = (value) => console.log(JSON.stringify(value));
if (basename(process.argv[1]) === 'gh') {
  if (config.githubMalformed) console.log('{}');
  else if (args[0] === 'api')
    reply(args[1]?.includes('/actions/runs/') ? config.jobs : [config.blockers ?? []]);
  else if (args[0] === 'pr' && args[1] === 'list')
    reply(
      config.prs ??
        (existsSync(join(config.directory, 'pr.json'))
          ? [JSON.parse(readFileSync(join(config.directory, 'pr.json'), 'utf8'))]
          : [])
    );
  else if (args[0] === 'pr') reply({ headRefOid: config.prHead ?? 'a'.repeat(40), state: 'OPEN' });
  else
    reply({
      number: Number(args[2]),
      state: 'OPEN',
      author: { login: 'rafaeltab' },
      url: `https://github.com/rafaeltab/wallpaperdb/issues/${args[2]}`,
      body: config.body ?? '',
      labels: [{ name: 'ready-for-agent' }],
    });
} else if (args[0] === 'acp-mcp-call') {
  if (config.mcpReply) {
    reply(config.mcpReply);
    process.exit(0);
  }
  if (config.activityPages) {
    const position = JSON.parse(args[2]).afterPosition;
    reply({ structuredContent: config.activityPages[position === undefined ? 0 : position + 1] });
    process.exit(0);
  }
  if (args[1] === 't3_thread_interrupt')
    reply({ structuredContent: { status: 'interrupt_requested', threadId: 'thread-live' } });
  else
    reply({
      structuredContent: {
        thread: {
          latestRunId: existsSync(join(config.directory, 'resource.json'))
            ? JSON.parse(readFileSync(join(config.directory, 'resource.json'), 'utf8')).latestRunId
            : null,
        },
        items: config.activity ?? [],
        hasMore: false,
        nextPosition: null,
      },
    });
} else if (args.includes('--help'))
  console.log('--worktree --model' + (config.idempotency ? ' --client-request-id' : ''));
else if (args[1] === 'start') {
  if (
    flag('--model') !== 'gpt-6.1-sol' ||
    flag('--provider') !== 'codex' ||
    args[2] !== 'project-id'
  )
    process.exit(3);
  const worktree = join(config.directory, 'worker');
  execFileSync('git', ['worktree', 'add', '-b', flag('--branch'), worktree, flag('--worktree')], {
    cwd: config.repository,
    stdio: 'pipe',
  });
  writeFileSync(
    join(config.directory, 'resource.json'),
    JSON.stringify({
      threadId: 'thread-live',
      projectId: 'project-id',
      title: flag('--title'),
      providerInstanceId: 'codex',
      model: 'gpt-6.1-sol',
      branch: flag('--branch'),
      worktreePath: worktree,
      status: config.complete ? 'completed' : 'running',
      latestRunId: 'run-1',
      runCount: 1,
      pendingRequestCount: 0,
    })
  );
  if (config.lost) process.exit(1);
  reply({ threadId: 'thread-live', projectId: 'project-id', runId: 'run-1' });
} else if (args[1] === 'send') {
  const path = join(config.directory, 'resource.json');
  const resource = JSON.parse(readFileSync(path, 'utf8'));
  const index = Number(args[3].match(/Stage (\d) of factory/)[1]);
  resource.runCount = Number(args[3].match(/expected run ordinal (\d+)/)?.[1] ?? index + 1);
  resource.stageIndex = index;
  resource.stage = args[3].includes('$babysit-pr')
    ? 'babysitting'
    : args[3].includes('$review-loop')
      ? 'review'
      : args[3].includes('$implement')
        ? 'implementation'
        : 'publication';
  resource.latestRunId = `run-${index + 1}`;
  if (index === 2 && resource.stage === 'publication') {
    const pr = {
      url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
      headRefName: resource.branch,
      baseRefName: 'main',
      headRefOid: config.base,
      baseRefOid: config.base,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      statusCheckRollup: ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map(
        (name) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })
      ),
    };
    writeFileSync(join(config.directory, 'pr.json'), JSON.stringify(pr));
    resource.pullRequests = [{ url: pr.url }];
  }
  writeFileSync(path, JSON.stringify(resource));
  if (config.lostSend || (config.lostPublication && index === 2)) process.exit(1);
  const sent = { threadId: resource.threadId, runId: resource.latestRunId };
  reply(mcpSend ? { structuredContent: sent } : sent);
} else {
  if (args[1] === 'list' && config.delayObserve) {
    writeFileSync(join(config.directory, 'observing.pid'), String(process.pid));
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  const resource = existsSync(join(config.directory, 'resource.json'))
    ? JSON.parse(readFileSync(join(config.directory, 'resource.json'), 'utf8'))
    : null;
  if (resource && args[1] === 'show') Object.assign(resource, config.overrides);
  if (config.malformed) console.log('{broken');
  else if (args[1] === 'list')
    reply(resource ? (config.duplicate ? [resource, resource] : [resource]) : []);
  else if (args[1] === 'show')
    reply({
      thread: resource ? { ...resource, ...config.overrides } : null,
      messages:
        config.waitingForGithub && resource?.stage === 'babysitting'
          ? [
              {
                role: 'assistant',
                runId: resource.latestRunId,
                text: JSON.stringify({
                  ...(resource.stage === 'babysitting'
                    ? { delivery: `${resource.title.slice(8)}:${resource.stageIndex}` }
                    : {}),
                  jobId: resource.title.slice(8),
                  stage: 'babysitting',
                  base: config.base,
                  outcome: 'WAITING_FOR_GITHUB',
                }),
              },
            ]
          : ((config.holdPublication && resource?.runCount === 3 ? [] : config.messages) ??
            (config.complete && resource
              ? [
                  {
                    role: 'assistant',
                    runId: resource.latestRunId,
                    text: JSON.stringify({
                      ...(resource.stage === 'babysitting'
                        ? { delivery: `${resource.title.slice(8)}:${resource.stageIndex}` }
                        : {}),
                      jobId: resource.title.slice(8),
                      stage:
                        resource.stage ??
                        ['implementation', 'review', 'publication'][resource.runCount - 1],
                      base: config.base,
                      commit: config.base,
                      outcome: {
                        implementation: '<TASK>COMPLETE</TASK>',
                        review: '<REVIEW>COMPLETE</REVIEW>',
                        publication: '<PR>CREATED</PR>',
                        babysitting: '<PR>READY</PR>',
                      }[resource.stage ?? 'implementation'],
                      tests: true,
                      coverage: true,
                      crap: true,
                      reviews: resource.runCount > 1,
                    }),
                  },
                ]
              : null) ?? [{ text: '<TASK>COMPLETE</TASK>', role: 'user' }]),
    });
}
