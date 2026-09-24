// THROWAWAY end-to-end HTTP check. Data and receipts remain outside the repository.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOverlapInspectorProvider } from './overlap-inspector-provider.mjs';
import { createOverlapInspectorServer } from './overlap-inspector-server.mjs';
import { CUTOFF_METHODS } from './methods-cutoff.mjs';
import { CUTOFF_LEVELS } from './cutoff-definition.mjs';
import { executeSearch } from './registry.mjs';
import { STORE, hash } from './service.mjs';

const provider = await createOverlapInspectorProvider();
const fixtureIds = provider.corpus.filter(asset => asset.cohort === 'controlled-fixture' || asset.filename.endsWith('.svg')).map(asset => asset.id);
const fixtures = new Set(fixtureIds);
assert.equal(provider.corpus.length, 545);
assert.equal(fixtures.size, 22);
const server = createOverlapInspectorServer(provider);
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const directory = path.join(STORE, 'cutoff-inspector', new Date().toISOString().replaceAll(':', '-'));
await mkdir(directory, { recursive: true });
await copyFile(fileURLToPath(import.meta.url), path.join(directory, 'cutoff-api-smoke.mjs'));
const configurations = [];
for (const method of CUTOFF_METHODS.filter(method => method.profile !== 'all-levels')) for (const bucketCount of [16, 64, 256, 1024]) for (const { cutoff: pixelCutoff } of CUTOFF_LEVELS) {
  configurations.push({ method: method.id, parameters: { bucketCount, pixelCutoff, namedMode: 'concrete-swatches', minimumQuality: .6, qualityInfluence: 1.5 } });
}
for (const bucketCount of [16, 64, 256, 1024]) for (const cutoffBlendExponent of [0, 3, 6]) {
  configurations.push({ method: 'cutoff-all-levels', parameters: { bucketCount, cutoffBlendExponent, pixelCutoff: 0, namedMode: 'concrete-swatches', minimumQuality: .6, qualityCurve: 'power', qualityInfluence: 1.5 } });
}
for (const method of ['overlap-quality-dense', 'overlap-quality-hybrid']) for (const bucketCount of [16, 64, 256, 1024]) configurations.push({ method, parameters: { bucketCount } });
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const results = [];
let error;
try {
  for (const configuration of configurations) {
    const expected = await executeSearch({ ...configuration, query, limit: 100, excludedIds: fixtureIds });
    assert.equal(expected.hits.length, 100);
    for (const includeFixtures of [false, true]) {
      const response = await fetch(`${origin}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ methodId: configuration.method, parameters: configuration.parameters, query, limit: 100, includeFixtures }), signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.supported, true);
      assert.equal(body.evidence.index, expected.evidence.index);
      assert.ok(body.hits.every(hit => !fixtures.has(hit.id)));
      assert.deepEqual(body.hits.map(({ id, score }) => ({ id, score })), expected.hits, 'HTTP must preserve the complete service top 100 after indexed fixture exclusion.');
      for (const [key, value] of Object.entries(configuration.parameters)) assert.equal(body.parameters[key], value);
    }
    results.push({ ...configuration, index: expected.evidence.index, hits: expected.hits.length, hitHash: hash(expected.hits), fixtureExclusionVerified: true, includeFixturesTrueIgnored: true, nativeServiceOrderVerified: true });
    if (results.length % 16 === 0) console.log(`Cutoff HTTP smoke: ${results.length}/${configurations.length} configurations passed.`);
  }
} catch (cause) { error = cause; }
finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const receipt = { schemaVersion: 1, createdAt: new Date().toISOString(), passed: !error, corpusCount: provider.corpus.length, realCount: provider.corpus.length - fixtures.size, excludedFixtureCount: fixtures.size, configurations: results, ...(error ? { error: error.stack } : {}) };
  await writeFile(path.join(directory, 'validation.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ passed: !error, configurations: results.length, receipt: path.join(directory, 'validation.json') }));
}
if (error) throw error;
