import type { ScheduleSnapshot } from './api';
import { ExternalLink, Issues, ThreadLinks } from './links';
type Job = Extract<ScheduleSnapshot['jobs'][number], { kind: 'job' }>;
export type Command = (
  path: string,
  body: unknown
) => Promise<{ state?: ScheduleSnapshot['state'] } | undefined>;
export function JobCard({
  job,
  command,
  pending,
  threads,
}: {
  threads?: ScheduleSnapshot['threads'];
  job: Job;
  command: Command;
  pending: boolean;
}) {
  const observed = job.execution.kind === 'found' ? job.execution : undefined;
  const delivery = job.delivery;
  const pr = delivery?.pr?.kind === 'found' ? delivery.pr : undefined;
  const resume = job.resume;
  return (
    <article>
      <h2>
        {delivery
          ? delivery.stage.charAt(0).toUpperCase() + delivery.stage.slice(1)
          : 'Implementation'}
      </h2>
      {delivery && (
        <>
          <p>{delivery.activity}</p>
          {delivery.question && <pre>{delivery.question.text}</pre>}
          {delivery.deadline !== undefined && (
            <p>GitHub wait deadline: {new Date(delivery.deadline).toISOString()}</p>
          )}
          <p>
            {delivery.landed
              ? 'Landed on the default branch'
              : delivery.ready
                ? 'Ready for manual merge'
                : 'Required acceptance or CI pending'}
          </p>
          <p>
            {delivery.landed ? 'Default-branch landing verified.' : 'Not landed.'} {pr?.lifecycle}
          </p>
          <p>
            Current accepted commit: <code>{delivery.commit}</code>
          </p>
          {pr && (
            <p>
              <ExternalLink href={pr.url}>Open pull request</ExternalLink>
            </p>
          )}
        </>
      )}
      {resume && (
        <>
          <p>
            {'runId' in resume
              ? 'Interrupted or failed stage. Retry continues this existing job and stage.'
              : 'Parked. Active capacity released. Answer in the owning T3 thread, then refresh and resume.'}
          </p>
          <button
            type="button"
            disabled={pending || !!observed?.question}
            onClick={() => command('/api/job/resume', { jobId: job.intent.id, ...resume })}
          >
            {'runId' in resume ? 'Retry existing stage' : 'Resume existing job'}
          </button>
        </>
      )}
      {delivery?.activity !== 'cancelled' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => command('/api/job/cancel', { jobId: job.intent.id })}
        >
          Cancel job
        </button>
      )}
      <p>
        <ExternalLink href={job.intent.issueUrl}>Issue #{job.intent.issue}</ExternalLink>
      </p>
      <p>
        Status:{' '}
        {observed
          ? observed.status
          : job.execution.kind === 'ambiguous'
            ? 'Conflicting or unverified thread binding. Inspect T3.'
            : 'Launch pending or uncertain. Reconciliation only; no duplicate launch.'}
      </p>
      <p>Elapsed: {Math.floor(job.elapsedMs / 1000)} seconds</p>
      {observed && (
        <>
          <p>
            <ThreadLinks
              threadId={observed.threadId}
              environmentId={threads?.facts?.environmentId}
              browserOrigin={threads?.browserOrigin}
            />
          </p>
          <small>
            {observed.model} · {observed.worktree}
          </small>
        </>
      )}
      <p>
        A finished turn does not establish implementation acceptance. Questions and results remain
        in T3.
      </p>
    </article>
  );
}
export function Work({
  snapshot,
  command,
  pending,
}: {
  snapshot: ScheduleSnapshot;
  command: Command;
  pending: boolean;
}) {
  return (
    <div id="work-observation">
      {snapshot.relationships && (
        <section>
          <h2>Current dependencies</h2>
          <p>Explicit issue prerequisites. Parent specs are context, not blocking edges.</p>
          {snapshot.relationships.map((item) => (
            <p key={item.issue}>
              Issue #{item.issue} prerequisites: <Issues numbers={item.blockers} />; admitted
              dependents:{' '}
              <Issues
                numbers={
                  snapshot.relationships
                    ?.filter((candidate) => candidate.blockers.includes(item.issue))
                    .map((candidate) => candidate.issue) ?? []
                }
              />
            </p>
          ))}
        </section>
      )}
      {snapshot.recoveries?.map((recovery) => (
        <article key={recovery.issue}>
          <h2>Conflict recovery #{recovery.issue}</h2>
          <p>Classification: {recovery.classification ?? 'Unclassified'}</p>
          <p>{recovery.progress}</p>
          {recovery.question && <p>Question: {recovery.question}</p>}
          <ExternalLink href={recovery.pr}>Affected PR</ExternalLink>
          {recovery.threadId && (
            <p>
              <ThreadLinks
                threadId={recovery.threadId}
                environmentId={snapshot.threads?.facts?.environmentId}
                browserOrigin={snapshot.threads?.browserOrigin}
              />
            </p>
          )}
        </article>
      ))}
      {snapshot.jobs
        .filter((job) => job.kind === 'job')
        .map((job) => (
          <JobCard
            threads={snapshot.threads}
            key={job.intent.id}
            job={job}
            command={command}
            pending={pending}
          />
        ))}
      {snapshot.jobs.some((job) => job.kind !== 'job') && (
        <p>Reserved admission awaiting reconciliation.</p>
      )}
    </div>
  );
}
