import type { ScheduleStatus } from '../capabilities/plan/index.js';
import type { Delivery, Status } from '../capabilities/job/index.js';
const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export function page(status: Status, schedule?: ScheduleStatus): string {
  const job = status.kind === 'job' ? status : null;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Factory operations</title>
 <style>body{font:18px system-ui;max-width:760px;margin:4rem auto;padding:1rem;background:#101820;color:#e8eef1}a{color:#8bd8ff}input,textarea,button{font:inherit;padding:.6rem;margin:.5rem 0;display:block}textarea{width:95%;min-height:8rem}small{color:#b9c8d0}article{padding:1rem;border:1px solid #506773;border-radius:8px}</style>
 <h1>Factory operations</h1><p>Continuous admission of valid plans. Review, publication and CI observation follow accepted stage outcomes. Plan preview automatically discovers issue context and asks an agent for an advisory proposal.</p>
 <section><h2>Automatic plan preview</h2><p>Preview only. Verified forks and automatic joins run through the scheduler. Post-merge stack maintenance and upgrades remain unavailable.</p><button id="preview">Generate plan preview</button><pre id="plan" role="status" style="white-space:pre-wrap"></pre></section>
 ${schedule ? controls(schedule) : ''}
 ${schedule?.recoveries?.map((recovery) => `<article><h2>Conflict recovery #${recovery.issue}</h2><p>Classification: ${escapeHtml(recovery.classification ?? 'Unclassified')}</p><p>${escapeHtml(recovery.progress)}</p>${recovery.question ? `<p>Question: ${escapeHtml(recovery.question)}</p>` : ''}<a href="${escapeHtml(recovery.pr)}">Affected PR</a>${recovery.threadId ? `<p><a href="t3-thread://v1/${escapeHtml(recovery.threadId)}">Open recovery thread</a></p>` : ''}</article>`).join('') ?? ''}
 ${job ? jobPage(job) : `<form data-start><label>Selected issue number<input name="issue" type="number" min="1" required></label><label>Maintainer execution context<textarea name="context" maxlength="16000" placeholder="Optional scope constraints for this execution"></textarea></label><button>Start selected issue</button></form>`}
 <p><a href="/">Refresh observation</a></p><p id="result" role="status"></p><small>Distinct admissions are retained across restarts. Active jobs are preserved across restarts. Cancellation is explicit. Admission controls and readiness labels do not cancel active work.</small>
 <script>const controls=document.querySelector('#controls');if(controls)controls.addEventListener('submit',async event=>{event.preventDefault();const button=controls.querySelector('button');if(button.disabled)return;button.disabled=true;const data=new FormData(controls);try{const response=await fetch('/api/scheduler',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:Number(controls.dataset.revision),concurrency:Number(data.get('concurrency')),allowance:Number(data.get('allowance')),paused:data.get('paused')==='on'})});if(response.ok){location.reload();return;}document.querySelector('#result').textContent=(await response.json()).title;}catch{document.querySelector('#result').textContent='Request uncertain. Refresh observation before retrying.';}finally{button.disabled=false;}});document.querySelector('#preview').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;const output=document.querySelector('#plan');output.textContent='Reading current issues and jobs. Waiting for agent proposal...';try{const response=await fetch('/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok){output.textContent=result.title;return;}const selected=result.selected.map(i=>'#'+i.issue+': '+i.reason);const rejected=result.rejected.map(i=>'#'+i.issue+': '+i.reason);output.textContent=(result.kind==='stale'?'Stale proposal. Generate a fresh preview.':'Validated advisory proposal')+'\\n\\nProposed\\n'+(selected.join('\\n')||'None')+'\\n\\nRejected or blocked\\n'+(rejected.join('\\n')||'None')+'\\n\\nConflict recovery\\n'+(result.input.issues.filter(i=>i.recovery).map(i=>'#'+i.number+' '+(i.recovery.classification||'Unclassified')+': '+i.recovery.progress+(i.recovery.question?'\\nQuestion: '+i.recovery.question:'')+(i.recovery.threadId?'\\nOpen T3: t3-thread://v1/'+i.recovery.threadId:'')).join('\\n')||'None')+'\\n\\nNo work was dispatched.';}catch{output.textContent='Preview unavailable. No work was dispatched.';}finally{button.disabled=false;}});const form=document.querySelector('form[data-start]');let pending=false;if(form)form.addEventListener('submit',async event=>{event.preventDefault();if(pending)return;pending=true;form.querySelector('button').disabled=true;const data=new FormData(form);try{const response=await fetch('/api/job',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({issue:Number(data.get('issue')),context:data.get('context')})});if(response.ok){location.reload();return;}const result=await response.json();document.querySelector('#result').textContent=result.title;}catch{document.querySelector('#result').textContent='Request uncertain. Refresh observation before retrying.';}finally{pending=false;form.querySelector('button').disabled=false;}});document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{if(pending)return;pending=true;button.disabled=true;try{const response=await fetch('/api/job/'+button.dataset.action,{method:'POST',headers:{'content-type':'application/json'},body:button.dataset.command});if(response.ok){location.reload();return;}document.querySelector('#result').textContent=(await response.json()).title;}catch{document.querySelector('#result').textContent='Request uncertain. Refresh observation before retrying.';}finally{pending=false;button.disabled=false;}}));</script></html>`;
}

function deliveryPage(delivery: Delivery | undefined): string {
  if (!delivery) return '';
  const pr = delivery.pr?.kind === 'found' ? delivery.pr : null;
  return `${waitingPage(delivery)}<p>${delivery.ready ? 'Ready for manual merge' : 'Required acceptance or CI pending'}</p><p>Not landed. Default-branch landing is not verified by this slice.</p><p>Current accepted commit: <code>${escapeHtml(delivery.commit)}</code></p>${pr ? `<p><a href="${escapeHtml(pr.url)}">Open pull request</a></p>` : ''}`;
}

function stageHeading(delivery: Delivery | undefined) {
  if (!delivery) return 'Implementation';
  return escapeHtml(delivery.stage.charAt(0).toUpperCase() + delivery.stage.slice(1));
}

function waitingPage(delivery: Delivery) {
  const deadline =
    delivery.deadline === undefined
      ? ''
      : `<p>GitHub wait deadline: ${escapeHtml(new Date(delivery.deadline).toISOString())}</p>`;
  return `<p>${escapeHtml(delivery.activity ?? '')}</p>${delivery.question ? `<pre>${escapeHtml(delivery.question.text)}</pre>` : ''}${deadline}`;
}

function jobPage(job: Extract<Status, { kind: 'job' }>) {
  const observed = job.execution.kind === 'found' ? job.execution : null;
  return `<article><h2>${stageHeading(job.delivery)}</h2>${deliveryPage(job.delivery)}${jobControls(job, observed)}<p><a href="${escapeHtml(job.intent.issueUrl)}">Issue #${job.intent.issue}</a></p><p>Status: ${observed ? escapeHtml(observed.status) : job.execution.kind === 'ambiguous' ? 'Conflicting or unverified thread binding. Inspect T3.' : 'Launch pending or uncertain. Reconciliation only; no duplicate launch.'}</p><p>Elapsed: ${Math.floor(job.elapsedMs / 1000)} seconds</p>${observed ? `<p><a href="t3-thread://v1/${escapeHtml(observed.threadId)}">Open T3 thread</a></p><small>${escapeHtml(observed.model)} · ${escapeHtml(observed.worktree)}</small>` : ''}<p>A finished turn does not establish implementation acceptance. Questions and results remain in T3.</p></article>`;
}
function jobControls(
  job: Extract<Status, { kind: 'job' }>,
  observed: Extract<import('../capabilities/job/index.js').Observation, { kind: 'found' }> | null
) {
  return `${job.resume ? `<p>Parked. Active capacity released. Answer in the owning T3 thread, then refresh and resume.</p><button data-action="resume" data-command="${escapeHtml(JSON.stringify({ jobId: job.intent.id, ...job.resume }))}" ${observed?.question ? 'disabled' : ''}>Resume existing job</button>` : ''}${job.delivery?.activity !== 'cancelled' ? `<button data-action="cancel" data-command="${escapeHtml(JSON.stringify({ jobId: job.intent.id }))}">Cancel job</button>` : ''}`;
}

function controls(schedule: ScheduleStatus): string {
  const state = schedule.state;
  return `<section><h2>Scheduler controls</h2><form id="controls" data-revision="${state.revision}"><label>Concurrency<input name="concurrency" type="number" value="${state.concurrency}" required></label><label>Distinct issue allowance<input name="allowance" type="number" value="${state.allowance}" required></label><p>Use -1 for unlimited. Lowering limits preserves existing work.</p><label><input name="paused" type="checkbox" ${state.paused ? 'checked' : ''}>Pause admissions</label><button>Save scheduler controls</button></form><p>Admissions: ${state.admissions.length}. Admissions ${state.paused ? 'paused' : 'enabled'}.</p></section>${schedule.jobs
    .slice(1)
    .map((job) =>
      job.kind === 'job' ? jobPage(job) : '<p>Reserved admission awaiting reconciliation.</p>'
    )
    .join('')}`;
}
