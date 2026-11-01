import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function command(
  binary: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  environment?: NodeJS.ProcessEnv,
  input?: string
): Promise<string> {
  const pending = execute(binary, [...args], {
    cwd,
    env: environment ? { ...process.env, ...environment } : process.env,
    timeout: 30000,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
    signal,
  });
  if (input !== undefined) pending.child.stdin?.end(input);
  const result = await pending;
  return result.stdout;
}
