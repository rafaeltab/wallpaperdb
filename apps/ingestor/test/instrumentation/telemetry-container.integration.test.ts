import { randomUUID } from 'node:crypto';
import { GenericContainer, getContainerRuntimeClient } from 'testcontainers';
import { expect, it } from 'vitest';
import { runTelemetryContainer } from './telemetry-container.js';

async function control(builder: GenericContainer, timeoutMs?: number): Promise<string> {
  const name = `telemetry-completion-${randomUUID()}`;
  const client = await getContainerRuntimeClient();
  try {
    return await runTelemetryContainer(builder.withName(name), timeoutMs);
  } finally {
    await expect(
      client.container.getById(name).inspect({ abortSignal: AbortSignal.timeout(5000) })
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  }
}

it('captures final stdout and stderr from fast, overlapping containers without sharing output', async () => {
  const results = await Promise.all(
    ['first', 'second'].map((label) =>
      control(
        new GenericContainer('node:22-bookworm').withCommand([
          'sh',
          '-c',
          `echo ${label}-stdout; echo OUTAGE_EXIT=0; echo ${label}-stderr >&2`,
        ])
      )
    )
  );
  for (const [index, label] of ['first', 'second'].entries()) {
    expect(results[index]).toContain(`${label}-stdout\n`);
    expect(results[index]).toContain(`${label}-stderr\n`);
    expect(results[index]).toContain('OUTAGE_EXIT=0\n');
    expect(results[index]).not.toContain(index === 0 ? 'second' : 'first');
  }
});

it('rejects a nonzero process exit even when the completion marker claims success', async () => {
  const result = control(
    new GenericContainer('node:22-bookworm').withCommand([
      'sh',
      '-c',
      'echo OUTAGE_EXIT=0; echo final-error >&2; exit 7',
    ])
  );
  await expect(result).rejects.toThrow('exit code 7');
  await expect(result).rejects.toThrow('OUTAGE_EXIT=0');
  await expect(result).rejects.toThrow('final-error');
});

it('rejects a successful exit without its completion marker and retains diagnostics', async () => {
  const result = control(
    new GenericContainer('node:22-bookworm').withCommand([
      'sh',
      '-c',
      'echo incomplete-stdout; echo incomplete-stderr >&2',
    ])
  );
  await expect(result).rejects.toThrow('exit code 0; missing OUTAGE_EXIT=0');
  await expect(result).rejects.toThrow('incomplete-stdout');
  await expect(result).rejects.toThrow('incomplete-stderr');
});

it('bounds a live process wait and captures diagnostics before removing the container', async () => {
  await expect(
    control(
      new GenericContainer('node:22-bookworm').withCommand([
        'sh',
        '-c',
        'echo still-running; echo OUTAGE_EXIT=0; exec tail -f /dev/null',
      ]),
      250
    )
  ).rejects.toThrow(/completion timed out after 250ms[\s\S]*still-running[\s\S]*OUTAGE_EXIT=0/);
});

class UnreadableLogsContainer extends GenericContainer {
  constructor() {
    super('node:22-bookworm');
    this.hostConfig.LogConfig = { Type: 'none', Config: {} };
  }
}

it('reports Docker log-read failures and removes the container', async () => {
  await expect(
    control(new UnreadableLogsContainer().withCommand(['sh', '-c', 'echo OUTAGE_EXIT=0']))
  ).rejects.toThrow(
    /exit code 0; log read failed:[\s\S]*configured logging driver does not support reading/
  );
});
