import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRelativeQuery, isRelativeAccentQuery, relativeContrastReference } from './methods-relative.mjs';

const uiQuery = { mode: 'vibe', targets: [{ name: 'dark' }, { name: 'bright' }] };

test('relative accent intent accepts both evaluation text and visual controls', () => {
  assert.equal(isRelativeAccentQuery({ text: 'Mostly dark, with small bright areas' }), true);
  assert.equal(isRelativeAccentQuery(uiQuery), true);
  assert.equal(isRelativeAccentQuery({ mode: 'vibe', targets: [{ name: 'bright' }, { name: 'dark' }] }), true);
  assert.equal(isRelativeAccentQuery({ text: 'dark' }), false);
  assert.equal(isRelativeAccentQuery({ mode: 'proportions', targets: [{ name: 'dark', percent: 80 }, { name: 'bright', percent: 20 }] }), false);
  assert.equal(isRelativeAccentQuery({ mode: 'vibe', targets: [{ name: 'dark', color: '#000000', space: 'hsl', tolerance: { h: 1, s: 1, l: 0.1 } }, { name: 'bright' }] }), false);
});

test('dark accent objective requires contrast and some supported highlight area', () => {
  const sample = { rel_dark_area50: 0.98, rel_span_p999: 0.6, rel_highlight_10_area: 0.03 };
  const score = relativeContrastReference(sample);
  assert.ok(score > 0.9);
  assert.equal(relativeContrastReference({ ...sample, rel_highlight_10_area: 0 }), 0);
  assert.equal(relativeContrastReference({ ...sample, rel_span_p999: 0 }), 0);
  assert.ok(relativeContrastReference({ ...sample, rel_highlight_10_area: 0.25 }) < score);
  assert.ok(relativeContrastReference({ ...sample, rel_dark_area50: 0.4 }) < score);
});

test('service query preserves hard eligibility filters and validates heuristic parameters', () => {
  const body = buildRelativeQuery({ query: uiQuery, limit: 13, eligibleIds: ['a', 'b'], excludedIds: ['b'], filter: { term: { cohort: 'real' } } });
  assert.equal(body.size, 13);
  assert.equal(body.query.script_score.script.lang, 'painless');
  assert.match(body.query.script_score.script.source, /doc\['rel_dark_area50'\]/);
  assert.deepEqual(body.query.script_score.query.bool.filter, [{ term: { cohort: 'real' } }, { ids: { values: ['a', 'b'] } }]);
  assert.deepEqual(body.query.script_score.query.bool.must_not, [{ ids: { values: ['b'] } }]);
  assert.throws(() => buildRelativeQuery({ query: uiQuery, parameters: { contrastScale: 0 } }), /positive/);
  assert.throws(() => buildRelativeQuery({ query: { text: 'red' } }), /dark.*bright/i);
});
