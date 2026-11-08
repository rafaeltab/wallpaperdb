import { z } from 'zod';
import { requestBudget, type RequestClock } from './request-budget.js';
import { requestProcess, type RateResponse } from './request-process.js';
import { graphqlDiagnostic } from './request-diagnostics.js';

const rate = z.object({
  cost: z.number().int().nonnegative().safe(),
  limit: z.number().int().positive().safe(),
  remaining: z.number().int().nonnegative().safe(),
  resetAt: z.string().datetime(),
});
const quota = z.object({
  limit: z.number().int().nonnegative().safe(),
  remaining: z.number().int().nonnegative().safe(),
  reset: z.number().int().nonnegative().safe(),
});
const object = z.record(z.unknown());
const jsonFields = new Set(
  'number,state,author,url,body,labels,title,comments,headRefOid,headRefName,baseRefName,baseRefOid,mergeable,isDraft,statusCheckRollup,projectItems,closingIssuesReferences'.split(
    ','
  )
);

/** One owner for the factory process's GitHub traffic. Other clients remain outside this budget. */
export function githubRequests(config: {
  project: string;
  directory: string;
  signal: AbortSignal;
  clock?: RequestClock;
}) {
  const budget = requestBudget(config.directory, config.clock);
  type Entry = {
    args: readonly string[];
    signal: AbortSignal;
    priority: 'work' | 'background';
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    abort: () => void;
  };
  const queue: Entry[] = [];
  let running: Promise<void> | undefined;
  const execute = async (entry: Entry) => {
    const { args, signal } = entry;
    const api = args[0] === 'api',
      graphql = api && args[1] === 'graphql';
    if (
      !api &&
      !(
        (args[0] === 'issue' && ['view', 'list', 'comment'].includes(args[1])) ||
        (args[0] === 'pr' && ['view', 'list', 'edit'].includes(args[1]))
      )
    )
      throw new Error('Unsupported budgeted GitHub operation');
    const fields = args.indexOf('--json');
    if (fields >= 0 && args[fields + 1].split(',').some((field) => !jsonFields.has(field)))
      throw new Error('Unaccounted GitHub CLI selection');
    const mutation = api
      ? args.some((a) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(a))
      : ['comment', 'edit'].includes(args[1]);
    const names = api
      ? [graphql ? 'graphql' : args[1].startsWith('search/') ? 'search' : 'core']
      : mutation
        ? ['graphql', 'core']
        : ['graphql'];
    await budget.wait(names, signal, mutation);
    if (!budget.known(names)) {
      const reservation = budget.reserve([], 0);
      const result = await requestProcess(config.project, ['api', 'rate_limit'], signal);
      const parsed = z.object({ resources: z.record(quota) }).safeParse(result.value);
      const responses: RateResponse[] = parsed.success
        ? Object.entries(parsed.data.resources).map(([resource, value]) => ({
            status: 200,
            resource,
            ...value,
            reset: value.reset * 1000,
          }))
        : [];
      const costs = new Map(
        [...responses, ...result.responses]
          .filter((r) => r.resource)
          .map((r) => [r.resource ?? 'core', 0])
      );
      budget.complete(
        reservation,
        [...result.responses, ...responses],
        costs,
        result.code === 0 && !result.failure
      );
      if (!parsed.success || result.code !== 0 || result.failure) throw failure(result);
      if (!budget.known(names)) throw new Error('GitHub quota metadata is unavailable');
      await budget.wait(names, signal, mutation);
    }
    const request = [...args];
    if (graphql) {
      const queryIndex = request.findIndex((a) => a.startsWith('query='));
      if (queryIndex < 0) throw new Error('Explicit GraphQL query required');
      const query = request[queryIndex].slice('query='.length);
      const operation = /^\s*query\b(?:\s+\w+)?\s*(?:\([^{}]*\))?\s*\{/.exec(query);
      if (!operation || query.includes('factoryRateLimit'))
        throw new Error('Unsupported GraphQL quota selection');
      const at = operation[0].length;
      request[queryIndex] =
        'query=' +
        query.slice(0, at) +
        ' factoryRateLimit: rateLimit { cost limit remaining resetAt } ' +
        query.slice(at);
    }
    // Reserve before dispatch. An interrupted process retains this conservative responsibility.
    const estimate = args.includes('--paginate') ? 1000 : graphql ? 10 : api ? 1 : 2;
    const reservation = budget.reserve(names, estimate, mutation);
    const result = await requestProcess(config.project, request, signal);
    let exact = 0,
      exactPages = 0,
      malformed = false;
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      const root = object.safeParse(value);
      if (!root.success) return value;
      const data = object.safeParse(root.data.data);
      if (!data.success || !Object.hasOwn(data.data, 'factoryRateLimit')) return value;
      const parsed = rate.safeParse(data.data.factoryRateLimit);
      if (!parsed.success) malformed = true;
      else {
        exact += parsed.data.cost;
        exactPages++;
      }
      const clean = { ...data.data };
      delete clean.factoryRateLimit;
      return { ...root.data, data: clean };
    };
    const value = strip(result.value);
    const costs = new Map<string, number>();
    for (const response of result.responses) {
      if (!response.resource) continue;
      const charge = response.resource === 'graphql' ? 2 : 1;
      costs.set(response.resource, (costs.get(response.resource) ?? 0) + charge);
    }
    if (exactPages) costs.set('graphql', exact);
    if (result.failure || malformed)
      for (const name of names) costs.set(name, Math.max(estimate, costs.get(name) ?? 0));
    const errors = z
      .object({
        errors: z
          .array(z.object({ type: z.string().optional(), message: z.string().optional() }))
          .optional(),
      })
      .safeParse(value);
    const graphErrors = errors.success ? (errors.data.errors ?? []) : [];
    const secondary = graphErrors.some(
      (e) =>
        e.type === 'RATE_LIMITED' || /secondary rate limit|abuse detection/i.test(e.message ?? '')
    );
    const responses =
      (secondary || (result.limited && result.code !== 0)) &&
      !result.responses.some((r) => r.remaining === 0 || [403, 429].includes(r.status))
        ? [...result.responses, { status: 429 }]
        : result.responses;
    const success = result.code === 0 && !result.failure && !malformed && !graphErrors.length;
    budget.complete(reservation, responses, costs, success);
    if (!success) throw failure({ ...result, limited: result.limited || secondary }, graphErrors);
    return value;
  };
  const pump = () => {
    if (running) return;
    const work = queue.findIndex((entry) => entry.priority === 'work');
    const [entry] = queue.splice(work < 0 ? 0 : work, 1);
    if (!entry) return;
    entry.signal.removeEventListener('abort', entry.abort);
    running = execute(entry)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        running = undefined;
        pump();
      });
  };
  const request = (
    args: readonly string[],
    caller?: AbortSignal,
    priority: 'work' | 'background' = 'work'
  ): Promise<unknown> => {
    const signal = caller ? AbortSignal.any([config.signal, caller]) : config.signal;
    if (signal.aborted) return Promise.reject(signal.reason);
    if (queue.length >= 128) return Promise.reject(new Error('GitHub request queue is full'));
    return new Promise((resolve, reject) => {
      const entry: Entry = {
        args,
        signal,
        priority,
        resolve,
        reject,
        abort: () => {
          const index = queue.indexOf(entry);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(signal.reason);
        },
      };
      signal.addEventListener('abort', entry.abort, { once: true });
      queue.push(entry);
      pump();
    });
  };
  return Object.assign(request, {
    // Composition cancels the owner first, then joins process exit and durable accounting.
    // An interrupted Effect alone does not wait for the underlying Promise to finish.
    drain: async () => {
      while (running) await running;
    },
  });
}

function failure(
  result: Awaited<ReturnType<typeof requestProcess>>,
  errors: readonly { type?: string; message?: string }[] = []
) {
  const diagnostics = new Set([
    ...result.diagnostics,
    ...errors.slice(0, 16).map(graphqlDiagnostic),
  ]);
  if (result.limited) diagnostics.add('rate-limit');
  return new Error('GitHub request failed', {
    cause: {
      code: result.code,
      failure: result.failure,
      rateLimited: result.limited,
      diagnostics: diagnostics.size ? [...diagnostics] : ['unclassified-provider-error'],
      responses: result.responses.map(({ status, resource, remaining, reset, retryAfter }) => ({
        status,
        resource,
        remaining,
        reset,
        retryAfter,
      })),
    },
  });
}
