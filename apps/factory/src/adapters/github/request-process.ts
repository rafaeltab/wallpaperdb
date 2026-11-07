import { spawn } from 'node:child_process';

export interface RateResponse {
  status: number;
  resource?: string;
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: string;
}

/** Debug traffic is streamed through a bounded header allowlist. Bodies and credentials are discarded. */
export function requestProcess(project: string, args: readonly string[], signal: AbortSignal) {
  return new Promise<{
    value: unknown;
    responses: RateResponse[];
    code: number | null;
    limited: boolean;
    failure?: string;
  }>((resolve) => {
    const responses: RateResponse[] = [],
      output: Buffer[] = [];
    let bytes = 0,
      line = '',
      dropping = false,
      headers: RateResponse | undefined,
      limited = false,
      failure: string | undefined;
    const child = spawn('gh', [...args], {
      cwd: project,
      env: { ...process.env, GH_DEBUG: 'api' },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
      killSignal: 'SIGKILL',
    });
    const kill = (reason: string) => {
      failure ??= reason;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => kill('timeout'), 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) return kill('response-size');
      output.push(chunk);
    });
    const consume = (value: string) => {
      const status = /^< HTTP\/\S+\s+(\d{3})\b/.exec(value);
      if (status) {
        limited = false;
        if (responses.length >= 256) return kill('response-count');
        headers = { status: Number(status[1]) };
        responses.push(headers);
        return;
      }
      if (
        /"type"\s*:\s*"RATE_LIMITED"|^gh: (?:GraphQL: )?(?:You have exceeded|API).*(?:secondary rate limit|abuse detection)/i.test(
          value
        )
      )
        limited = true;
      if (!headers) return;
      const header = /^< ([a-z-]+):\s*(.*)$/i.exec(value);
      if (!header) {
        headers = undefined;
        return;
      }
      const name = header[1].toLowerCase(),
        text = header[2].trim();
      if (name === 'x-ratelimit-resource') headers.resource = text;
      else if (name === 'retry-after') headers.retryAfter = text.slice(0, 128);
      else if (/^\d+$/.test(text)) {
        const number = Number(text);
        if (!Number.isSafeInteger(number)) return;
        if (name === 'x-ratelimit-limit') headers.limit = number;
        else if (name === 'x-ratelimit-remaining') headers.remaining = number;
        else if (name === 'x-ratelimit-reset') headers.reset = number * 1000;
      }
    };
    child.stderr.on('data', (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\n') {
          if (!dropping) consume(line.replace(/\r$/, ''));
          line = '';
          dropping = false;
        } else if (!dropping) {
          if (line.length >= 16_384) {
            line = '';
            dropping = true;
          } else line += character;
        }
      }
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      failure = signal.aborted ? 'aborted' : (error.code ?? 'spawn');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (line && !dropping) consume(line);
      let value: unknown = null;
      if (!failure) {
        const text = Buffer.concat(output).toString('utf8').trim();
        try {
          value = text ? JSON.parse(text) : null;
        } catch {
          value = text;
        }
      }
      resolve({ value, responses, code, limited, ...(failure ? { failure } : {}) });
    });
  });
}
