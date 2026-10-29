import type { Status } from '../capabilities/job/index.js';
const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export function page(status: Status): string {
  const job = status.kind === 'job' ? status : null;
  const observed = job?.execution.kind === 'found' ? job.execution : null;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Factory operations</title>
 <style>body{font:18px system-ui;max-width:760px;margin:4rem auto;padding:1rem;background:#101820;color:#e8eef1}a{color:#8bd8ff}input,textarea,button{font:inherit;padding:.6rem;margin:.5rem 0;display:block}textarea{width:95%;min-height:8rem}small{color:#b9c8d0}article{padding:1rem;border:1px solid #506773;border-radius:8px}</style>
 <h1>Factory operations</h1><p>One deliberate implementation job. Automatic discovery, review and publication are unavailable.</p>
 ${job ? `<article><h2>Implementation</h2><p><a href="${escapeHtml(job.intent.issueUrl)}">Issue #${job.intent.issue}</a></p><p>Status: ${observed ? escapeHtml(observed.status) : job.execution.kind === 'ambiguous' ? 'Conflicting or unverified thread binding. Inspect T3.' : 'Launch pending or uncertain. Reconciliation only; no duplicate launch.'}</p><p>Elapsed: ${Math.floor(job.elapsedMs / 1000)} seconds</p>${observed ? `<p><a href="t3-thread://v1/${escapeHtml(observed.threadId)}">Open T3 thread</a></p><small>${escapeHtml(observed.model)} · ${escapeHtml(observed.worktree)}</small>` : ''}<p>A finished turn does not establish implementation acceptance. Questions and results remain in T3.</p></article>` : `<form><label>Selected issue number<input name="issue" type="number" min="1" required></label><label>Maintainer execution context<textarea name="context" maxlength="16000" placeholder="Optional scope constraints for this execution"></textarea></label><button>Start selected issue</button></form>`}
 <p><a href="/">Refresh observation</a></p><p id="result" role="status"></p><small>Admission allowance: one total. Active jobs are preserved across restarts. No reset or cancellation control is available in this slice.</small>
 <script>const form=document.querySelector('form');let pending=false;if(form)form.addEventListener('submit',async event=>{event.preventDefault();if(pending)return;pending=true;form.querySelector('button').disabled=true;const data=new FormData(form);try{const response=await fetch('/api/job',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({issue:Number(data.get('issue')),context:data.get('context')})});if(response.ok){location.reload();return;}const result=await response.json();document.querySelector('#result').textContent=result.title;}catch{document.querySelector('#result').textContent='Request uncertain. Refresh observation before retrying.';}finally{pending=false;form.querySelector('button').disabled=false;}});</script></html>`;
}
