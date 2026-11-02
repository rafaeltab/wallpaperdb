import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, rename, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const [release, config, state, name] = process.argv.slice(2);
for (const path of [release, config, state]) {
  if (!path?.startsWith('/') || !/^[/a-zA-Z0-9_.-]+$/.test(path))
    throw new Error(
      'Release, config and state require absolute paths without whitespace or specifiers'
    );
}
if (!/^wallpaperdb-factory-[a-z0-9-]+$/.test(name ?? ''))
  throw new Error('Use a dedicated wallpaperdb-factory-NAME service');
const installation = JSON.parse(await readFile(join(release, 'installation.json'), 'utf8'));
const realRelease = await realpath(release);
const realState = await realpath(state);
if (realState === realRelease || realState.startsWith(realRelease + '/'))
  throw new Error('Keep durable state outside the installation');
const format = JSON.parse(
  await readFile(join(state, 'format.json'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '{"format":1}';
    throw error;
  })
);
if (format.format !== installation.stateFormat)
  throw new Error(
    'Incompatible state format; keep the current service and choose a compatible installation'
  );
// The activation arguments and service environment must identify the same durable state.
const environment = await readFile(config, 'utf8');
const stateAssignments = environment
  .split('\n')
  .filter((line) => /^\s*(?:export\s+)?FACTORY_STATE\s*=/.test(line));
if (stateAssignments.length !== 1 || stateAssignments[0] !== `FACTORY_STATE=${state}`)
  throw new Error(
    'Config must contain exactly one unquoted FACTORY_STATE assignment matching the state path'
  );
if (!/^[/a-zA-Z0-9_.-]+$/.test(installation.node))
  throw new Error('Unsupported Node executable path');
const unit = join(homedir(), '.config/systemd/user', `${name}.service`);
await mkdir(dirname(unit), { recursive: true });
const contents = `[Unit]
Description=WallpaperDB factory ${installation.commit}
After=network-online.target
[Service]
Type=simple
WorkingDirectory=${dirname(config)}
Environment="PATH=${process.env.PATH.replaceAll('%', '%%').replaceAll('"', '\\"')}"
EnvironmentFile=${config}
ExecStart=/usr/bin/flock --nonblock --no-fork ${state}/service.lock ${installation.node} --env-file=${config} ${release}/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
KillMode=control-group
UMask=0077
[Install]
WantedBy=default.target
`;
await writeFile(unit + '.next', contents, { mode: 0o600 });
await rename(unit + '.next', unit);
execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', name], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'restart', name], { stdio: 'inherit' });
console.log(
  `Activated ${name}: ${installation.commit}; state ${state}. Check journalctl --user -u ${name} and /health before accepting the upgrade.`
);
