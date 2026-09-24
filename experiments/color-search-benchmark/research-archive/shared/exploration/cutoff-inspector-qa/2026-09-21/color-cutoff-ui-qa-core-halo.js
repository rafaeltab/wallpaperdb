(async () => {
  const $ = id => document.getElementById(id);
  const wait = async (check, message) => { const start=Date.now(); while (!check()) { if(Date.now()-start>15000)throw Error(message); await new Promise(r=>setTimeout(r,25)); } };
  const select = (id,value) => { $(id).value=String(value); $(id).dispatchEvent(new Event('change',{bubbles:true})); };
  const check = (ok,message) => { if(!ok)throw Error(message); };
  await wait(() => $('method').options.length === 6 && !$('search').disabled && $('gallery').querySelector('.result-card'), 'initial page not ready');
  if ($('color-dialog').open) $('close-color-dialog').click();
  if ($('inspector').open) $('close-inspector').click();
  const rows=[];
  const profile='core-halo';
  for (const [position,count] of [16,64,256,1024].entries()) {
    const cutoff=[0,.25,.5,.9][position];
    select('method',`cutoff-${profile}`); select('bucket-count',count); select('pixel-cutoff',cutoff);
    $('search').click(); await wait(() => !$('search').disabled && $('gallery').querySelector('.result-card'), 'search failed');
    check(!$('search-status').classList.contains('error'),$('search-status').textContent);
    select('pixel-cutoff', cutoff===0?.9:0); // Unsaved controls must not change inspection.
    $('gallery').querySelector('.result-card').click();
    await wait(() => !$('inspection-content').hidden || $('inspection-status').classList.contains('error'),'inspection stalled');
    check(!$('inspection-content').hidden,$('inspection-status').textContent);
    const ledger=JSON.parse($('formula-json').textContent);
    check(ledger.parameters.bucketCount===count,'wrong bank snapshot');
    check(ledger.parameters.pixelCutoff===cutoff,'wrong cutoff snapshot');
    check(ledger.definition.profile===profile,'wrong profile');
    check(Math.abs(ledger.score.difference)<1e-5,'score ledger mismatch');
    check($('bin-grid').children.length===count,'wrong bin count');
    if(profile==='consensus' && cutoff<.9) check(ledger.score.terms[0].components.length>1,'missing consensus components');
    $('bin-grid').querySelector('[aria-pressed="true"]').click();
    await wait(()=>$('matching-grid') || $('matching-status').classList.contains('error'),'colors stalled');
    check(Boolean($('matching-grid')),$('matching-status').textContent);
    for(const axis of ['lightness','saturation']) {
      $(`color-tab-${axis}`).click(); const grid=$('matching-grid');
      check(grid.dataset.axis===axis && grid.dataset.columns==='73' && grid.dataset.rows==='21','wrong modal axes');
      const excluded=[...grid.querySelectorAll('[data-matches="false"]')];
      check(excluded.length>0,'no excluded reference colors');
      check(excluded.every(node=>node.querySelector('.matching-swatch').style.transform==='scale(0.2)'),'excluded squares not tiny');
      check(grid.querySelector('[data-matches="true"]'),'no accepted colors');
      rows.push({profile,count,cutoff,axis,excluded:excluded.length,score:ledger.score.actual,difference:ledger.score.difference});
    }
    $('close-color-dialog').click(); check($('inspector').open,'child close also closed parent'); $('close-inspector').click();
  }
  window.cutoffQaRows=[...(window.cutoffQaRows||[]),...rows];
  return {passed:rows.length,rows};
})()
