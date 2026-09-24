(async () => {
  const $ = id => document.getElementById(id), checks = [], requests = [];
  const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let n = 0; n < 240; n++) { if (predicate()) return; await sleep(25); } throw Error('UI did not settle'); };
  const nativeFetch = window.fetch.bind(window);
  let delayNext = false, delayedReleased = false;
  window.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (String(url).startsWith('/api/')) requests.push({ url, body, at: performance.now() });
    if (url === '/api/search' && delayNext) {
      delayNext = false;
      const response = await nativeFetch(url, { ...options, signal: undefined });
      await sleep(850); delayedReleased = true; return response;
    }
    return nativeFetch(url, options);
  };
  const searches = () => requests.filter(r => r.url === '/api/search');
  const input = (id, value) => { $(id).value = String(value); $(id).dispatchEvent(new Event('input')); };
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change')); };
  const toggle = (id, value) => { $(id).checked = value; $(id).dispatchEvent(new Event('change')); };
  const settled = async count => { await wait(() => searches().length >= count && !$('search').disabled); check('query completed without an error', !$('search-status').classList.contains('error')); };
  const initial = [...document.querySelectorAll('.result-card')].map(c => c.getAttribute('aria-label'));
  try {
    check('default quality and manual mode retained', $('quality-influence').value === '1' && !$('live-update').checked);
    input('quality-influence', 2); await sleep(450);
    check('manual slider edits do not search', searches().length === 0 && $('quality-value').value === '2.00×');
    document.querySelector('.result-card').click(); await wait(() => !$('inspection-content').hidden);
    const inspected = requests.find(r => r.url === '/api/inspect');
    check('inspection retains original result parameters after slider edit', inspected.body.parameters.qualityInfluence === 1 && JSON.parse($('formula-json').textContent).parameters.qualityInfluence === 1);
    $('close-inspector').click(); $('query-form').requestSubmit(); await settled(1);
    check('manual search submits quality influence', searches().at(-1).body.parameters.qualityInfluence === 2 && $('query-caption').textContent.includes('2.00×'));
    check('OpenSearch result scores or ordering change', JSON.stringify(initial) !== JSON.stringify([...document.querySelectorAll('.result-card')].map(c => c.getAttribute('aria-label'))));
    $('reset-quality').click();
    check('reset returns to original quality', $('quality-influence').value === '1' && $('reset-quality').disabled);
    const beforeLive = searches().length;
    toggle('live-update', true);
    for (const value of [.3, .7, 1.1, 2.4]) { input('quality-influence', value); await sleep(20); }
    const lastEdit = performance.now();
    await settled(beforeLive + 1); await sleep(100);
    check('slider burst debounces to one real search', searches().length === beforeLive + 1 && searches().at(-1).body.parameters.qualityInfluence === 2.4);
    check('live update waits for adjustment pause', searches().at(-1).at - lastEdit >= 300);
    let count = searches().length;
    change('preset', '2'); await settled(count + 1);
    check('presets update live', searches().at(-1).body.query.targets[0].name === 'green' && searches().at(-1).body.query.mode === 'proportions');
    count = searches().length;
    const amount = document.querySelector('.portion-input'); amount.value = '30'; amount.dispatchEvent(new Event('input')); await settled(count + 1);
    check('percentage edits update live', searches().at(-1).body.query.targets[0].percent === 30);
    count = searches().length;
    const hex = document.querySelector('.swatch-row input[type=text]'); hex.value = '#'; hex.dispatchEvent(new Event('input')); await sleep(450);
    check('invalid color pauses live requests', searches().length === count && $('search-status').textContent.startsWith('Live update paused'));
    hex.value = '#20b8d0'; hex.dispatchEvent(new Event('input')); await settled(count + 1);
    check('valid hex resumes live search', searches().at(-1).body.query.targets[0].color === '#20b8d0');
    count = searches().length;
    toggle('use-json', true); input('query-json', '{'); await sleep(450);
    check('invalid advanced JSON does not search', searches().length === count);
    input('query-json', JSON.stringify({ mode: 'vibe', targets: [{ name: 'dark', color: '#101010' }] })); await settled(count + 1);
    check('valid advanced query updates live', searches().at(-1).body.query.targets[0].name === 'dark');
    count = searches().length;
    input('quality-influence', 1.7); toggle('live-update', false); await sleep(450);
    check('turning live off cancels queued search', searches().length === count);
    input('quality-influence', 1.8); await sleep(450);
    check('manual mode remains manual after live off', searches().length === count);
    toggle('live-update', true); await settled(count + 1);
    count = searches().length; delayNext = true; input('quality-influence', 2.85);
    await wait(() => searches().length === count + 1);
    input('quality-influence', 1.25); await settled(count + 2);
    await wait(() => delayedReleased); await sleep(50);
    check('late superseded response cannot replace current results', $('query-caption').textContent.includes('1.25×'));
    toggle('live-update', false);
    check('desktop controls fit horizontally', document.documentElement.scrollWidth <= innerWidth);
    return { status: 'passed', checksPassed: checks.length, checks, requests: requests.map(({ url, body }) => ({ url, body })) };
  } finally { window.fetch = nativeFetch; }
})()
