// Pure full-bank request generation. This module sends no service requests and
// performs no warmup; the arrival coordinator owns rates, duration and caches.
import { FEATURE_NAMES } from './corpus-colors.mjs';
import { overlapRegionsForCount } from './overlap-banks.mjs';
import { createFavoriteUtilityPlan, buildFavoriteUtilityQuery } from './favorite-utilities.mjs';

export const FAVORITE_WIDE_DEFINITION = Object.freeze({
  version: 1, bucketCount: 256, seed: 99539473, defaultCombinationFraction: .25,
  anchorCount: 256, namedFeatureCount: FEATURE_NAMES.length,
  profiles: 'Vibe plus proportions0,5,...,100 for every original256 anchor and23 named features.',
  namedMode: 'named-families',
  parameterRule: 'Merge each item.parameters over candidate.parameters before compiling and executing. This selects stored named-feature utilities while preserving the candidate quality/cutoff preset.',
  zeroProfile: 'A zero-percent target is paired with a dummy100% #ff0000 target because the interpreter requires a positive requested total.',
  combinations: 'Additional seeded distinct-target requests alternate two/five colors and vibe/proportions, using both partial and closed proportion palettes.',
  shuffle: 'Fisher-Yates using uint32 LCG1664525/1013904223; the seed determines target combinations and final request order.',
  requestsServices: false,
  warmup: 'Caller-controlled; no queries are executed or warmed by this module.',
  limitations: Object.freeze([
    'A complete cycle covers all stored utility keys; a shorter arrival run may only cover a prefix. Record actual requested-key coverage separately.',
    'The279 zero-profile requests contain an extra dummy target; they add multi-target execution beyond the separately counted combination share.',
    'This deliberately broad field-access workload tests cache behavior; it is not a measured distribution of real user queries.',
    'Named families use the original named-feature definitions, which differ from the default concrete-swatch UI interpretation.',
  ]),
});

function randomFor(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
function shuffle(values, random) {
  for (let i = values.length - 1; i > 0; i--) {
    const other = Math.floor(random() * (i + 1));
    [values[i], values[other]] = [values[other], values[i]];
  }
  return values;
}
function bankTargets() {
  // This is the exact source list and order used by createFavoriteUtilityPlan.
  return [
    ...overlapRegionsForCount(256).map(region => ({ id: 'anchor-' + String(region.index).padStart(4, '0'), target: { color: region.hex } })),
    ...FEATURE_NAMES.map(name => ({ id: 'named-' + name, target: { name } })),
  ];
}
const parameters = () => ({ namedMode: 'named-families' });

export function createFavoriteWideWorkload({ seed = FAVORITE_WIDE_DEFINITION.seed, combinationFraction = .25 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) throw Error('Wide workload seed must be an unsigned32-bit integer.');
  if (!Number.isFinite(combinationFraction) || combinationFraction < 0 || combinationFraction > .5) throw Error('Combination fraction must be within0..0.5.');
  const bank = bankTargets(), queries = [], random = randomFor(seed);
  for (const item of bank) {
    queries.push({ id: 'wide-' + item.id + '-vibe', kind: 'coverage', parameters: parameters(), query: { mode: 'vibe', targets: [{ ...item.target }] } });
    for (let percent = 0; percent <= 100; percent += 5) {
      queries.push({ id: 'wide-' + item.id + '-p' + String(percent).padStart(3, '0'), kind: 'coverage',
        parameters: parameters(), ...(percent === 0 ? { zeroTargetWithDummy: true } : {}),
        query: { mode: 'proportions', targets: [{ ...item.target, percent }, ...(percent === 0 ? [{ color: '#ff0000', percent: 100 }] : [])] } });
    }
  }
  const coverageRequests = queries.length;
  const combinationRequests = Math.round(coverageRequests * combinationFraction / (1 - combinationFraction));
  const portions = {
    2: [[50, 50], [20, 60], [5, 95], [40, 40]],
    5: [[20, 20, 20, 20, 20], [5, 10, 15, 30, 40], [5, 5, 10, 15, 20]],
  };
  for (let i = 0; i < combinationRequests; i++) {
    const count = i % 2 ? 5 : 2, mode = i % 4 < 2 ? 'vibe' : 'proportions';
    const selected = new Set();
    while (selected.size < count) selected.add(Math.floor(random() * bank.length));
    const percentages = portions[count][Math.floor(i / 4) % portions[count].length];
    const targets = [...selected].map((index, position) => ({ ...bank[index].target, ...(mode === 'proportions' ? { percent: percentages[position] } : {}) }));
    queries.push({ id: 'wide-combination-' + String(i).padStart(4, '0'), kind: 'combination', parameters: parameters(), query: { mode, targets } });
  }
  shuffle(queries, random);
  return { definition: FAVORITE_WIDE_DEFINITION, seed,
    counts: { queries: queries.length, coverageRequests, combinationRequests, combinationFraction: combinationRequests / queries.length,
      zeroProfilesWithDummy: bank.length, expectedUtilityKeys: bank.length * 22 }, queries };
}

export function favoriteWideQueries(options) { return createFavoriteWideWorkload(options).queries; }

/** Offline field-coverage proof through the real numeric query compiler. No
 * document generation, OpenSearch requests or warmup are performed. */
export function verifyFavoriteWideCoverage(workload, { parameters: candidateParameters = {} } = {}) {
  if (!Array.isArray(workload?.queries) || !workload.queries.length) throw Error('Wide workload requires a nonempty query list.');
  const expected = new Set(createFavoriteUtilityPlan({ presets: [candidateParameters] }).descriptors.map(descriptor => descriptor.key));
  const observed = new Set();
  for (const item of workload.queries) {
    const body = buildFavoriteUtilityQuery({ query: item.query, parameters: { ...candidateParameters, ...item.parameters }, limit: 20 });
    for (const clause of body.query.bool.should) {
      const field = clause.function_score?.field_value_factor?.field;
      if (!field?.startsWith('utilities.')) throw Error('Wide query did not compile to a numeric utility field: ' + item.id);
      observed.add(field.slice('utilities.'.length));
    }
  }
  const missing = [...expected].filter(key => !observed.has(key)), unexpected = [...observed].filter(key => !expected.has(key));
  if (missing.length || unexpected.length) throw Error(`Wide utility coverage differs: ${missing.length} missing, ${unexpected.length} unexpected; first missing: ${missing.slice(0, 3).join(', ')}`);
  return { verified: true, queries: workload.queries.length, expectedUtilityKeys: expected.size, actualUtilityKeys: observed.size, utilityKeys: [...observed].sort() };
}
