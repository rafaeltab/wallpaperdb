(async () => {
  const $ = id => document.getElementById(id), checks = [], requests = [], inspections = [];
  const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let n = 0; n < 300; n++) { if (predicate()) return; await sleep(20); } throw Error('UI did not settle'); };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    if (String(url).startsWith('/api/')) requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
    const result = await nativeFetch(url, options);
    if (url === '/api/inspect' && result.ok) inspections.push(await result.clone().json());
    return result;
  };
  const searches = () => requests.filter(r => r.url === '/api/search');
  const input = (id, value) => { $(id).value = String(value); $(id).dispatchEvent(new Event('input')); };
  const change = (id, value) => { $(id).value = String(value); $(id).dispatchEvent(new Event('change')); };
  const toggle = (id, value) => { $(id).checked = value; $(id).dispatchEvent(new Event('change')); };
  const settled = async count => { await wait(() => searches().length >= count && !$('search').disabled); check('search succeeds', !$('search-status').classList.contains('error')); };
  const inspect = async () => { document.querySelector('.result-card').click(); await wait(() => !$('inspection-content').hidden); return inspections.at(-1); };
  const summaries = [];
  try {
    check('all four choices available with original default', JSON.stringify([...$('bucket-count').options].map(option => +option.value)) === '[16,64,256,1024]' && $('bucket-count').value === '1024');
    change('bucket-count', 16); await sleep(400);
    check('manual count edit does not search', searches().length === 0);
    let diagnosis = await inspect();
    check('old result keeps 1024 buckets after editing count', diagnosis.parameters.bucketCount === 1024 && document.querySelectorAll('.bin-cell').length === 1024);
    $('close-inspector').click();
    input('quality-influence', 1.75); input('minimum-quality', 65);
    for (const count of [16, 64, 256, 1024]) {
      change('bucket-count', count); const before = searches().length; $('query-form').requestSubmit(); await settled(before + 1);
      const submitted = searches().at(-1).body.parameters;
      check(`${count}: quality settings retained`, submitted.bucketCount === count && submitted.qualityInfluence === 1.75 && submitted.minimumQuality === .65);
      check(`${count}: result caption records count`, $('query-caption').textContent.includes(`${count.toLocaleString()} buckets`));
      diagnosis = await inspect();
      const cells = () => [...$('bin-grid').children], side = Math.sqrt(count);
      check(`${count}: matching physical index`, diagnosis.evidence.index === (count === 1024 ? 'color-exploration-overlap-real-v1' : `color-exploration-overlap-${count}-real-v1`));
      check(`${count}: full correct grid`, cells().length === count && new Set(cells().map(c => c.dataset.index)).size === count && diagnosis.regions.length === count);
      check(`${count}: matching row width and title`, getComputedStyle($('bin-grid')).gridTemplateColumns.split(' ').length === side && $('bin-heading').textContent.includes(count.toLocaleString()));
      check(`${count}: score ledger parity`, Math.abs(diagnosis.score.difference) < 2e-6);
      const press = (position, key) => { const cell = cells()[position]; cell.click(); cell.focus(); cell.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); return cells().indexOf(document.activeElement); };
      check(`${count}: keyboard follows visual rows`, press(1, 'ArrowDown') === side + 1 && press(1, 'ArrowUp') === 1 && press(count - 2, 'ArrowDown') === count - 2);
      const chosen = cells().find(cell => +cell.dataset.index >= count) ?? cells()[2]; chosen.click();
      check(`${count}: original region IDs select correct detail`, $('bin-detail').querySelector('h4').textContent.startsWith(`Region ${chosen.dataset.index} ·`));
      check(`${count}: zero-contribution cells shrink`, cells().filter(cell => +cell.dataset.contribution === 0).every(cell => cell.firstChild.style.transform === 'scale(0.22)'));
      const byId = new Map(diagnosis.regions.map(region => [region.index, region]));
      check(`${count}: each hue column runs dark to light`, cells().every((cell, position, all) => position < side || byId.get(+cell.dataset.index).lab[0] >= byId.get(+all[position - side].dataset.index).lab[0]));
      summaries.push({ count, index: diagnosis.evidence.index, wallpaper: diagnosis.id, score: diagnosis.score.actual, regions: diagnosis.regions.map(region => region.index) });
      $('close-inspector').click();
    }
    const beforeLive = searches().length; toggle('live-update', true);
    for (const count of [16, 64, 256]) { change('bucket-count', count); await sleep(20); }
    await settled(beforeLive + 1); await sleep(100);
    check('rapid count switching is debounced', searches().length === beforeLive + 1 && searches().at(-1).body.parameters.bucketCount === 256);
    check('live count switching retains both quality controls', $('quality-influence').value === '1.75' && $('minimum-quality').value === '65');
    const latest = searches().length; change('bucket-count', 64); toggle('live-update', false); await sleep(400);
    check('live off cancels pending count switch', searches().length === latest);
    diagnosis = await inspect();
    check('inspection uses last executed count after canceled switch', diagnosis.parameters.bucketCount === 256 && document.querySelectorAll('.bin-cell').length === 256);
    $('close-inspector').click();
    check('desktop has no horizontal overflow', document.documentElement.scrollWidth <= innerWidth);
    return { status: 'passed', checksPassed: checks.length, checks, summaries, requests };
  } finally { window.fetch = nativeFetch; }
})()
