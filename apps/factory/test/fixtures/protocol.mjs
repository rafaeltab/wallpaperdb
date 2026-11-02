#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  appendFileSync,
  readdirSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const config = JSON.parse(readFileSync(process.env.FACTORY_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
const hold = async (boundary) => {
  if (config.hold !== boundary) return;
  writeFileSync(join(config.directory, 'held'), boundary);
  const { setTimeout } = await import('node:timers/promises');
  const deadline = Date.now() + 20000;
  while (!existsSync(join(config.directory, 'release'))) {
    if (Date.now() > deadline) throw new Error('Controlled protocol hold expired');
    await setTimeout(20);
  }
  writeFileSync(join(config.directory, 'released'), boundary);
};
appendFileSync(
  join(config.directory, 'calls.jsonl'),
  JSON.stringify({ binary: basename(process.argv[1]), args }) + '\n'
);
const earlyFlag = (name) => args[args.indexOf(name) + 1];
if (
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'api' &&
  args[1] === 'graphql' &&
  earlyFlag('-f')?.includes('closedByPullRequestsReferences')
) {
  const number = Number(earlyFlag('-f').match(/issue\(number:(\d+)\)/)[1]);
  console.log(
    JSON.stringify({
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
    })
  );
  process.exit(0);
}
if (
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'api' &&
  /^repos\/rafaeltab\/wallpaperdb\/pulls\/\d+$/.test(args[1]) &&
  Object.hasOwn(config.mergedPrerequisites ?? {}, args[1].split('/').at(-1))
) {
  console.log(JSON.stringify(config.mergedPrerequisites?.[args[1].split('/').at(-1)] ?? null));
  process.exit(0);
}
if (config.restack && basename(process.argv[1]) === 't3' && !args.includes('--help')) {
  const path = join(config.directory, 'restacker.json');
  const flag = (name) => args[args.indexOf(name) + 1];
  let state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const git = (cwd, ...values) =>
    execFileSync('git', values, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  if (args[0] === 'acp-mcp-call') {
    console.log(
      JSON.stringify({
        structuredContent: {
          thread: { latestRunId: state.thread.latestRunId },
          items: [
            {
              itemId: 'restack-question',
              runId: state.thread.latestRunId,
              type: 'user_input_request',
              status: 'waiting',
              text: config.restack.question,
              sourceThreadId: 'restacker',
              visibility: 'local',
            },
          ],
          hasMore: false,
          nextPosition: null,
        },
      })
    );
  } else if (args[1] === 'start') {
    const prompt = args[3];
    const operation = prompt.match(/Operation ([a-f0-9]+)\./)[1];
    const [onto, parent] = prompt.match(/git rebase --onto ([a-f0-9]+) ([a-f0-9]+)/).slice(1);
    const worktree = join(config.directory, `recovery-worker-${operation}`);
    git(config.repository, 'worktree', 'add', '-b', flag('--branch'), worktree, flag('--worktree'));
    try {
      git(worktree, 'rebase', '--onto', onto, parent);
    } catch {
      writeFileSync(
        join(worktree, 'shared.txt'),
        config.restack.outcome === 'COMPLEX'
          ? `export const behavior = () => 'resolved D and C behavior${state?.operation && state.operation !== operation ? ` ${operation}` : ''}';`
          : `resolved D and C behavior${state?.operation && state.operation !== operation ? ` ${operation}` : ''}`
      );
      git(worktree, 'add', 'shared.txt');
      execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], {
        cwd: worktree,
        stdio: 'pipe',
      });
    }
    const head = git(worktree, 'rev-parse', 'HEAD');
    state = {
      thread: {
        threadId: config.restack.responseThreadId ?? 'restacker',
        projectId: 'project-id',
        title: flag('--title'),
        branch: flag('--branch'),
        providerInstanceId: 'codex',
        model: 'gpt-6.1-sol',
        worktreePath: worktree,
        status: config.restack.question ? 'waiting' : 'completed',
        pendingRequestCount: config.restack.question ? 1 : 0,
        latestRunId: 'resolve-run',
        runCount: 1,
      },
      operation,
      head,
      messages: [
        {
          role: 'assistant',
          runId: config.restack.staleRun ? 'prior-run' : 'resolve-run',
          text:
            config.restack.question ??
            JSON.stringify({
              operation: config.restack.stale ? 'stale' : operation,
              commit: head,
              outcome: config.restack.outcome
                ? `<RESTACK>${config.restack.outcome}</RESTACK>`
                : 'done',
            }),
        },
      ],
    };
    writeFileSync(path, JSON.stringify(state));
    await hold('restack');
    if (config.restack.loseLaunch) process.exit(1);
    console.log(
      JSON.stringify({ threadId: 'restacker', projectId: 'project-id', runId: 'resolve-run' })
    );
  } else if (args[1] === 'send') {
    const journals = join(config.directory, 'joins');
    writeFileSync(
      join(config.directory, 'review-capacity-observed.json'),
      JSON.stringify(
        readdirSync(journals, { recursive: true })
          .filter((name) => name.endsWith('recovery-progress.json'))
          .map((name) => JSON.parse(readFileSync(join(journals, name), 'utf8')))
      )
    );
    if (config.restack.repair) {
      writeFileSync(
        join(state.thread.worktreePath, 'shared.txt'),
        'resolved D and C after independent review'
      );
      git(state.thread.worktreePath, 'add', 'shared.txt');
      git(state.thread.worktreePath, 'commit', '-m', 'Repair C conflict after review');
      state.head = git(state.thread.worktreePath, 'rev-parse', 'HEAD');
    }
    state.thread.runCount = 2;
    state.thread.latestRunId = 'review-run';
    state.messages = [
      {
        role: 'assistant',
        runId: 'review-run',
        text: JSON.stringify({
          operation: state.operation,
          commit: state.head,
          outcome: config.restack.review ? '<REVIEW>COMPLETE</REVIEW>' : 'incomplete',
        }),
      },
    ];
    writeFileSync(path, JSON.stringify(state));
    console.log('{}');
  } else if (args[1] === 'list')
    console.log(
      JSON.stringify(state ? [{ threadId: 'restacker', title: state.thread.title }] : [])
    );
  else console.log(JSON.stringify(state));
  process.exit(0);
}
if (
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'api' &&
  args[1] === 'repos/rafaeltab/wallpaperdb' &&
  !config.landing
) {
  console.log(JSON.stringify({ default_branch: config.defaultBranch?.name ?? 'main' }));
  process.exit(0);
}
if (
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'api' &&
  args[1].includes('/pulls/') &&
  (!config.landing ||
    (Number(args[1].split('/').at(-1)) !== config.landing.pr &&
      !Object.hasOwn(config.landing.merges ?? {}, args[1].split('/').at(-1))))
) {
  console.log(
    JSON.stringify({
      merged: false,
      merge_commit_sha: null,
      head: { sha: 'a'.repeat(40) },
      base: { ref: 'main' },
    })
  );
  process.exit(0);
}
if (
  config.landing &&
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'api' &&
  (args[1] === 'repos/rafaeltab/wallpaperdb' ||
    args[1].includes('/compare/') ||
    (args[1].includes('/pulls/') &&
      (Number(args[1].split('/').at(-1)) === config.landing.pr ||
        Object.hasOwn(config.landing.merges ?? {}, args[1].split('/').at(-1)))))
) {
  const value = config.landing.merges?.[args[1].split('/').at(-1)] ?? config.landing;
  if (args[1].includes('/compare/'))
    console.log(
      JSON.stringify({
        status: value.reachable === false ? 'diverged' : 'ahead',
        merge_base_commit: { sha: args[1].split('/compare/')[1].split('...')[0] },
      })
    );
  else if (args[1].includes('/pulls/'))
    console.log(
      JSON.stringify({
        merged: true,
        merge_commit_sha: value.merge,
        head: { sha: value.head },
        base: { ref: value.base ?? 'main' },
      })
    );
  else console.log(JSON.stringify({ default_branch: config.defaultBranch?.name ?? 'main' }));
  process.exit(0);
}
if (
  config.landing &&
  basename(process.argv[1]) === 'gh' &&
  args[0] === 'issue' &&
  args.includes('state,projectItems')
) {
  console.log(
    JSON.stringify({
      state: config.landing.issueState ?? 'CLOSED',
      projectItems: [{ title: 'WallpaperDB', status: { name: config.landing.status ?? 'Done' } }],
    })
  );
  process.exit(0);
}
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
      state:
        config.issueStates?.[number] ?? (state.closedIssues?.includes(number) ? 'CLOSED' : 'OPEN'),
      author:
        state.issueAuthors?.[number] === undefined
          ? { login: 'rafaeltab' }
          : state.issueAuthors[number],
      url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
      labels: [{ name: 'ready-for-agent' }],
      body: state.evidence + (state.issueBodyContext?.[number] ?? ''),
      comments: state.issueComments?.[number] ?? [],
    };
  else if (args[0] === 'issue' && args[1] === 'comment') state.evidence += '\n' + flag('--body');
  else if (args[0] === 'api' && args[1] === 'graphql')
    result = { data: { repository: { issue: { parent: { number: 571 } } } } };
  else if (args[0] === 'api' && args[1].includes('dependencies'))
    result = [
      state.blockers ?? [
        { number: 3, state: 'open' },
        { number: 4, state: 'open' },
      ],
    ];
  else if (args[0] === 'pr' && ['view', 'list'].includes(args[1])) {
    const item = state.prs[String(number)];
    const head =
      item.head ??
      git('ls-remote', '--heads', 'origin', `refs/heads/${item.branch}`).split(/\s/)[0];
    result = {
      url: `https://github.com/rafaeltab/wallpaperdb/pull/${number}`,
      closingIssuesReferences: config.missingClosingLink
        ? []
        : [{ url: `https://github.com/rafaeltab/wallpaperdb/issues/${number - 100}` }],
      headRefOid: head,
      headRefName: item.branch,
      baseRefName: item.base,
      baseRefOid: git('rev-parse', item.base),
      author: item.author === undefined ? { login: 'rafaeltab' } : item.author,
      body: item.body ?? '',
      comments: item.comments ?? [],
      state: item.state ?? 'OPEN',
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
  const save = () => {
    const next = `${statePath}.${process.pid}.next`;
    writeFileSync(next, JSON.stringify(state));
    renameSync(next, statePath);
  };
  if (state.lose === boundary && boundary) {
    state.lose = null;
    save();
    process.exit(1);
  }
  // Queries can overlap each other and metadata edits. They must not publish
  // their old snapshots over a completed edit or expose a truncated JSON file.
  if (boundary || (args[0] === 'api' && args.includes('POST'))) save();
  await hold(boundary);
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
if (config.planning && basename(process.argv[1]) === 'gh' && args[0] !== 'pr') {
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
      latestRunId: config.planner.runId ?? 'planner-run',
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
          : JSON.stringify({
              requestId: config.planner.responseRequestId ?? requestId,
              ...config.planner.proposal,
            }),
      },
    ],
  });
} else if (basename(process.argv[1]) === 'gh') {
  if (config.githubMalformed) console.log('{}');
  else if (args[0] === 'api')
    reply(args[1]?.includes('/actions/runs/') ? config.jobs : [config.blockers ?? []]);
  else if (args[0] === 'pr' && args[1] === 'list') {
    const prs =
      config.prs ??
      (existsSync(join(config.directory, 'pr.json'))
        ? [JSON.parse(readFileSync(join(config.directory, 'pr.json'), 'utf8'))]
        : []);
    reply(
      config.respectPRFilters
        ? prs.filter(
            (pr) =>
              pr.headRefName === args[args.indexOf('--head') + 1] &&
              (!args.includes('--base') || pr.baseRefName === args[args.indexOf('--base') + 1])
          )
        : prs
    );
  } else if (
    args[0] === 'pr' &&
    args[1] === 'view' &&
    args.includes('url,headRefOid,headRefName,baseRefName,baseRefOid,state') &&
    (config.prs?.length || existsSync(join(config.directory, 'pr.json')))
  )
    reply(config.prs?.[0] ?? JSON.parse(readFileSync(join(config.directory, 'pr.json'), 'utf8')));
  else if (args[0] === 'pr')
    reply({
      baseRefName: 'main',
      baseRefOid: config.base ?? 'a'.repeat(40),
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
  resource.latestRunId = `run-${resource.runCount}`;
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
          : (((config.holdPublication && resource?.runCount === 3) ||
            (config.holdReview && resource?.runCount === 2)
              ? []
              : config.messages) ??
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
