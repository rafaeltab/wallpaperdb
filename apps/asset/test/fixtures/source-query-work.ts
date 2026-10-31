import { Client, type Pool, type QueryResult } from 'pg';
import { expect } from 'vitest';

interface ObservedQuery {
  text: string;
  values: unknown[];
  rows: number;
}
interface PlanNode {
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}
function candidateWork(plan: PlanNode): number {
  return (
    (plan['Relation Name'] === 'source_candidates'
      ? ((plan['Actual Rows'] ?? 0) + (plan['Rows Removed by Filter'] ?? 0)) *
        (plan['Actual Loops'] ?? 1)
      : 0) + (plan.Plans ?? []).reduce((sum, child) => sum + candidateWork(child), 0)
  );
}

/** Observe actual pg results without replacing database execution. Replay SELECTs under
 * EXPLAIN ANALYZE to retain examined-row evidence as well as returned-row counts. */
export async function sourceQueryWork<A>(
  pool: Pool,
  size: number,
  work: () => Promise<A>
): Promise<A> {
  const descriptor = Object.getOwnPropertyDescriptor(Client.prototype, 'query');
  if (!descriptor) throw new Error('pg query descriptor missing');
  const original = Client.prototype.query;
  const observed: ObservedQuery[] = [];
  Object.defineProperty(Client.prototype, 'query', {
    ...descriptor,
    value: function (this: Client, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      const input = args[0];
      const text =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'text' in input && typeof input.text === 'string'
            ? input.text
            : '';
      if (!result || typeof result.then !== 'function') return result;
      return result.then((response: QueryResult) => {
        observed.push({
          text,
          values: Array.isArray(args[1]) ? args[1] : [],
          rows: response.rowCount ?? 0,
        });
        return response;
      });
    },
  });
  let value: A;
  try {
    value = await work();
  } finally {
    Object.defineProperty(Client.prototype, 'query', descriptor);
  }
  expect(observed.length).toBeLessThan(32);
  for (const query of observed.filter((entry) => entry.text.includes('"source_candidates"'))) {
    expect(query.rows).toBeLessThanOrEqual(33);
    let examined: number | undefined;
    if (/^select /i.test(query.text)) {
      const explained = await pool.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.text}`,
        query.values
      );
      const plan = explained.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (!plan) throw new Error('Missing PostgreSQL plan');
      examined = candidateWork(plan);
      expect(examined).toBeLessThanOrEqual(64);
    } else expect(query.rows).toBeLessThanOrEqual(1);
    console.info('Source persistence work', {
      size,
      statement: query.text,
      returnedRows: query.rows,
      examinedCandidateRows: examined,
    });
  }
  return value;
}
