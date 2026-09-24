(async () => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const batch = await (await fetch('/api/batch')).json();
  const buttons = [...document.querySelectorAll('#case-list button')];
  for (let i=0; i<buttons.length; i++) {
    buttons[i].click();
    assert(document.querySelector('h1').textContent === batch.cases[i].query.text, `query${i}`);
    const images = [...document.querySelectorAll('.photo-card img')];
    await Promise.all(images.map(img => img.decode()));
    assert(images.length === 4 && images.every(img => img.naturalWidth && getComputedStyle(img).objectFit === 'contain'), `images${i}`);
    assert(document.documentElement.scrollWidth <= innerWidth, `overflow${i}`);
    if (batch.cases[i].query.swatchHex) assert(document.querySelector('.swatch'), `swatch${i}`);
  }
  buttons[0].click();
  assert(document.querySelector('#case-notes').maxLength === 6000, 'note limit');
  const savedFetch = window.fetch;
  window.fetch = async (url, ...args) => { if (url === '/api/submissions') throw new Error('QA simulated offline'); return savedFetch(url, ...args); };
  document.querySelector('#submit').click();
  await new Promise(r => setTimeout(r,100));
  assert(document.querySelector('#notice').textContent.includes('Could not confirm the save'), 'failed save truthfully reported');
  assert(document.querySelector('#case-notes').value.includes('QA only'), 'failed save preserves notes');
  window.fetch = savedFetch;
  const key = 'wallpaperdb:color-review:color-review-batch-001:v1';
  return {casesRendered: buttons.length, viewport:[innerWidth,innerHeight], overflow:false, allImagesLoaded:true, noteLimit:6000, offlineSavePreservedDraft:true, savedAnswers:Object.keys(JSON.parse(localStorage.getItem(key)).answers).length};
})()
