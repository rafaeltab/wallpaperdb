(async () => {
  const checks = [], $ = id => document.getElementById(id);
  const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); };
  const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('UI did not settle'); };
  const choose = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change')); };
  const cells = () => [...$('bin-grid').children];
  const scale = cell => Number(cell.firstChild.style.transform.match(/scale\((.+)\)/)[1]);
  const baseline = cells().map(c => c.dataset.index);
  const inspect = async (method, preset) => {
    $('close-inspector').click(); choose('method', method); choose('preset', preset);
    $('query-form').requestSubmit();
    await wait(() => !$('search').disabled);
    check(`${method} search succeeded`, !$('search-status').classList.contains('error'));
    document.querySelector('.result-card').click();
    await wait(() => !$('inspection-content').hidden);
  };
  await inspect('overlap-quality-hybrid', '1');
  check('named hybrid score remains positive', JSON.parse($('formula-json').textContent).score.actual > 0);
  check('named-only query correctly shrinks every dense region', cells().every(c => +c.dataset.contribution === 0 && scale(c) === .22));
  check('named-only legend explains separate score fields', $('grid-legend').textContent.includes('broad named feature contributes'));
  check('different wallpaper keeps the same atlas positions', JSON.stringify(baseline) === JSON.stringify(cells().map(c => c.dataset.index)));
  await inspect('overlap-quality-dense', '4');
  const ledger = JSON.parse($('formula-json').textContent).score;
  check('two target regions remain outlined', cells().filter(c => c.classList.contains('is-used')).length === 2);
  const max = Math.max(...cells().map(c => +c.dataset.contribution));
  check('multi-target swatch sizes follow the score ledger', cells().every(c => Math.abs(scale(c) - (.22 + .78 * Math.sqrt(+c.dataset.contribution / max))) < 1e-6));
  check('shown contributions sum to the service ledger', Math.abs(cells().reduce((sum, c) => sum + Number(c.dataset.contribution), 0) - ledger.reconstructed) < 1e-12);
  check('multi-target query keeps atlas positions', JSON.stringify(baseline) === JSON.stringify(cells().map(c => c.dataset.index)));
  choose('grid-metric', 'coverage');
  return { checksPassed: checks.length, checks };
})()
