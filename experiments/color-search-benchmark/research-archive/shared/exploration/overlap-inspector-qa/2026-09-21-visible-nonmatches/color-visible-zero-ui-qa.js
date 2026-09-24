(async () => {
  const $ = id => document.getElementById(id), checks = [], captures = [];
  const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await sleep(20); } throw Error('UI did not settle'); };
  const change = (id, value) => { $(id).value = String(value); $(id).dispatchEvent(new Event('change')); };
  const close = () => { if ($('color-dialog').open) $('close-color-dialog').click(); if ($('inspector').open) $('close-inspector').click(); };
  await wait(() => document.querySelector('.result-card') && !$('search').disabled);
  for (const count of [16, 64, 256, 1024]) {
    close(); change('bucket-count', count); $('query-form').requestSubmit(); await wait(() => !$('search').disabled);
    document.querySelector('.result-card').click(); await wait(() => !$('inspection-content').hidden);
    $('bin-grid').querySelector('[data-index="4"]').click(); await wait(() => $('matching-grid'));
    for (const axis of ['lightness', 'saturation']) {
      $(`color-tab-${axis}`).click(); const cells = [...$('matching-grid').querySelectorAll('.matching-cell')];
      const zeros = cells.filter(cell => cell.dataset.matches === 'false'), matches = cells.filter(cell => cell.dataset.matches === 'true');
      check(`${count}/${axis}: full reference color plane`, cells.length === (axis === 'lightness' ? 1533 : 1513));
      check(`${count}/${axis}: nonmatches have visible full-opacity tiny colors`, zeros.length > 100 && zeros.every(cell => cell.firstChild.style.transform === 'scale(0.2)' && getComputedStyle(cell.firstChild).opacity === '1'));
      check(`${count}/${axis}: every matching swatch remains larger`, matches.length > 0 && matches.every(cell => Number(cell.dataset.quality) >= .5 && Number(cell.firstChild.style.transform.slice(6, -1)) >= .5));
      check(`${count}/${axis}: exact anchor retains full size`, $('matching-grid').querySelector('.is-anchor').firstChild.style.transform === 'scale(1)');
      const colorful = zeros.find(cell => cell.dataset.hex !== '#000000' && cell.dataset.hex !== '#ffffff'); colorful.click();
      check(`${count}/${axis}: zero swatch is clickable and explicitly does not count`, $('matching-sample-detail').textContent.includes('Does not count') && $('matching-sample-detail').dataset.quality === '0' && $('matching-sample-detail').dataset.hex === colorful.dataset.hex);
      check(`${count}/${axis}: detail strip preserves nonmatch visibility`, [...$('matching-cell-strip').children].some(cell => cell.dataset.matches === 'false' && cell.firstChild.style.transform === 'scale(0.2)'));
      check(`${count}/${axis}: legend describes zero floor`, document.querySelector('.matching-legend').textContent.includes('Does not count'));
      captures.push({count,axis,cells:cells.length,nonmatching:zeros.length,matching:matches.length});
    }
  }
  $('color-tab-lightness').click();
  check('no overflow outside intended wide grid', $('color-dialog').querySelector('.dialog-content').scrollWidth <= $('color-dialog').querySelector('.dialog-content').clientWidth);
  return {status:'passed',checksPassed:checks.length,checks,captures};
})()
