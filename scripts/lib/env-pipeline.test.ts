import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  extractKeys,
  filterApplicableSecrets,
  knownUserSecrets,
  parseEnvValues,
  resolveGenerateMarker,
  syncKnownSecretsToContent,
} from './env-pipeline.mjs';

describe('Profile picture service credentials', () => {
  it('generates one persistent token shared by User and Media only', () => {
    const content = syncKnownSecretsToContent('', knownUserSecrets);
    const secrets = parseEnvValues(content);
    expect(secrets.USER_MEDIA_SERVICE_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(syncKnownSecretsToContent(content, knownUserSecrets)).toBe(content);

    for (const service of ['apps/user', 'apps/media']) {
      const example = 'USER_MEDIA_SERVICE_TOKEN=\n';
      const applicable = filterApplicableSecrets(secrets, extractKeys(example), service, () => {});
      expect(parseEnvValues(applyOverrides(example, applicable, {})).USER_MEDIA_SERVICE_TOKEN)
        .toBe(secrets.USER_MEDIA_SERVICE_TOKEN);
    }

    const webSecrets = filterApplicableSecrets(secrets, extractKeys('VITE_USER_URL=/user\n'), 'apps/web', () => {});
    expect(webSecrets).not.toHaveProperty('USER_MEDIA_SERVICE_TOKEN');
  });

  it('supports explicit token regeneration and preserves an existing configured token', () => {
    const regenerated = resolveGenerateMarker('USER_MEDIA_SERVICE_TOKEN={GENERATE}\n', knownUserSecrets);
    expect(regenerated.secrets.USER_MEDIA_SERVICE_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    const preserved = resolveGenerateMarker(regenerated.content, knownUserSecrets);
    expect(preserved).toEqual(regenerated);
  });
});
