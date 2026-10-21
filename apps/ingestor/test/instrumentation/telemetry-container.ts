import { getContainerRuntimeClient, type GenericContainer, Wait } from 'testcontainers';

function decodeDiagnostics(logs: Buffer): string {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < logs.length; ) {
    // Non-TTY Docker logs multiplex stdout and stderr with eight-byte frame headers.
    if (logs.length - offset < 8) throw new Error('Incomplete Docker log header');
    const stream = logs[offset];
    const end = offset + 8 + logs.readUInt32BE(offset + 4);
    if ((stream !== 1 && stream !== 2) || end > logs.length)
      throw new Error('Invalid or incomplete Docker log frame');
    chunks.push(logs.subarray(offset + 8, end));
    offset = end;
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runTelemetryContainer(
  builder: GenericContainer,
  timeoutMs = 60_000
): Promise<string> {
  const client = await getContainerRuntimeClient();
  // Return an owned handle even if the process has already exited unsuccessfully.
  const started = await builder.withWaitStrategy(Wait.forAll([])).start();
  const container = client.container.getById(started.getId());
  try {
    let exitCode: number | undefined;
    let completionError: unknown;
    const completion = new AbortController();
    const deadline = setTimeout(() => completion.abort(), timeoutMs);
    try {
      const result = await container.wait({
        condition: 'not-running',
        abortSignal: completion.signal,
      });
      exitCode = result.StatusCode;
    } catch (error) {
      completionError = error;
    } finally {
      clearTimeout(deadline);
    }

    const status = completionError
      ? `completion ${completion.signal.aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms: ${completionError}`
      : `exit code ${exitCode}`;
    const context = `Telemetry container ${started.getId()} ${status}`;
    let diagnostics: string;
    try {
      // Read retained logs to EOF after exit, or snapshot them after a failed wait.
      // The raw API preserves log-read errors which testcontainers.logs() suppresses.
      diagnostics = decodeDiagnostics(
        await container.logs({
          follow: false,
          stdout: true,
          stderr: true,
          abortSignal: AbortSignal.timeout(5000),
        })
      );
    } catch (error) {
      throw new Error(`${context}; log read failed: ${error}`, { cause: error });
    }
    if (completionError || exitCode !== 0)
      throw new Error(`${context}\n${diagnostics}`, { cause: completionError });
    if (!/^OUTAGE_EXIT=0\r?$/m.test(diagnostics))
      throw new Error(`${context}; missing OUTAGE_EXIT=0 completion marker\n${diagnostics}`);
    return diagnostics;
  } finally {
    await container.remove({ force: true, v: true, abortSignal: AbortSignal.timeout(5000) });
  }
}
