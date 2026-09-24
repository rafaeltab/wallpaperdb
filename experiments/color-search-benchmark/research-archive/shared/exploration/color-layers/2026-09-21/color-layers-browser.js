(() => {
  const $ = id => document.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (condition, message) => { const until = Date.now() + 20000; while (!condition()) { if (Date.now() > until) throw Error(message + ': ' + $('matching-status').textContent + ' / ' + $('search-status').textContent); await pause(20); } };
  const change = (id, value, type = 'change') => { $(id).value = String(value); $(id).dispatchEvent(new Event(type, { bubbles: true })); };
  const close = () => { if ($('color-dialog').open) $('close-color-dialog').click(); if ($('inspector').open) $('close-inspector').click(); };
  const grid = () => $('matching-grid');
  const ledger = () => JSON.parse($('formula-json').textContent);
  const levels = [0, .25, .5, .75, .9];
  const layers = ['combined', 'cutoff-0', 'cutoff-25', 'cutoff-50', 'cutoff-75', 'cutoff-90'];
  window.colorLayersQA = { matrix: [], legacy: [], checks: [], requests: [], errors: [], startedAt: new Date().toISOString() };
  window.addEventListener('error', event => window.colorLayersQA.errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', event => window.colorLayersQA.errors.push(String(event.reason)));
  window.colorLayersDelay = null; window.colorLayersFailOnce = false;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, options = {}) => {
    const route = String(url), entry = { route, request: options.body ? JSON.parse(options.body) : undefined };
    if (route.startsWith('/api/')) window.colorLayersQA.requests.push(entry);
    const params = new URL(route, location.href).searchParams;
    const delay = window.colorLayersDelay && route.startsWith('/api/region-colors') && params.get('cutoff') === window.colorLayersDelay.cutoff ? window.colorLayersDelay.ms : 0;
    try {
      if (window.colorLayersFailOnce && route.startsWith('/api/region-colors')) {
        window.colorLayersFailOnce = false; entry.status = 503; entry.injectedFailure = true;
        return new Response(JSON.stringify({ error: 'Synthetic QA retry error' }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      const response = await originalFetch(url, delay ? { ...options, signal: undefined } : options); entry.status = response.status;
      if (route.startsWith('/api/region-colors')) {
        const data = await response.clone().json(); entry.definition = data.definition;
        entry.anchorComponents = data.samples?.find(sample => sample.isAnchor)?.components;
        if (delay) {
          entry.delayed = true; window.colorLayersDelay.started = true;
          await pause(delay); entry.delayFinished = true;
          return new Response(JSON.stringify(data), { status: response.status, headers: { 'content-type': 'application/json' } });
        }
      }
      return response;
    } catch (error) { entry.error = error.name; throw error; }
  };
  const latest = () => window.colorLayersQA.requests.findLast(entry => entry.route.startsWith('/api/region-colors'));
  const scoringRequests = () => window.colorLayersQA.requests.filter(entry => ['/api/search', '/api/inspect'].includes(entry.route)).length;
  const checkLayer = async (layer, expectedProfile, cutoff, axis, baselineCount) => {
    await wait(() => grid()?.dataset.layer === layer && $('matching-panel').getAttribute('aria-busy') === 'false', 'Layer did not finish');
    assert(grid().dataset.profile === expectedProfile, 'Wrong loaded profile');
    assert(Number(grid().dataset.cutoff) === cutoff, 'Wrong loaded cutoff');
    assert(grid().dataset.axis === axis, 'Switching layer changed axes');
    assert(scoringRequests() === baselineCount, 'Layer switch performed ranking/inspection');
    const request = latest(), params = new URL(request.route, location.href).searchParams;
    assert(params.get('profile') === expectedProfile && Number(params.get('cutoff')) === cutoff, 'Wrong layer API request');
    assert(layer === 'combined' || !params.has('cutoffBlendExponent'), 'Individual layer leaked exponent');
    const nonmatches = [...document.querySelectorAll('#matching-grid .matching-cell[data-matches="false"]')];
    assert(nonmatches.length > 0 && nonmatches.every(node => node.querySelector('.matching-swatch').style.transform === 'scale(0.2)'), 'Excluded colors must remain tiny');
    return { layer, profile: expectedProfile, cutoff, axis, tinyNonmatches: nonmatches.length, previewOnly: true };
  };
  const runSearch = async (method, count, cutoff = 0) => {
    close(); change('method', method); change('bucket-count', count); change('pixel-cutoff', cutoff);
    if (method === 'cutoff-all-levels') change('cutoff-blend-exponent', 6, 'input');
    $('query-form').requestSubmit();
    await wait(() => !$('search').disabled && $('search-status').className !== 'error', 'Search failed');
    if (method === 'cutoff-all-levels') change('cutoff-blend-exponent', 0, 'input');
    document.querySelector('#gallery .result-card').click();
    await wait(() => !$('inspection-content').hidden, 'Inspection failed');
    document.querySelector('#bin-grid .bin-cell[aria-pressed="true"]').click();
    await wait(() => grid() && $('matching-panel').getAttribute('aria-busy') === 'false', 'Membership modal failed');
  };
  window.colorLayersRunBank = async count => {
    await runSearch('cutoff-all-levels', count);
    const score = ledger().score.actual, before = scoringRequests();
    assert(ledger().parameters.cutoffBlendExponent === 6, 'Inspection lost saved exponent');
    assert($('color-layer').value === 'combined', 'New bin should default to combined');
    assert([...$('color-layer').options].map(option => option.value).join() === layers.join(), 'All layers not offered');
    $('color-tab-saturation').click();
    const row = { count, views: [], savedExponent: 6, score };
    for (const [index, layer] of layers.entries()) {
      if (index) change('color-layer', layer);
      row.views.push(await checkLayer(layer, index ? 'hard' : 'all-levels', index ? levels[index - 1] : 0, 'saturation', before));
      if (!index) assert(new URL(latest().route, location.href).searchParams.get('cutoffBlendExponent') === '6', 'Combined used edited exponent0');
    }
    change('color-layer', 'combined');
    await checkLayer('combined', 'all-levels', 0, 'saturation', before);
    assert(new URL(latest().route, location.href).searchParams.get('cutoffBlendExponent') === '6', 'Combined did not restore saved exponent');
    assert(latest().anchorComponents.length === 5 && latest().anchorComponents.every(component => component.scoreWeight > 0), 'Combined lost cutoff weights');
    change('color-layer', 'cutoff-25'); await checkLayer('cutoff-25', 'hard', .25, 'saturation', before);
    $('close-color-dialog').click();
    const nextBin = [...document.querySelectorAll('#bin-grid .bin-cell')].find(node => node.getAttribute('aria-pressed') === 'false'); nextBin.click();
    await checkLayer('combined', 'all-levels', 0, 'saturation', before);
    assert($('color-layer').value === 'combined', 'Opening another bin retained individual layer');
    assert(ledger().score.actual === score, 'Preview changed score');
    row.resetForNewBin = true; row.combinedRestoredSavedExponent = true;
    window.colorLayersQA.matrix.push(row); close(); return row;
  };
  window.colorLayersLegacy = async () => {
    for (const profile of ['consensus', 'hard', 'feather', 'core-halo']) {
      await runSearch('cutoff-' + profile, 64, 0);
      const before = scoringRequests(), defaultLayer = profile === 'consensus' ? 'combined' : 'current';
      assert($('color-layer').value === defaultLayer, 'Wrong default legacy layer');
      const values = [...$('color-layer').options].map(option => option.value);
      assert(values.length === 6 && values.includes('cutoff-90'), 'Legacy should offer all five cutoffs');
      if (profile === 'consensus') {
        const components = latest().anchorComponents;
        assert(components.length === 3 && components.map(component => component.cutoff).join() === '0,0.25,0.5', 'Legacy consensus window changed');
        assert(components.map(component => component.scoreWeight).join() === '0.2,0.3,0.5', 'Legacy consensus weights changed');
      }
      change('color-layer', 'cutoff-90');
      await checkLayer('cutoff-90', profile === 'consensus' ? 'hard' : profile, .9, 'saturation', before);
      change('color-layer', defaultLayer);
      await checkLayer(defaultLayer, profile, 0, 'saturation', before);
      window.colorLayersQA.legacy.push({ profile, allFiveOffered: true, ownKernelPreserved: true, savedViewRestored: true }); close();
    }
    await runSearch('overlap-quality-dense', 64);
    assert($('color-layer-controls').hidden, 'Original profile must hide cutoff selector');
    const request = new URL(latest().route, location.href).searchParams;
    assert(!request.has('profile') && !request.has('cutoff') && !request.has('cutoffBlendExponent'), 'Original membership request changed');
    window.colorLayersQA.checks.push('Original dense hides cutoff controls and keeps original membership endpoint parameters.'); close();
    return window.colorLayersQA.legacy;
  };
  window.colorLayersRaceAndRetry = async () => {
    await runSearch('cutoff-all-levels', 256);
    const before = scoringRequests();
    window.colorLayersDelay = { cutoff: '.25', ms: 300 };
    // URLSearchParams serializes the selected cutoff with a leading zero.
    window.colorLayersDelay.cutoff = '0.25';
    change('color-layer', 'cutoff-25');
    await wait(() => window.colorLayersDelay.started, 'Delayed layer did not start');
    change('color-layer', 'cutoff-90');
    await checkLayer('cutoff-90', 'hard', .9, 'saturation', before);
    await wait(() => window.colorLayersQA.requests.some(entry => entry.delayed && entry.delayFinished), 'Delayed response did not finish');
    await pause(30);
    assert(grid().dataset.layer === 'cutoff-90', 'Stale response overwrote latest layer');
    window.colorLayersDelay = null;
    window.colorLayersQA.checks.push('Real 25% response delayed past 90% with cancellation intentionally ignored: latest 90% view wins.');
    window.colorLayersFailOnce = true; change('color-layer', 'cutoff-50');
    await wait(() => $('matching-status').classList.contains('error'), 'Expected injected membership error');
    const retry = [...document.querySelectorAll('#matching-colors button')].find(node => node.textContent === 'Retry matching colors');
    assert(retry, 'Retry action missing'); retry.click();
    await checkLayer('cutoff-50', 'hard', .5, 'saturation', before);
    window.colorLayersQA.checks.push('Injected one-off membership503 shows retry; retry restores selected50% layer without ranking requests.');
    return { latestResponseWins: true, retryWorks: true };
  };
  window.colorLayersAfterEscape = () => {
    assert(!$('color-dialog').open && $('inspector').open, 'Escape should close only child modal');
    assert(document.activeElement.matches('#bin-grid .bin-cell[aria-pressed="true"]'), 'Focus did not return to selected bin');
    window.colorLayersQA.checks.push('Keyboard Escape closes child only and returns focus to selected bin.');
    document.activeElement.click();
    return 'Reopened bin for screenshots.';
  };
  return 'Color-layer browser QA ready.';
})()
