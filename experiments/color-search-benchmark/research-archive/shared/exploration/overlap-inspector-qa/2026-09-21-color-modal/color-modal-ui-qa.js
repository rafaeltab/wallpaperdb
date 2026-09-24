(async () => {
  const $ = id => document.getElementById(id), checks = [], requests = [], samples = [], inspections = [];
  const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let i = 0; i < 250; i++) { if (predicate()) return; await sleep(20); } throw Error('UI did not settle: ' + $('matching-status').textContent); };
  const nativeFetch = window.fetch.bind(window); let delayedRegion = null;
  window.fetch = async (url, options) => {
    requests.push(String(url)); const delayed = String(url).startsWith(`/api/region-colors?regionIndex=${delayedRegion}&`);
    const response = await nativeFetch(url, delayed ? { ...options, signal: undefined } : options);
    if (url === '/api/inspect' && response.ok) inspections.push(await response.clone().json());
    if (String(url).startsWith('/api/region-colors') && response.ok) samples.push(await response.clone().json());
    if (delayed) await sleep(400); return response;
  };
  const colorRequests = () => requests.filter(url => url.startsWith('/api/region-colors')).length;
  const searchCount = () => requests.filter(url => url === '/api/search').length;
  const change = (id, value) => { $(id).value = String(value); $(id).dispatchEvent(new Event('change')); };
  const open = async index => { $('bin-grid').querySelector(`[data-index="${index}"]`).click(); await wait(() => $('matching-grid')?.dataset.regionIndex === String(index)); };
  try {
    await wait(() => document.querySelector('.result-card') && !$('search').disabled);
    for (const count of [16, 64, 256, 1024]) {
      if ($('color-dialog').open) $('close-color-dialog').click(); if ($('inspector').open) $('close-inspector').click();
      change('bucket-count', count); $('query-form').requestSubmit(); await wait(() => !$('search').disabled);
      document.querySelector('.result-card').click(); await wait(() => !$('inspection-content').hidden);
      check(`${count}: palette moved out of wallpaper details`, !$('bin-detail').querySelector('.matching-grid') && !$('color-dialog').open);
      const searchBefore = searchCount(); await open(4);
      check(`${count}: clicking bin opens separate modal above inspector`, $('color-dialog').open && $('inspector').open);
      check(`${count}: saved count and correct region`, $('matching-grid').dataset.bucketCount === String(count) && $('matching-grid').dataset.regionIndex === '4');
      const input = samples.at(-1), fetched = colorRequests();
      let priorLayout;
      for (const axis of ['lightness', 'saturation']) {
        $(`color-tab-${axis}`).click(); const grid = $('matching-grid'), cells = [...grid.querySelectorAll('.matching-cell')], rect = grid.getBoundingClientRect();
        check(`${count}/${axis}: wide 73-column by 21-row coordinate grid`, grid.dataset.columns === '73' && grid.dataset.rows === '21' && rect.width / rect.height > 3);
        check(`${count}/${axis}: all accepted samples retained in cells`, cells.reduce((total, cell) => total + Number(cell.dataset.sampleCount), 0) === input.samples.length);
        check(`${count}/${axis}: tab semantics follow selected axis`, $(`color-tab-${axis}`).getAttribute('aria-selected') === 'true' && $('matching-panel').getAttribute('aria-labelledby') === `color-tab-${axis}` && grid.dataset.axis === axis);
        const anchor = cells.find(cell => cell.classList.contains('is-anchor'));
        check(`${count}/${axis}: anchor exact and quality unchanged`, anchor?.dataset.hex === '#ff0000' && Number(anchor.dataset.quality) === 1);
        check(`${count}/${axis}: correct red HSL coordinates`, anchor.dataset.column === '36' && anchor.dataset.row === (axis === 'lightness' ? '10' : '20'));
        const populous = [...cells].sort((a, b) => Number(b.dataset.sampleCount) - Number(a.dataset.sampleCount))[0]; populous.click();
        check(`${count}/${axis}: every color in selected cell is inspectable`, $('matching-cell-strip').children.length === Number(populous.dataset.sampleCount));
        const swatch = $('matching-cell-strip').lastElementChild; swatch.click();
        check(`${count}/${axis}: sample tap shows exact quality and color`, $('matching-sample-detail').dataset.hex === swatch.dataset.hex && $('matching-sample-detail').dataset.quality === swatch.dataset.quality);
        const layout = cells.map(cell => [cell.dataset.hex, cell.dataset.row, cell.dataset.column]);
        if (priorLayout) check(`${count}: axes produce different arrangements`, JSON.stringify(layout) !== JSON.stringify(priorLayout)); priorLayout = layout;
      }
      check(`${count}: switching tabs requires no service requests`, colorRequests() === fetched);
      $('color-tab-saturation').focus(); $('color-tab-saturation').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      check(`${count}: keyboard switches tabs and moves focus`, document.activeElement === $('color-tab-lightness') && $('matching-grid').dataset.axis === 'lightness');
      const active = $('matching-grid').querySelector('.is-anchor'); active.focus(); active.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      check(`${count}: grid keyboard skips empty cells within row`, document.activeElement.dataset.row === active.dataset.row && Number(document.activeElement.dataset.column) < Number(active.dataset.column));
      $('close-color-dialog').click();
      check(`${count}: closing child keeps parent and restores bin focus`, !$('color-dialog').open && $('inspector').open && document.activeElement === $('bin-grid').querySelector('[data-index="4"]'));
      await open(0); check(`${count}: black uses separate no-hue column`, $('matching-grid').querySelector('.is-anchor').dataset.column === '72');
      $('color-tab-saturation').click();
      const blackCells = [...$('matching-grid').querySelectorAll('.matching-cell')], visited = new Set();
      blackCells[0].focus();
      for (let i = 0; i < blackCells.length; i++) { visited.add(document.activeElement); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); }
      check(`${count}: keyboard can reach every black-bin saturation cell including detached gray anchor`, visited.size === blackCells.length);
      $('color-tab-lightness').click();
      $('color-dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
      check(`${count}: Escape handler closes only color modal`, !$('color-dialog').open && $('inspector').open);
      await open(7); check(`${count}: white retains exact anchor at full lightness`, $('matching-grid').querySelector('.is-anchor').dataset.row === '20'); $('close-color-dialog').click();
      const sparse = inspections.at(-1).regions.find(region => region.index >= count)?.index;
      if (sparse !== undefined) { await open(sparse); check(`${count}: sparse original ID resolves correctly`, $('matching-grid').dataset.regionIndex === String(sparse)); $('close-color-dialog').click(); }
      check(`${count}: modal exploration never reranks wallpapers`, searchCount() === searchBefore);
    }
    delayedRegion = 0; $('bin-grid').querySelector('[data-index="0"]').click(); await sleep(30); $('close-color-dialog').click(); await open(7); await sleep(500);
    check('late response cannot repaint reopened modal', $('matching-grid').dataset.regionIndex === '7');
    $('close-color-dialog').click(); await open(4);
    check('desktop modal has no horizontal overflow outside scroll region', $('color-dialog').querySelector('.dialog-content').scrollWidth <= $('color-dialog').querySelector('.dialog-content').clientWidth);
    check('page has no horizontal overflow', document.documentElement.scrollWidth <= innerWidth);
    return {status:'passed',checksPassed:checks.length,checks,requests};
  } finally { window.fetch = nativeFetch; }
})()
