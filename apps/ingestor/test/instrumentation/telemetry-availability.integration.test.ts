import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';
import { it } from 'vitest';

const cases = [
  ...['ingestor', 'gateway', 'asset', 'user', 'tags', 'color-extractor', 'variant-generator'].map(
    (service) => ({ service, outage: 'unresolved' })
  ),
  ...['refused', 'stalled', 'error'].map((outage) => ({ service: 'ingestor', outage })),
];

it.concurrent.for(
  cases
)('keeps fresh-connection HTTP uploads available during $service exporter $outage failure and recovers', { timeout: 90_000 }, async ({ service, outage }, { expect }) => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const container = await new GenericContainer('node:22-bookworm')
    .withBindMounts([{ source: root, target: root, mode: 'ro' }])
    .withWorkingDir(`${root}/apps/ingestor`)
    .withEnvironment({
      TELEMETRY_SERVICE: service,
      TELEMETRY_OUTAGE_MODE: outage,
      OTEL_BSP_SCHEDULE_DELAY: '100',
      OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '1',
      OTEL_BLRP_SCHEDULE_DELAY: '100',
      OTEL_BLRP_MAX_EXPORT_BATCH_SIZE: '1',
    })
    .withCommand([
      'sh',
      '-c',
      "printf 'nameserver 127.0.0.1\\noptions timeout:10 attempts:1\\n' > /etc/resolv.conf; node --import tsx test/fixtures/telemetry-outage.ts; result=$?; echo OUTAGE_EXIT=$result; sleep 1; exit $result",
    ])
    .withWaitStrategy(Wait.forLogMessage('OUTAGE_EXIT='))
    .withStartupTimeout(60_000)
    .start();
  try {
    const output = await container.logs();
    let diagnostics = '';
    for await (const chunk of output) diagnostics += chunk.toString();
    console.log(diagnostics);
    expect(diagnostics).toContain('OUTAGE_EXIT=0');
    expect(diagnostics).toContain('"phase":"collector-restored"');
    expect(diagnostics).toContain('"pendingSystemLookups":0');
  } finally {
    await container.stop();
  }
});
