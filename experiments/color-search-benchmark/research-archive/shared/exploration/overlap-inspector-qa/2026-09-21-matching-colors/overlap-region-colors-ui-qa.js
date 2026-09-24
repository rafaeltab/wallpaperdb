(async () => {
  const $ = id => document.getElementById(id), checks = [], requests = [], palettes = [];
  const check = (label, ok) => { if (!ok) throw Error(label); checks.push(label); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let i = 0; i < 250; i++) { if (predicate()) return; await sleep(20); } throw Error('UI did not settle: ' + $('matching-status')?.textContent); };
  const nativeFetch = window.fetch.bind(window); let delayRegion = null, inspections = [];
  window.fetch = async (url, options) => {
    requests.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null });
    const delayed = String(url).startsWith(`/api/region-colors?regionIndex=${delayRegion}&`);
    const response = await nativeFetch(url, delayed ? { ...options, signal: undefined } : options);
    if (url === '/api/inspect' && response.ok) inspections.push(await response.clone().json());
    if (delayed) await sleep(450);
    return response;
  };
  const change = (id, value, type = 'change') => { $(id).value = String(value); $(id).dispatchEvent(new Event(type)); };
  const ready = async index => wait(() => $('matching-grid')?.dataset.regionIndex === String(index));
  const samples = () => [...document.querySelectorAll('.matching-cell')];
  const selectBin = async index => { $ ('bin-grid').querySelector(`[data-index="${index}"]`).click(); await ready(index); };
  const inspect = async () => { document.querySelector('.result-card').click(); await wait(() => !$('inspection-content').hidden && $('matching-grid')); return inspections.at(-1); };
  const searches = () => requests.filter(request => request.url === '/api/search').length;
  try {
    if ($('inspector').open) $('close-inspector').click();
    for (const count of [16, 64, 256, 1024]) {
      change('bucket-count', count); $('query-form').requestSubmit(); await wait(() => !$('search').disabled);
      const diagnosis = await inspect();
      check(`${count}: matching colors use executed bucket count`, $('matching-grid').dataset.bucketCount === String(count));
      const before = searches();
      const sparse = diagnosis.regions.find(region => region.index >= count)?.index ?? 500;
      for (const index of [4, 0, 7, sparse]) {
        await selectBin(index); const region = diagnosis.regions.find(region => region.index === index), cells = samples();
        const anchor = cells.find(cell => cell.classList.contains('is-anchor'));
        check(`${count}/${index}: exact anchor with 100% quality`, anchor?.dataset.hex === region.hex && +anchor.dataset.quality === 1);
        check(`${count}/${index}: bounded accepted samples include weaker matches`, cells.length > 1 && cells.length <= 1024 && cells.every(cell => +cell.dataset.quality >= .5 && +cell.dataset.quality <= 1) && cells.some(cell => +cell.dataset.quality < .6));
        check(`${count}/${index}: original colors preserved with proportional sizes`, cells.every(cell => Math.abs(Number(cell.firstChild.style.transform.slice(6, -1)) - Number(cell.dataset.quality)) < 1e-6 && getComputedStyle(cell.firstChild).opacity === '1'));
        const side = getComputedStyle($('matching-grid')).gridTemplateColumns.split(' ').length, children = [...$('matching-grid').children];
        check(`${count}/${index}: hue columns are dark to light`, children.every((cell, i) => !cell.dataset.lightness || i < side || !children[i - side].dataset.lightness || +cell.dataset.lightness >= +children[i - side].dataset.lightness));
        const weakest = [...cells].sort((a, b) => +a.dataset.quality - +b.dataset.quality)[0]; weakest.click();
        check(`${count}/${index}: tap exposes exact color and quality`, $('matching-sample-detail').dataset.hex === weakest.dataset.hex && $('matching-sample-detail').dataset.quality === weakest.dataset.quality);
        anchor.focus(); const anchorPosition = children.indexOf(anchor), next = anchorPosition + side;
        if (children[next]?.classList.contains('matching-cell')) {
          anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
          check(`${count}/${index}: arrow follows visible column`, document.activeElement === children[next]);
        }
        palettes.push({ count, index, samples: cells.length, lowestQuality: +weakest.dataset.quality });
      }
      const empty = diagnosis.regions.find(region => region.coverage === 0);
      if (empty) { await selectBin(empty.index); check(`${count}: empty wallpaper region still shows accepted colors`, samples().length > 0 && $('matching-status').textContent.includes('not the colors present')); }
      check(`${count}: bin selection never searches or reranks wallpapers`, searches() === before);
      check(`${count}: no horizontal overflow in dialog`, $('inspector').querySelector('.dialog-content').scrollWidth <= $('inspector').querySelector('.dialog-content').clientWidth);
      $('close-inspector').click();
    }
    change('minimum-quality', 90, 'input'); change('quality-influence', 2, 'input');
    $('query-form').requestSubmit(); await wait(() => !$('search').disabled); await inspect(); await selectBin(4);
    check('90% average cutoff does not remove low-quality color examples', samples().some(cell => +cell.dataset.quality < .6) && $('matching-colors').textContent.includes('wallpaper’s average quality'));
    delayRegion = 0; $('bin-grid').querySelector('[data-index="0"]').click(); await sleep(30);
    await selectBin(7); await sleep(550);
    check('late response cannot replace newer bin palette', $('matching-grid').dataset.regionIndex === '7' && $('matching-grid').querySelector('.is-anchor').dataset.hex === '#ffffff');
    $('bin-grid').querySelector('[data-index="0"]').click(); await sleep(30); $('close-inspector').click();
    change('bucket-count', 16); await inspect(); await ready(4); await sleep(550);
    check('reopened old result retains executed bank and ignores closed request', $('matching-grid').dataset.bucketCount === '1024' && $('matching-grid').dataset.regionIndex === '4');
    check('desktop page has no horizontal overflow', document.documentElement.scrollWidth <= innerWidth);
    $('bin-grid').scrollIntoView({ block: 'start' });
    return { status: 'passed', checksPassed: checks.length, checks, palettes, requests };
  } finally { window.fetch = nativeFetch; }
})()
