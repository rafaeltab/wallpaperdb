// THROWAWAY matched comparison. Stress demonstrations live in comparison.test.ts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createGroup, docker, image, timing } from './fixture';
import { caseNames, runOperation } from './operations';

it('matched baseline and pilot timings', async () => {
  const output = join(mkdtempSync(join(tmpdir(), 'wallpaperdb-redis-prototype-')), 'samples.json');
  const source = createHash('sha256');
  for (const name of ['fixture.ts', 'operations.ts', 'measurement.test.ts', 'vitest.config.ts']) {
    source.update(name).update(readFileSync(new URL(name, import.meta.url)));
  }
  const report = {
    recordedAt: new Date().toISOString(),
    checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    // Content hash binds evidence to runnable code even before its validation commit.
    sourceSha256: source.digest('hex'),
    host: { node: process.version, platform: platform(), kernel: release(), cpus: cpus().length },
    settings: {
      image,
      workers: 1,
      concurrency: 1,
      coverage: false,
      retries: 0,
      schedule: 'five cases serially; alternate baseline/pilot and pilot/baseline',
      pairs: 5,
    },
    warmup: timing(),
    imageId: '',
    imageDigests: [] as string[],
    imageIdAfter: '',
    samples: [] as {
      pair: number;
      mode: 'baseline' | 'pilot';
      status: string;
      error?: string;
      elapsedMs: number;
      elapsedWithoutVerificationMs: number;
      metrics: ReturnType<typeof timing>;
    }[],
  };
  const save = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  save();
  console.log(`Redis prototype raw evidence: ${output}`);
  try {
    const warmup = await createGroup(report.warmup);
    await warmup.close(); // Warm cached image, Docker connection, and Ryuk before both modes.
    const cachedImage = await docker.getImage(image).inspect();
    report.imageId = cachedImage.Id;
    report.imageDigests = cachedImage.RepoDigests ?? [];
    for (let pair = 1; pair <= report.settings.pairs; pair++) {
      const order = pair % 2 ? (['baseline', 'pilot'] as const) : (['pilot', 'baseline'] as const);
      for (const mode of order) {
        const sample: (typeof report.samples)[number] = {
          pair,
          mode,
          status: 'running',
          elapsedMs: 0,
          elapsedWithoutVerificationMs: 0,
          metrics: timing(),
        };
        report.samples.push(sample);
        save(); // An interrupted or failed sample stays in the evidence.
        const start = performance.now();
        try {
          const groups = mode === 'baseline' ? caseNames.map((name) => [name]) : [caseNames];
          for (const names of groups) {
            const group = await createGroup(sample.metrics);
            try {
              for (const name of names) {
                await group.runCase(name, (scope) => runOperation(name, scope));
              }
            } finally {
              await group.close();
            }
          }
          const expectedContainers = mode === 'baseline' ? 5 : 1;
          expect(sample.metrics.starts).toBe(expectedContainers);
          expect(sample.metrics.stops).toBe(expectedContainers);
          expect(sample.metrics.containersRemoved).toBe(expectedContainers);
          // Six case clients plus one private deletion client for each of the five cases.
          expect(sample.metrics.clientsClosed).toBe(11);
          sample.status = 'passed';
        } catch (error) {
          sample.status = 'failed';
          sample.error = error instanceof Error ? error.stack : String(error);
        } finally {
          sample.elapsedMs = performance.now() - start;
          sample.elapsedWithoutVerificationMs = sample.elapsedMs - sample.metrics.verificationMs;
          save();
          console.log(JSON.stringify(sample));
        }
      }
    }
    report.imageIdAfter = (await docker.getImage(image).inspect()).Id;
    expect(report.imageIdAfter).toBe(report.imageId);
    expect(report.samples.filter((sample) => sample.status !== 'passed')).toEqual([]);
  } finally {
    save();
  }
});
