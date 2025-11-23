/**
 * Parses an environment variable as an integer with optional default.
 */
export function parseIntEnv(value: string | undefined, defaultValue?: number): number | undefined {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parses an environment variable as a boolean.
 * Treats "true", "1", "yes" as true; "false", "0", "no" as false.
 */
export function parseBoolEnv(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const lower = value.toLowerCase();
  if (["true", "1", "yes"].includes(lower)) return true;
  if (["false", "0", "no"].includes(lower)) return false;
  return defaultValue;
}

/**
 * Gets an environment variable with optional default.
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

/**
 * Gets a required environment variable, throws if missing.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
