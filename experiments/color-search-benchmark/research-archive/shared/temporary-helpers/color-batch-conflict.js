(async () => {
  const key = 'wallpaperdb:color-review:color-review-batch-001:v1';
  const notes = document.querySelector('#case-notes');
  notes.value = 'QA second tab retained in memory'; notes.dispatchEvent(new Event('input', {bubbles:true}));
  const raw = JSON.parse(localStorage.getItem(key));
  if (raw.answers['composition-green-red-real-002'].notes !== 'QA first tab protected note') throw new Error('Stale tab overwrote other tab');
  if (!document.querySelector('#storage-status').textContent.includes('Another tab changed')) throw new Error('Conflict not explained');
  document.querySelector('#submit').click();
  const until = Date.now()+10000;
  while (document.querySelector('#submit').disabled && Date.now()<until) await new Promise(r=>setTimeout(r,25));
  if (!document.querySelector('#notice').textContent.startsWith('Saved to the shared library:')) throw new Error('In-memory conflict draft not submittable');
  return {otherTabDraftPreserved:true,conflictingEditsSubmitted:true};
})()
