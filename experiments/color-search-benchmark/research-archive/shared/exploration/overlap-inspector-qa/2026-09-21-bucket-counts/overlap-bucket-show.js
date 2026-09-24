(async () => {
  const $ = id => document.getElementById(id);
  if ($('inspector').open) $('close-inspector').click();
  $('bucket-count').value = window.bucketScreenshotCount ?? 16; $('bucket-count').dispatchEvent(new Event('change'));
  $('query-form').requestSubmit();
  for (let i = 0; i < 150 && $('search').disabled; i++) await new Promise(resolve => setTimeout(resolve, 20));
  if ($('search-status').classList.contains('error')) throw Error($('search-status').textContent);
  document.querySelector('.result-card').click();
  for (let i = 0; i < 150 && $('inspection-content').hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
  if ($('inspection-content').hidden) throw Error($('inspection-status').textContent);
  $('grid-metric').value = 'coverage'; $('grid-metric').dispatchEvent(new Event('change'));
  $('bin-heading').scrollIntoView({ block: 'start' });
  return { count: document.querySelectorAll('.bin-cell').length, pageFits: document.documentElement.scrollWidth <= innerWidth, dialogFits: $('inspector').scrollWidth <= $('inspector').clientWidth };
})()
