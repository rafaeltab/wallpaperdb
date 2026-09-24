(() => {
  const byId = id => document.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (condition, message) => {
    const until = Date.now() + 20000;
    while (!condition()) {
      if (Date.now() > until) throw Error(message + ': ' + byId('search-status').textContent + ' / ' + byId('inspection-status').textContent);
      await pause(30);
    }
  };
  const change = (id, value, type = 'change') => { byId(id).value = String(value); byId(id).dispatchEvent(new Event(type, { bubbles: true })); };
  const levels = [0, .25, .5, .75, .9];
  const expected = exponent => {
    const raw = levels.map(level => Math.exp(exponent * (level / .9 - 1)));
    const total = raw.reduce((sum, value) => sum + value, 0);
    return raw.map(value => value / total);
  };
  const weightsMatch = (components, exponent, context) => {
    assert(components.length === 5, context + ': every cutoff must participate');
    const weights = expected(exponent);
    components.forEach((component, index) => {
      assert((component.pixelCutoff ?? component.cutoff) === levels[index], context + ': wrong cutoff');
      const weight = component.componentWeight ?? component.scoreWeight ?? component.weight;
      assert(weight > 0, context + ': zero cutoff weight');
      assert(Math.abs(weight - weights[index]) < 1e-10, context + ': incorrect weight');
    });
  };
  const ledger = () => JSON.parse(byId('formula-json').textContent);
  const close = () => { if (byId('color-dialog').open) byId('close-color-dialog').click(); if (byId('inspector').open) byId('close-inspector').click(); };
  const setLive = enabled => { byId('live-update').checked = enabled; byId('live-update').dispatchEvent(new Event('change', { bubbles: true })); };
  window.allCutoffsQA = { matrix: [], checks: [], api: [], errors: [], startedAt: new Date().toISOString() };
  window.addEventListener('error', event => window.allCutoffsQA.errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', event => window.allCutoffsQA.errors.push(String(event.reason)));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, options = {}) => {
    const route = String(url), entry = { route, request: options.body ? JSON.parse(options.body) : null };
    if (route.startsWith('/api/')) window.allCutoffsQA.api.push(entry);
    try {
      const response = await originalFetch(url, options); entry.status = response.status;
      if (route.startsWith('/api/region-colors')) {
        const data = await response.clone().json();
        entry.definition = data.definition;
        entry.anchorComponents = data.samples?.find(sample => sample.isAnchor)?.components;
      }
      return response;
    } catch (error) { entry.error = error.name; throw error; }
  };
  setLive(false);
  assert([...byId('method').options].some(option => option.value === 'cutoff-all-levels'), 'All-cutoff method missing');
  assert(byId('cutoff-blend-exponent').value === '0', 'Blend should default to equal weights');
  window.allCutoffsRunBank = async count => {
    const rows = [];
    for (const exponent of [0, 3, 6]) {
      close();
      change('method', 'cutoff-all-levels'); change('bucket-count', count);
      change('quality-curve', 'power'); change('quality-influence', 1, 'input'); change('minimum-quality', 0, 'input');
      change('cutoff-blend-exponent', exponent, 'input');
      assert(!byId('cutoff-blend-controls').hidden, 'Blend controls hidden');
      assert(byId('pixel-cutoff-field').hidden && byId('pixel-cutoff').disabled, 'Single cutoff remains enabled');
      const preview = [...byId('cutoff-blend-weights').children].map(row => ({ cutoff: Number(row.dataset.cutoff), weight: Number(row.dataset.weight) }));
      weightsMatch(preview, exponent, 'live preview');
      byId('query-form').requestSubmit();
      await wait(() => !byId('search').disabled && byId('search-status').className !== 'error', 'All-cutoff search failed');
      assert(byId('method-tag').textContent === 'cutoff-all-levels', 'Wrong executed method');
      const caption = byId('query-caption').textContent;
      assert(caption.includes('weighting ' + exponent.toFixed(1)), 'Executed caption exponent mismatch');
      const cards = [...document.querySelectorAll('#gallery .result-card')];
      assert(cards.length === 24, 'Expected 24 real wallpaper results');
      const changedExponent = exponent === 6 ? 0 : 6;
      change('cutoff-blend-exponent', changedExponent, 'input');
      assert(byId('query-caption').textContent === caption, 'Edited slider mutated executed caption');
      cards[0].click();
      await wait(() => !byId('inspection-content').hidden, 'All-cutoff inspection failed');
      const data = ledger();
      assert(data.parameters.cutoffBlendExponent === exponent, 'Inspection used current slider instead of saved exponent');
      assert(data.parameters.bucketCount === count, 'Incorrect bucket count');
      assert(data.parameters.pixelCutoff === 0, 'All-level cutoff was not canonicalized to zero');
      assert(Math.abs(data.score.difference) < .00001, 'OpenSearch and ledger scores disagree');
      const term = data.score.terms.find(term => term.regionIndex != null);
      assert(term?.summaryOnly, 'Expected independent cutoff score components');
      weightsMatch(term.components, exponent, 'score ledger');
      assert(document.querySelectorAll('#bin-grid .bin-cell').length === count, 'Wrong visible bin count');
      const row = { count, exponent, score: data.score.actual, difference: data.score.difference,
        weights: term.components.map(component => ({ cutoff: component.pixelCutoff, weight: component.componentWeight, score: component.scoreContribution })),
        savedExponentPreserved: true, previewMatchesBackend: true };
      if (exponent === 6) {
        document.querySelector('#bin-grid .bin-cell[aria-pressed="true"]').click();
        await wait(() => document.querySelector('#matching-grid') && !byId('matching-status').classList.contains('error'), 'Membership modal failed');
        const api = window.allCutoffsQA.api.findLast(entry => entry.route.startsWith('/api/region-colors'));
        const params = new URL(api.route, location.href).searchParams;
        assert(params.get('profile') === 'all-levels', 'Wrong membership profile');
        assert(Number(params.get('cutoffBlendExponent')) === exponent, 'Membership used edited exponent instead of executed one');
        weightsMatch(api.anchorComponents, exponent, 'membership API');
        const nonmatches = [...document.querySelectorAll('#matching-grid .matching-cell[data-matches="false"]')];
        assert(nonmatches.length > 0, 'Expected excluded context colors');
        assert(nonmatches.every(node => node.querySelector('.matching-swatch').style.transform === 'scale(0.2)'), 'Nonmatches must remain tiny and visible');
        byId('color-tab-saturation').click();
        assert(document.querySelector('#matching-grid').dataset.axis === 'saturation', 'Saturation tab did not update');
        row.membership = { savedExponentPreserved: true, weightsMatchBackend: true, tinyNonmatches: nonmatches.length, saturationTab: true };
      }
      window.allCutoffsQA.matrix.push(row); rows.push(row); close();
    }
    return rows;
  };
  window.allCutoffsFinish = async () => {
    close();
    change('bucket-count', 16); change('method', 'cutoff-all-levels');
    setLive(true);
    for (const value of [0, 6, 1.5, 4.2]) change('cutoff-blend-exponent', value, 'input');
    await wait(() => !byId('search').disabled && byId('cancel-search').hidden && byId('query-caption').textContent.includes('weighting 4.2') && byId('query-caption').textContent.includes('16 buckets'), 'Final live exponent did not win');
    setLive(false);
    document.querySelector('#gallery .result-card').click();
    await wait(() => !byId('inspection-content').hidden, 'Live inspection failed');
    assert(ledger().parameters.cutoffBlendExponent === 4.2, 'Live result used old blend');
    close(); window.allCutoffsQA.checks.push('Rapid live changes keep only the final 4.2 blend and saved inspection agrees.');
    for (const method of ['cutoff-consensus', 'overlap-quality-dense']) {
      change('method', method);
      assert(byId('cutoff-blend-controls').hidden, 'Blend controls visible for legacy method');
      if (method === 'cutoff-consensus') assert(!byId('pixel-cutoff-field').hidden && !byId('pixel-cutoff').disabled, 'Legacy cutoff selector did not return');
      byId('query-form').requestSubmit();
      await wait(() => !byId('search').disabled && byId('search-status').className !== 'error', 'Legacy switch failed');
      const request = window.allCutoffsQA.api.findLast(entry => entry.route === '/api/search').request;
      assert(!Object.hasOwn(request.parameters, 'cutoffBlendExponent'), 'Blend exponent leaked into legacy query');
      assert(!byId('query-caption').textContent.includes('all five cutoffs'), 'Legacy caption retained all-level weights');
    }
    window.allCutoffsQA.checks.push('Both existing Multiple cutoffs and Original dense still search without unsupported exponent parameters.');
    change('method', 'cutoff-all-levels'); change('bucket-count', 256); change('cutoff-blend-exponent', 6, 'input');
    byId('query-form').requestSubmit();
    await wait(() => !byId('search').disabled && byId('search-status').className !== 'error', 'Final visual search failed');
    assert(window.allCutoffsQA.errors.length === 0, 'Browser errors occurred');
    window.allCutoffsQA.finishedAt = new Date().toISOString();
    return window.allCutoffsQA;
  };
  return 'All-cutoffs browser checks ready; no searches have been started by this setup.';
})()
