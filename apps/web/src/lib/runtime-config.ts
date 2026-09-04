export function positiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value === '' ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
