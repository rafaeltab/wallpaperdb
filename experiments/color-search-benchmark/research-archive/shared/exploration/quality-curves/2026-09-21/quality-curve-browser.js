(() => {
  const byId = id => document.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (condition, message) => { const until = Date.now() + 15000; while (!condition()) { if (Date.now() > until) throw Error(message + ': ' + byId('search-status').textContent); await pause(30); } };
  const change = (id, value, type = 'change') => { byId(id).value = String(value); byId(id).dispatchEvent(new Event(type, { bubbles: true })); };
  window.qualityCurveQA = { matrix: [], checks: [], startedAt: new Date().toISOString() };
  assert(byId('quality-curve').value === 'power', 'New visits should start with smooth power.');
  assert(byId('query-caption').textContent.includes('Smooth power'), 'Initial executed search must use power.');
  window.qualityCurveQA.checks.push('UI defaults to smooth power and performs a real initial search.');
  window.qualityCurveRunMethod = async method => {
    const rows = [];
    for (const count of [16,64,256,1024]) for (const curve of ['linear','power']) {
      if (byId('inspector').open) byId('close-inspector').click();
      change('method',method); change('bucket-count',count); change('quality-curve',curve);
      change('quality-influence',3,'input'); change('minimum-quality',0,'input'); change('pixel-cutoff',0);
      byId('query-form').requestSubmit();
      await wait(() => !byId('search').disabled && byId('search-status').className !== 'error', 'Search failed');
      assert(byId('method-tag').textContent === method, 'Wrong executed method');
      const caption = byId('query-caption').textContent;
      assert(caption.includes(curve === 'power' ? 'Smooth power' : 'Original linear penalty'), 'Caption curve mismatch');
      const cards = [...document.querySelectorAll('#gallery .result-card')];
      assert(cards.length === 24, 'Expected 24 real wallpaper results');
      const scores = cards.map(card => Number(card.querySelector('.result-score').textContent));
      // Editing controls without a new search must not change result inspection.
      change('quality-curve',curve === 'power' ? 'linear' : 'power');
      assert(byId('query-caption').textContent === caption, 'Editing a curve changed the saved result caption');
      cards[0].click();
      await wait(() => !byId('inspection-content').hidden, 'Inspection failed');
      const ledger = JSON.parse(byId('formula-json').textContent);
      assert(ledger.parameters.qualityCurve === curve, 'Inspector used current controls instead of saved curve');
      assert(ledger.parameters.bucketCount === count && ledger.parameters.qualityInfluence === 3, 'Inspector parameters changed');
      assert(Math.abs(ledger.score.difference) < 0.00001, 'Native score differs from ledger');
      assert(document.querySelectorAll('#bin-grid .bin-cell').length === count || ledger.definition.anchorCount === count, 'Wrong bank');
      const row = { method, count, curve, score: ledger.score.actual, difference: ledger.score.difference, visibleZeroScores: scores.filter(score => score === 0).length, formula: ledger.score.formula, savedCurvePreserved: true };
      rows.push(row); window.qualityCurveQA.matrix.push(row);
      byId('close-inspector').click();
    }
    return rows;
  };
  window.qualityCurveFinish = async () => {
    change('method','cutoff-hard'); change('bucket-count',16); change('pixel-cutoff',0); change('quality-curve','power');
    change('quality-influence',3,'input');
    byId('live-update').checked = true; byId('live-update').dispatchEvent(new Event('change',{bubbles:true}));
    change('quality-curve','linear'); change('quality-curve','power');
    await pause(450);
    await wait(() => !byId('search').disabled && byId('query-caption').textContent.includes('Smooth power') && byId('query-caption').textContent.includes('16 buckets'), 'Final live curve did not win');
    document.querySelector('#gallery .result-card').click();
    await wait(() => !byId('inspection-content').hidden, 'Final live inspection failed');
    const saved = JSON.parse(byId('formula-json').textContent);
    assert(saved.parameters.qualityCurve === 'power' && saved.parameters.qualityInfluence === 3, 'Live update used wrong curve');
    byId('close-inspector').click();
    window.qualityCurveQA.checks.push('Rapid live curve changes resolve to the final power selection.');
    const linear = window.qualityCurveQA.matrix.find(row => row.method === 'cutoff-hard' && row.count === 16 && row.curve === 'linear');
    const power = window.qualityCurveQA.matrix.find(row => row.method === 'cutoff-hard' && row.count === 16 && row.curve === 'power');
    assert(linear.visibleZeroScores > power.visibleZeroScores, 'Power did not reduce real zero-score collapse');
    window.qualityCurveQA.checks.push('Broad red query has fewer actual displayed zeros with power than linear.');
    window.qualityCurveQA.finishedAt = new Date().toISOString();
    return window.qualityCurveQA;
  };
  return 'Quality curve browser checks ready.';
})()
