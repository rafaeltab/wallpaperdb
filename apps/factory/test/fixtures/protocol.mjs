#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const config = JSON.parse(readFileSync(process.env.FACTORY_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
appendFileSync(
  join(config.directory, 'calls.jsonl'),
  JSON.stringify({ binary: basename(process.argv[1]), args }) + '\n'
);
if (config.joinWriter && basename(process.argv[1]) === 't3') {
  console.log(
    JSON.stringify(
      args[1] === 'list'
        ? [{ threadId: 'writer-C' }]
        : {
            thread: {
              projectId: 'project-id',
              branch: config.joinWriterBranch ?? 'C',
              status: config.joinWriter === 'completed' ? 'completed' : 'running',
              pendingRequestCount: 0,
            },
          }
    )
  );
  process.exit(0);
}
if (config.join && basename(process.argv[1]) === 'gh') {
  const statePath = join(config.directory, 'join-live.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : config.join;
  const number =
    args[0] === 'pr' && args[1] === 'list'
      ? Number(
          Object.entries(state.prs).find(
            ([, value]) => value.branch === args[args.indexOf('--head') + 1]
          )?.[0]
        )
      : Number(args[2]);
  const flag = (name) => args[args.indexOf(name) + 1];
  const git = (...values) =>
    execFileSync('git', ['-C', config.repository, ...values], { encoding: 'utf8' }).trim();
  let result = {};
  if (args[0] === 'issue' && args[1] === 'view')
    result = {
      number,
      state: 'OPEN',
      author: { login: 'rafaeltab' },
      url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
      labels: [{ name: 'ready-for-agent' }],
      body: state.evidence,
    };
  else if (args[0] === 'issue' && args[1] === 'comment') state.evidence += '\n' + flag('--body');
  else if (args[0] === 'api' && args[1].includes('dependencies'))
    result = [
      state.blockers ?? [
        { number: 3, state: 'open' },
        { number: 4, state: 'open' },
      ],
    ];
  else if (args[0] === 'pr' && ['view', 'list'].includes(args[1])) {
    const item = state.prs[String(number)];
    const head = git('ls-remote', '--heads', 'origin', `refs/heads/${item.branch}`).split(/\s/)[0];
    result = {
      url: `https://github.com/rafaeltab/wallpaperdb/pull/${number}`,
      headRefOid: head,
      headRefName: item.branch,
      baseRefName: item.base,
      baseRefOid: git('rev-parse', item.base),
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      statusCheckRollup: ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map(
        (name) => ({
          name,
          status: 'COMPLETED',
          conclusion:
            head === state.originalHeads?.[String(number)] ? 'SUCCESS' : (state.newCI ?? 'SUCCESS'),
        })
      ),
    };
    if (args[1] === 'list') result = [result];
  } else if (args[0] === 'pr' && args[1] === 'edit')
    state.prs[String(number)].base = flag('--base');
  else if (
    args[0] === 'api' &&
    args.includes('POST') &&
    args.includes('repos/rafaeltab/wallpaperdb/stacks')
  ) {
    state.members = state.corruptGrouping
      ? []
      : args
          .filter((value) => value.startsWith('pull_requests[]='))
          .map((value) => `https://github.com/rafaeltab/wallpaperdb/pull/${value.split('=')[1]}`);
    state.groups = state.members.length
      ? [
          {
            number: 900,
            pull_requests: state.members.map((url) => ({ number: Number(url.split('/').at(-1)) })),
          },
        ]
      : [];
  } else if (args[0] === 'api' && args.includes('POST')) {
    const path = args.find((value) => value.includes('/unstack'));
    const number = Number(path.split('/').at(-2));
    if (state.groups) state.groups = state.groups.filter((group) => group.number !== number);
    else state.members = [];
  } else if (args[0] === 'api' && args[1].includes('/stacks')) {
    const groups =
      state.groups ??
      (state.members.length
        ? [
            {
              number: 9,
              pull_requests: state.members.map((url) => ({
                number: Number(url.split('/').at(-1)),
              })),
            },
          ]
        : []);
    const requested = Number(args[1].match(/pull_request=(\d+)/)?.[1]);
    result = groups.filter((group) => group.pull_requests.some((pr) => pr.number === requested));
  }
  const boundary =
    args.includes('repos/rafaeltab/wallpaperdb/stacks') && args.includes('POST')
      ? 'group'
      : args[0] === 'pr' && args[1] === 'edit'
        ? 'base'
        : args[0] === 'issue' && args[1] === 'comment'
          ? 'evidence'
          : null;
  if (state.lose === boundary && boundary) {
    state.lose = null;
    writeFileSync(statePath, JSON.stringify(state));
    process.exit(1);
  }
  writeFileSync(statePath, JSON.stringify(state));
  console.log(JSON.stringify(result));
  process.exit(0);
}
const mcpSend = args[0] === 'acp-mcp-call' && args[1] === 't3_thread_send';
if (mcpSend) {
  const input = JSON.parse(args[2]);
  args.splice(0, args.length, 'thread', 'send', input.threadId, input.message);
}
const flag = (name) => args[args.indexOf(name) + 1];
const reply = (value) => console.log(JSON.stringify(value));
if (
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'api' &&
  args[1] === 'graphql' &&
  flag('-f')?.includes('closedByPullRequestsReferences')
) {
  const number = Number(flag('-f').match(/issue\(number:(\d+)\)/)[1]);
  reply({
    data: {
      repository: {
        nameWithOwner: 'rafaeltab/wallpaperdb',
        defaultBranchRef: {
          name: config.defaultBranch?.name ?? 'main',
          target: { oid: config.defaultBranch?.tip },
        },
        issue: {
          number,
          state: config.issueStates?.[number] ?? 'OPEN',
          closedByPullRequestsReferences: {
            nodes: (config.landedPrerequisites?.[number] ?? []).map((pr) => ({
              number: pr,
              url: `https://github.com/rafaeltab/wallpaperdb/pull/${pr}`,
            })),
            pageInfo: { hasNextPage: config.landingTruncated ?? false },
          },
        },
      },
    },
  });
} else if (
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'api' &&
  /^repos\/rafaeltab\/wallpaperdb\/pulls\/\d+$/.test(args[1])
) {
  reply(config.mergedPrerequisites?.[args[1].split('/').at(-1)] ?? null);
} else if (config.planning && basename(process.argv[1]) === 'gh' && args[0] !== 'pr') {
  if (args[1] === 'list')
    reply(
      (config.planning.candidates ?? config.planning.issues.map((i) => i.number)).map((number) => ({
        number,
      }))
    );
  else if (args[0] === 'api' && args[1] === 'graphql')
    reply({
      data: {
        repository: {
          issue: { parent: config.planning.parent ? { number: config.planning.parent } : null },
        },
      },
    });
  else if (args[0] === 'api') reply([config.planning.blockers ?? []]);
  else
    reply(
      config.planning.issues.find((i) => i.number === Number(args[2])) ?? config.planning.context
    );
} else if (
  config.planner &&
  args[1] === 'start' &&
  !args.includes('--help') &&
  !args.includes('--worktree')
) {
  const prompt = args[3] === '-' ? readFileSync(0, 'utf8') : args[3];
  const request = JSON.parse(prompt.split('Request: ')[1]);
  writeFileSync(join(config.directory, 'planner.json'), JSON.stringify(request));
  if (config.planner.lostStart) process.exit(1);
  reply({ threadId: 'planner-thread', projectId: 'project-id', runId: 'planner-run' });
} else if (config.planner && args[1] === 'show' && args[2] === 'planner-thread') {
  const { requestId } = JSON.parse(readFileSync(join(config.directory, 'planner.json'), 'utf8'));
  reply({
    thread: {
      threadId: 'planner-thread',
      latestRunId: 'planner-run',
      status: config.planner.status ?? 'completed',
      providerInstanceId: 'codex',
      model: 'gpt-6.1-sol',
    },
    messages: [
      {
        role: config.planner.role ?? 'assistant',
        runId: 'planner-run',
        text: config.planner.malformed
          ? '{}'
          : JSON.stringify({ requestId, ...config.planner.proposal }),
      },
    ],
  });
} else if (basename(process.argv[1]) === 'gh') {
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
  else if (args[0] === 'pr')
    reply({
      headRefOid: config.prerequisiteHeads?.[args[2]] ?? config.prHead ?? 'a'.repeat(40),
      state: 'OPEN',
      url: `https://github.com/rafaeltab/wallpaperdb/pull/${args[2]}`,
      headRefName: `factory/pr-${args[2]}`,
      mergeable: 'MERGEABLE',
      statusCheckRollup: ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map(
        (name) => ({ name, status: 'COMPLETED', conclusion: config.prerequisiteCI ?? 'SUCCESS' })
      ),
    });
  else
    reply({
      number: Number(args[2]),
      state: config.issueStates?.[args[2]] ?? 'OPEN',
      author: { login: 'rafaeltab' },
      url: `https://github.com/rafaeltab/wallpaperdb/issues/${args[2]}`,
      body:
        config.body ??
        Object.entries(config.prerequisiteHeads ?? { 591: config.prHead })
          .filter(([, sha]) => sha)
          .map(([pr, sha]) => `https://github.com/rafaeltab/wallpaperdb/pull/${pr} ${sha}`)
          .join('\n'),
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
  const worktree = join(
    config.directory,
    config.parallel ? `worker-${flag('--branch').replaceAll('/', '-')}` : 'worker'
  );
  execFileSync('git', ['worktree', 'add', '-b', flag('--branch'), worktree, flag('--worktree')], {
    cwd: config.repository,
    stdio: 'pipe',
  });
  writeFileSync(
    join(
      config.directory,
      config.parallel ? `resource-${flag('--branch').replaceAll('/', '-')}.json` : 'resource.json'
    ),
    JSON.stringify({
      threadId: config.parallel ? flag('--branch') : 'thread-live',
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
  const parallelResources = config.parallel
    ? readdirSync(config.directory)
        .filter((name) => name.startsWith('resource-'))
        .map((name) => JSON.parse(readFileSync(join(config.directory, name), 'utf8')))
    : [];
  const resource = config.parallel
    ? parallelResources.find((item) => item.threadId === args[2])
    : existsSync(join(config.directory, 'resource.json'))
      ? JSON.parse(readFileSync(join(config.directory, 'resource.json'), 'utf8'))
      : null;
  if (resource && args[1] === 'show') Object.assign(resource, config.overrides);
  if (config.malformed) console.log('{broken');
  else if (args[1] === 'list')
    reply(
      config.parallel
        ? parallelResources
        : resource
          ? config.duplicate
            ? [resource, resource]
            : [resource]
          : []
    );
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
