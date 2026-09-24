import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplicityFeedbackRequest, evaluateMultiplicityFeedback } from './favorite-multiplicity-feedback.mjs';
test('feedback request strips human annotations and applies conditional semantic eligibility', () => {
  const source = { id: 'case', query: { text: 'red', priorEvidence: 'human answer' }, inputKind: 'image', rankingCondition: 'city',
    conditionalEligibility: ['a'], expectedRankedIds: ['a', 'b'], excludedIds: ['c'], orderGroups: [['a'], ['b']] };
  assert.deepEqual(multiplicityFeedbackRequest(source), { id: 'case', query: { text: 'red' }, inputKind: 'image', eligibleIds: ['a', 'b'], excludedIds: ['c'] });
});
test('accuracy-only loop executes each supported case once and records unsupported/error cases without timing', async () => {
  let calls = 0;
  const cases = ['yes', 'no', 'error'].map(id => ({ id, query: { text: 'red' }, inputKind: 'image', judgedIds: ['a'], preferencePairs: [], orderGroups: [['a']], category: 'red' }));
  const candidate = { supports: input => ({ supported: input.id !== 'no', reason: 'unsupported' }), search: async ({ caseData }) => {
    calls++; if (caseData.id === 'error') throw Error('test failure'); return { hits: [{ id: 'a', score: .5 }] }; } };
  const rows = await evaluateMultiplicityFeedback(candidate, { cases }, [{ id: 'a' }]);
  assert.equal(calls, 2); assert.deepEqual(rows.map(row => row.status), ['ok', 'unsupported', 'error']);
  assert.ok(rows.every(row => !Object.hasOwn(row, 'performance')));
});
