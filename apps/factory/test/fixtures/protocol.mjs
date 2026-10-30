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
const flag = (name) => args[args.indexOf(name) + 1];
const reply = (value) => console.log(JSON.stringify(value));
if (basename(process.argv[1]) === 'gh') {
  if (config.githubMalformed) console.log('{}');
  else if (args[0] === 'api') reply([config.blockers ?? []]);
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
} else if (args.includes('--help')) console.log('--worktree --model');
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
      status: 'running',
      pendingRequestCount: 0,
    })
  );
  if (config.lost) process.exit(1);
  reply({ threadId: 'thread-live', projectId: 'project-id', runId: 'run-1' });
} else {
  if (args[1] === 'list' && config.delayObserve) {
    writeFileSync(join(config.directory, 'observing.pid'), String(process.pid));
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  const resource = existsSync(join(config.directory, 'resource.json'))
    ? JSON.parse(readFileSync(join(config.directory, 'resource.json'), 'utf8'))
    : null;
  if (config.malformed) console.log('{broken');
  else if (args[1] === 'list')
    reply(resource ? (config.duplicate ? [resource, resource] : [resource]) : []);
  else if (args[1] === 'show')
    reply({
      thread: resource ? { ...resource, ...config.overrides } : null,
      messages: config.messages ?? [{ text: '<TASK>COMPLETE</TASK>', role: 'user' }],
    });
}
