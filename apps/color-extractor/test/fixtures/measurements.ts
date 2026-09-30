import { readFile } from 'node:fs/promises';
import { ColorMeasurementsSchema } from '@wallpaperdb/events';
import { z } from 'zod';

const reference = z
  .object({
    cases: z.array(
      z.object({ name: z.string(), sha256: z.string(), measurements: ColorMeasurementsSchema })
    ),
  })
  .parse(JSON.parse(await readFile(new URL('./prototype/expected.json', import.meta.url), 'utf8')));
export function measuredImage(name = 'red') {
  const fixture = reference.cases.find((value) => value.name === name);
  if (!fixture) throw new Error(`Missing prototype image ${name}`);
  return { measurements: fixture.measurements, originalSha256: fixture.sha256 };
}
