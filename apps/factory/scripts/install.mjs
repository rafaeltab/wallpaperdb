import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, realpath, rename, rm, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Produces a separate release. Activation is an explicit operator action.
const [root] = process.argv.slice(2);
if (!root?.startsWith('/')) throw new Error('Usage: service:install /absolute/releases-directory');
const repository = resolve('../..');
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
if (git('status', '--porcelain'))
  throw new Error('Commit the source before creating a pinned installation');
const commit = git('rev-parse', 'HEAD');
execFileSync('make', ['build', 'PACKAGE=factory'], { cwd: repository, stdio: 'inherit' });
await mkdir(root, { recursive: true, mode: 0o700 });
const target = join(root, commit);
const temporary = join(root, `${commit}.preparing-${process.pid}`);
execFileSync(
  'pnpm',
  ['--filter', '@wallpaperdb/factory', 'deploy', '--legacy', '--prod', temporary],
  { cwd: repository, stdio: 'inherit' }
);
try {
  await cp('dist', temporary, { recursive: true });
  await cp('drizzle', join(temporary, 'drizzle'), { recursive: true });
  const self = join(temporary, 'node_modules/.pnpm/node_modules/@wallpaperdb/factory');
  await rm(self, { force: true });
  await symlink('../../../..', self);

  await writeFile(
    join(temporary, 'installation.json'),
    JSON.stringify(
      {
        commit,
        tree: git('rev-parse', 'HEAD^{tree}'),
        node: await realpath(process.execPath),
        nodeVersion: process.version,
        lock: createHash('sha256')
          .update(await readFile(join(repository, 'pnpm-lock.yaml')))
          .digest('hex'),
        stateFormat: 2,
      },
      null,
      2
    )
  );
  if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== commit)
    throw new Error(
      'Source changed during packaging; retain the current release and retry from a clean committed checkout'
    );
  await rename(temporary, target);
  console.log(target);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
