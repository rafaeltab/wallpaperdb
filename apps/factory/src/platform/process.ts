import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function command(
  binary: string,
  args: readonly string[],
  cwd: string
): Promise<string> {
  const result = await execute(binary, [...args], {
    cwd,
    timeout: 30000,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
  });
  return result.stdout;
}
