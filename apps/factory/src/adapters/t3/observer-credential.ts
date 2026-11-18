import { randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { command } from '../../platform/index.js';

const session = z.object({
  sessionId: z.string().min(1),
  token: z.string().min(1),
  method: z.literal('bearer-access-token'),
  scopes: z.tuple([z.literal('orchestration:read')]),
  expiresAt: z.string().datetime(),
});
/** Host-side provisioning stays separate from the existing MCP-only credential. */
export function t3ObserverCredential(config: {
  binary: string;
  project: string;
  directory: string;
  origin: string;
  authBaseDir?: string;
  now?: () => number;
  report: (error: unknown) => void;
}) {
  const now = config.now ?? Date.now;
  let pending: Promise<{ token: string; expiresAt: number; replaced: AbortSignal }> | undefined;
  let activeToken: string | undefined;
  let replacement = new AbortController();
  const file = join(config.directory, 'session');
  const location = config.authBaseDir ? ['--base-dir', config.authBaseDir] : [];
  const revoke = async (id: string, signal?: AbortSignal) => {
    try {
      await command(
        config.binary,
        ['auth', 'session', 'revoke', id, ...location],
        config.project,
        signal
      );
    } catch {
      config.report(new Error('Unable to revoke replaced T3 observer session'));
    }
  };
  const load = async () => {
    try {
      return session
        .extend({
          binary: z.literal(config.binary),
          origin: z.literal(config.origin),
          authBaseDir: z.literal(config.authBaseDir ?? ''),
        })
        .parse(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      return null;
    }
  };
  const obtain = async (replace: boolean, signal?: AbortSignal) => {
    await mkdir(config.directory, { recursive: true, mode: 0o700 });
    await chmod(config.directory, 0o700);
    const previous = await load();
    if (!replace && previous && Date.parse(previous.expiresAt) - now() > 86400000) {
      await chmod(file, 0o600);
      return { token: previous.token, expiresAt: Date.parse(previous.expiresAt) };
    }
    let issued: z.infer<typeof session>;
    try {
      issued = session.parse(
        JSON.parse(
          await command(
            config.binary,
            [
              'auth',
              'session',
              'issue',
              ...location,
              '--scope',
              'orchestration:read',
              '--ttl',
              '30d',
              '--label',
              'WallpaperDB factory read-only observer',
              '--json',
            ],
            config.project,
            signal
          )
        )
      );
    } catch {
      // Child-process output and malformed credential JSON must never enter telemetry.
      throw new Error('Unable to provision a read-only T3 observer session');
    }
    const temporary = join(config.directory, `.session-${randomUUID()}`);
    try {
      const descriptor = await open(temporary, 'wx', 0o600);
      try {
        await descriptor.writeFile(
          JSON.stringify({
            ...issued,
            binary: config.binary,
            origin: config.origin,
            authBaseDir: config.authBaseDir ?? '',
          })
        );
        await descriptor.sync();
      } finally {
        await descriptor.close();
      }
      await rename(temporary, file);
      const directory = await open(config.directory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await rm(temporary, { force: true });
      await revoke(issued.sessionId, signal);
      throw error;
    }
    if (previous) await revoke(previous.sessionId, signal);
    return { token: issued.token, expiresAt: Date.parse(issued.expiresAt) };
  };
  return (replace = false, signal?: AbortSignal) => {
    pending ??= obtain(replace, signal)
      .then((value) => {
        if (activeToken !== value.token) {
          replacement.abort();
          replacement = new AbortController();
          activeToken = value.token;
        }
        return { ...value, replaced: replacement.signal };
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
