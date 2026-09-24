(async () => {
  const key = 'wallpaperdb:color-review:color-review-batch-001:v1';
  const state = JSON.parse(localStorage.getItem(key));
  if (Object.keys(state.answers).length !== 4 || !document.querySelector('#case-notes').value.includes('QA only')) throw new Error('Reload did not restore the draft');
  const originalFetch = window.fetch;
  const calls = [];
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (args[0] === '/api/submissions') calls.push({status: response.status, receipt: await response.clone().json()});
    return response;
  };
  document.querySelector('#submit').click();
  const deadline = Date.now() + 10000;
  while (document.querySelector('#submit').disabled && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
  if (calls.length !== 1 || calls[0].status !== 201 || !document.querySelector('#notice').textContent.startsWith('Saved to the shared library:')) throw new Error('First server save failed');
  document.querySelector('#submit').click();
  while (document.querySelector('#submit').disabled && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
  if (calls.length !== 2 || calls[1].status !== 200 || calls[0].receipt.id !== calls[1].receipt.id) throw new Error('Retry was not idempotent');
  window.fetch = originalFetch;
  return {calls, notice: document.querySelector('#notice').textContent, restoredNotes: document.querySelector('#case-notes').value};
})()
