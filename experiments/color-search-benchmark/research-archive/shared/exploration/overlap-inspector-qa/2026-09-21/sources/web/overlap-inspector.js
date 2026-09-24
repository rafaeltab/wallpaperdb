// Throwaway inspector. Wallpaper ranking and score diagnostics come from OpenSearch.
// Local sorting applies only to the regions within one already-selected wallpaper.
const $ = id => document.getElementById(id);
const state = { config: null, mode: 'vibe', targets: [{ color: '#ff0000', percent: 40 }], advanced: false, method: 'overlap-quality-dense',
  searchGeneration: 0, inspectionGeneration: 0, searchController: null, inspectionController: null, searching: false,
  resultsQuery: null, resultsMethod: null, diagnosis: null, selectedRegion: 0, page: 0 };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const percent = (value, digits = 2) => finite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
const number = (value, digits = 5) => finite(value) ? value.toFixed(digits) : '—';
const clone = value => JSON.parse(JSON.stringify(value));
const title = name => String(name ?? '').replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const colorName = target => (target?.name ?? target?.colorName) ? title(target.name ?? target.colorName) : target?.color ?? target?.colorHex ?? 'Color';
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function button(label, className, action) { const node = element('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node; }
function chip(color, className = 'color-chip') { const node = element('span', className); node.style.backgroundColor = color; node.setAttribute('aria-hidden', 'true'); return node; }
function metrics(entries) { const list = element('dl', 'metric-list'); for (const [key, value] of entries) list.append(element('dt', '', key), element('dd', '', value)); return list; }
function select(options, value, action, label) {
  const node = element('select'); for (const [key, text] of options) { const option = element('option', '', text); option.value = key; node.append(option); }
  node.value = value; if (label) node.setAttribute('aria-label', label); node.addEventListener('change', () => action(node.value)); return node;
}
function naturalQuery() {
  return { mode: state.mode, targets: state.targets.map(target => ({ color: target.color, ...(target.name ? { name: target.name } : {}), ...(state.mode === 'proportions' ? { percent: target.percent } : {}) })) };
}
function currentQuery() {
  const query = state.advanced ? JSON.parse($('query-json').value) : naturalQuery();
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw Error('The query must be an object.');
  if (!state.advanced && state.mode === 'proportions') {
    const total = state.targets.reduce((sum, target) => sum + target.percent, 0);
    if (!finite(total) || total <= 0 || total > 100) throw Error('Requested amounts must total more than 0% and at most 100%.');
  }
  return query;
}
function querySummary(query) {
  const targets = query?.targets ?? query?.colorTargets ?? query?.colors;
  if (!Array.isArray(targets)) return query?.text ?? query?.swatchHex ?? 'Advanced query';
  const mode = query.mode ?? (query.colorTargets || query.colors ? 'proportions' : 'vibe');
  return `${mode === 'proportions' ? 'Target areas' : 'Overall vibe'}: ${targets.map(target => {
    const amount = target.percent ?? target.targetImagePercent ?? (finite(target.amount) ? target.amount * 100 : undefined);
    return `${mode === 'proportions' && finite(amount) ? `${amount}% ` : ''}${colorName(target)}`;
  }).join(' + ')}`;
}
function updatePreview() {
  if (!state.advanced) $('query-json').value = JSON.stringify(naturalQuery(), null, 2);
  const total = state.targets.reduce((sum, target) => sum + (Number(target.percent) || 0), 0);
  $('remainder').hidden = state.mode !== 'proportions'; $('remainder').classList.toggle('invalid', total <= 0 || total > 100);
  $('remainder').textContent = total <= 0 || total > 100 ? 'Choose target amounts totaling more than 0% and at most 100%.' : `Target amounts total ${total}%. Colors outside the requested regions are unconstrained; regions may overlap.`;
  $('add-target').disabled = state.targets.length >= 8; $('search').disabled = state.searching;
  $('search').textContent = state.searching ? 'Searching OpenSearch…' : 'Search wallpapers';
  $('method-help').textContent = state.method === 'overlap-quality-dense'
    ? 'Dense regions: picked colors and concrete names such as red resolve to a nearby anchor. Abstract vibes such as dark and grayscale retain their broader definitions.'
    : 'Hybrid: named colors and vibes keep their broad definitions. Picked hex colors use the dense regions. Change a swatch to try a precise color.';
}
function setAdvanced(enabled) { state.advanced = enabled; $('use-json').checked = enabled; $('query-json').readOnly = !enabled; $('natural-controls').disabled = enabled; updatePreview(); }
function renderTargets() {
  $('targets').replaceChildren();
  state.targets.forEach((target, index) => {
    const card = element('div', 'target'), top = element('div', 'target-top');
    const choice = select([['picked', 'Picked hex color'], ...Object.keys(state.config.namedColors).map(name => [name, title(name)])], target.name ?? 'picked', name => {
      target.name = name === 'picked' ? undefined : name; target.color = state.config.namedColors[name] ?? target.color; renderTargets();
    }, `Color or vibe ${index + 1}`);
    top.append(choice);
    if (state.targets.length > 1) { const remove = button('×', 'target-remove', () => { state.targets.splice(index, 1); renderTargets(); }); remove.setAttribute('aria-label', `Remove color ${index + 1}`); top.append(remove); }
    card.append(top);
    const row = element('div', 'swatch-row'), picker = element('input'), hex = element('input');
    picker.type = 'color'; picker.value = target.color; picker.setAttribute('aria-label', `Pick color ${index + 1}`);
    hex.type = 'text'; hex.value = target.color; hex.maxLength = 7; hex.pattern = '#[0-9a-fA-F]{6}'; hex.required = true; hex.spellcheck = false; hex.setAttribute('aria-label', `Hex color ${index + 1}`);
    const usePicked = color => { target.color = color; delete target.name; choice.value = 'picked'; picker.value = color; hex.value = color; updatePreview(); };
    picker.addEventListener('input', () => usePicked(picker.value));
    hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) usePicked(hex.value); });
    row.append(picker, hex);
    if (state.mode === 'proportions') {
      const amount = element('input', 'portion-input'); amount.type = 'number'; amount.min = '0'; amount.max = '100'; amount.step = 'any'; amount.required = true; amount.value = target.percent ?? 0; amount.setAttribute('aria-label', `Image percentage for color ${index + 1}`);
      amount.addEventListener('input', () => { target.percent = Number(amount.value); updatePreview(); }); row.append(amount, element('span', 'hint', '%'));
    }
    card.append(row); $('targets').append(card);
  });
  $('mode-vibe').setAttribute('aria-pressed', String(state.mode === 'vibe')); $('mode-proportions').setAttribute('aria-pressed', String(state.mode === 'proportions'));
  $('mode-help').textContent = state.mode === 'proportions' ? 'Aim close to each requested amount. Excess requested color is penalized more strongly.' : 'Reward substantial matching area and high color quality. Accent-specific queries are not supported here.';
  updatePreview();
}
function usePreset(preset) {
  if (!preset) return; const query = preset.query; state.mode = query.mode ?? 'vibe';
  state.targets = query.targets.map(target => ({ ...clone(target), color: target.color ?? state.config.namedColors[target.name] ?? '#808080', percent: target.percent ?? 40 }));
  setAdvanced(false); renderTargets();
}
async function post(route, body, signal) {
  const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const value = await response.json(); if (!response.ok || value.supported === false) throw Error(value.error ?? value.reason ?? `Service failure (${response.status}).`); return value;
}
function closeInspection() { state.inspectionController?.abort(); state.inspectionGeneration++; if ($('inspector').open) $('inspector').close(); }
async function search(event) {
  event?.preventDefault(); let query;
  try { if (!$('query-form').reportValidity()) return; query = clone(currentQuery()); }
  catch (error) { $('search-status').textContent = error.message; $('search-status').className = 'error'; return; }
  const method = state.method; state.searchController?.abort(); const generation = ++state.searchGeneration, controller = new AbortController(); state.searchController = controller;
  closeInspection(); state.searching = true; updatePreview(); $('cancel-search').hidden = false; $('search-status').className = ''; $('search-status').textContent = 'OpenSearch is filtering and ranking the wallpapers…';
  try {
    const result = await post('/api/search', { methodId: method, query, limit: Number($('result-limit').value), includeFixtures: $('include-fixtures').checked }, controller.signal);
    if (generation !== state.searchGeneration) return;
    state.resultsQuery = query; state.resultsMethod = method; renderGallery(result.hits);
    $('method-tag').textContent = method; $('results-summary').textContent = `${result.hits.length} results · ${number(result.elapsedMs, 1)} ms · service order preserved`;
    $('query-caption').hidden = false; $('query-caption').textContent = `Results for ${querySummary(query)}`;
    const warnings = result.warnings ?? result.evidence?.warnings ?? []; $('search-warnings').hidden = !warnings.length; $('search-warnings').textContent = warnings.join(' ');
    $('search-status').textContent = 'Select a wallpaper to inspect coverage and quality. Timings here cover this test corpus, not a million wallpapers.';
  } catch (error) {
    if (generation !== state.searchGeneration) return;
    $('search-status').textContent = error.name === 'AbortError' ? 'Search canceled. Previous results retain their original query and method.' : error.message; $('search-status').className = error.name === 'AbortError' ? '' : 'error';
  } finally { if (generation === state.searchGeneration) { state.searching = false; $('cancel-search').hidden = true; updatePreview(); } }
}
function renderGallery(hits) {
  $('gallery').replaceChildren();
  if (!hits.length) { $('gallery').append(element('p', 'empty-state', 'No wallpapers returned.')); return; }
  for (const [index, hit] of hits.entries()) {
    const card = button('', 'result-card', () => inspect(hit)); card.setAttribute('aria-label', `Inspect result ${index + 1}, ${hit.id}, score ${number(hit.score)}`);
    const image = element('img'); image.src = hit.thumbnailUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    const caption = element('span', 'result-caption'); caption.append(element('span', '', `${index + 1}. ${hit.id}`), element('span', 'result-score', number(hit.score))); card.append(image, caption); $('gallery').append(card);
  }
}
async function inspect(hit) {
  state.inspectionController?.abort(); const generation = ++state.inspectionGeneration, controller = new AbortController(); state.inspectionController = controller;
  const query = clone(state.resultsQuery), method = state.resultsMethod; state.diagnosis = null;
  $('inspector-title').textContent = hit.id; $('inspection-content').hidden = true; $('inspection-status').className = ''; $('inspection-status').textContent = 'Reading stored regions and OpenSearch score diagnostics…';
  if (!$('inspector').open) $('inspector').showModal(); $('close-inspector').focus(); $('inspector').querySelector('.dialog-content').scrollTop = 0;
  try {
    const diagnosis = await post('/api/inspect', { methodId: method, id: hit.id, query }, controller.signal);
    if (generation !== state.inspectionGeneration || !$('inspector').open) return;
    if (!Array.isArray(diagnosis.regions) || diagnosis.regions.length !== 1024 || !Array.isArray(diagnosis.score?.terms)) throw Error('Incomplete region diagnostics returned.');
    state.diagnosis = diagnosis; state.page = 0;
    state.selectedRegion = diagnosis.regions.find(region => region.selectedBy.length)?.index ?? diagnosis.regions.reduce((largest, region) => region.coverage > largest.coverage ? region : largest, diagnosis.regions[0]).index;
    $('inspection-image').src = diagnosis.imageUrl; $('inspection-image').alt = `Wallpaper ${hit.id}`; $('original-link').href = diagnosis.imageUrl;
    $('inspection-query').textContent = `${querySummary(query)} · ${method}`; $('inspection-status').textContent = ''; $('inspection-content').hidden = false;
    $('present-only').checked = true; $('bin-search').value = ''; $('bin-sort').value = 'coverage'; $('sort-direction').value = 'desc'; $('grid-metric').value = 'color';
    renderInspection();
  } catch (error) { if (generation === state.inspectionGeneration) { $('inspection-status').className = 'error'; $('inspection-status').textContent = error.name === 'AbortError' ? 'Inspection canceled.' : error.message; } }
}
function renderInspection() {
  const diagnosis = state.diagnosis;
  $('score-cards').replaceChildren();
  for (const [label, value] of [['Service score', diagnosis.score.actual], ['Sum of target contributions', diagnosis.score.reconstructed], ['Difference', diagnosis.score.difference]]) {
    const card = element('div', 'score-card'); card.append(element('strong', '', number(value, label === 'Difference' ? 8 : 5)), element('span', '', label)); $('score-cards').append(card);
  }
  $('score-formula').textContent = diagnosis.score.formula;
  $('formula-json').textContent = JSON.stringify({ method: diagnosis.method, score: diagnosis.score, compiled: diagnosis.compiled, parameters: diagnosis.parameters, definition: diagnosis.definition, totals: diagnosis.totals, warnings: diagnosis.warnings, evidence: diagnosis.evidence }, null, 2);
  $('region-summary').textContent = `${diagnosis.regions.filter(region => region.coverage > 0).length} populated regions${diagnosis.totals?.pixelCount ? ` · ${diagnosis.totals.pixelCount.toLocaleString()} sampled pixels` : ''}`;
  $('target-summary').replaceChildren();
  for (const term of diagnosis.score.terms) {
    const target = diagnosis.compiled.targets[term.targetIndex], card = element('div', 'target-metric'), heading = element('h4');
    heading.append(chip(term.color ?? target?.color ?? '#808080'), document.createTextNode(`${term.targetIndex + 1}. ${colorName(target ?? term)}`)); card.append(heading);
    if (term.regionIndex != null) { const pair = element('div', 'anchor-pair'); pair.append(chip(term.color ?? target?.color), element('span', 'hint', 'requested →'), chip(term.regionHex), element('span', 'hint', `${term.regionHex} · region ${term.regionIndex}`)); card.append(pair); }
    else card.append(element('p', 'hint', 'Broad named feature; no single dense anchor.'));
    card.append(metrics([
      ...(term.regionIndex != null ? [['Anchor distance (OKLab)', number(term.anchorDistance)]] : []),
      ['Coverage field', term.coverageField], ['Quality field', term.qualityField], ['Observed coverage', percent(term.coverage)], ['Conditional quality', percent(term.conditionalQuality)],
      ...(diagnosis.compiled.mode === 'proportions' ? [['Requested coverage', percent(term.amount)], ['Area factor', number(term.areaFactor)], ['Quality factor', number(term.qualityFactor)]] : [['Area factor', number(term.areaFactor)], ['Quality factor', number(term.qualityFactor)]]),
      ['Target weight', number(term.weight)], ['Score contribution', number(term.scoreContribution)],
    ]));
    if (term.regionIndex != null) card.append(button('Inspect this region', 'secondary full', () => { selectRegion(term.regionIndex); $('bin-detail').scrollIntoView({ block: 'nearest' }); }));
    $('target-summary').append(card);
  }
  renderGrid(); renderDetail(); renderTable();
}
function regionTitle(region) { return `Region ${region.index} · ${region.hex} · coverage ${percent(region.coverage)} · quality ${percent(region.conditionalQuality)}${region.selectedBy.length ? ` · query targets ${region.selectedBy.map(i => i + 1).join(', ')}` : ''}`; }
function renderGrid() {
  const metric = $('grid-metric').value, fragment = document.createDocumentFragment(); $('bin-grid').replaceChildren();
  $('grid-legend').textContent = { color: 'Anchor colors. Empty regions are dimmed.', coverage: 'Brighter green means more image coverage in that region.', quality: 'Brighter green means higher mean closeness among matching pixels.', used: 'Colored squares are directly used in this query. Unused regions remain stored for other queries.' }[metric];
  for (const region of state.diagnosis.regions) {
    const cell = button('', `bin-cell${region.selectedBy.length ? ' is-used' : ''}`, () => selectRegion(region.index));
    cell.dataset.index = region.index; cell.title = regionTitle(region); cell.setAttribute('aria-label', regionTitle(region)); cell.setAttribute('aria-pressed', String(region.index === state.selectedRegion)); cell.tabIndex = region.index === state.selectedRegion ? 0 : -1;
    if (metric === 'color' || metric === 'used') { cell.style.backgroundColor = region.hex; cell.style.opacity = metric === 'used' ? (region.selectedBy.length ? '1' : '.12') : (region.coverage > 0 ? '1' : '.2'); }
    else { const value = metric === 'coverage' ? region.coverage : region.conditionalQuality; cell.style.backgroundColor = `hsl(155 55% ${5 + value * 60}%)`; }
    cell.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -32, ArrowDown: 32 };
      let index = region.index + (offsets[event.key] ?? 0);
      if (event.key === 'Home') index = Math.floor(region.index / 32) * 32;
      else if (event.key === 'End') index = Math.floor(region.index / 32) * 32 + 31;
      else if (!(event.key in offsets)) return;
      event.preventDefault(); index = Math.max(0, Math.min(1023, index)); selectRegion(index); $('bin-grid').querySelector(`[data-index="${index}"]`).focus();
    }); fragment.append(cell);
  }
  $('bin-grid').append(fragment);
}
function selectRegion(index) { state.selectedRegion = index; for (const cell of $('bin-grid').children) { const selected = Number(cell.dataset.index) === index; cell.setAttribute('aria-pressed', String(selected)); cell.tabIndex = selected ? 0 : -1; } renderDetail(); renderTable(); }
function renderDetail() {
  const region = state.diagnosis.regions.find(region => region.index === state.selectedRegion), detail = $('bin-detail'); detail.replaceChildren();
  detail.append(chip(region.hex, 'large-chip'), element('h4', '', `Region ${region.index} · ${region.hex}`), metrics([
    ['Key', region.key], ['Coverage', percent(region.coverage)], ['Conditional quality', percent(region.conditionalQuality)], ['Quality mass', percent(region.qualityMass)],
    ['OKLab anchor', region.lab.map(value => number(value, 4)).join(', ')], ['Used by target(s)', region.selectedBy.length ? region.selectedBy.map(index => index + 1).join(', ') : 'None'],
  ]));
  detail.append(element('p', 'hint', 'Quality mass is coverage × quality. Coverage and conditional quality are stored separately; mass is shown only to explain their relationship.'));
  for (const term of state.diagnosis.score.terms.filter(term => term.regionIndex === region.index)) detail.append(element('p', 'region-note', `Target ${term.targetIndex + 1} contributes ${number(term.scoreContribution)} to this score using ${term.coverageField} and ${term.qualityField}.`));
  if (!region.selectedBy.length) detail.append(element('p', 'region-note', 'This region is not read by this query and contributes no separate score term.'));
}
function renderTable() {
  if (!state.diagnosis) return;
  const query = $('bin-search').value.trim().toLowerCase(), key = $('bin-sort').value, direction = $('sort-direction').value === 'asc' ? 1 : -1;
  const value = region => key === 'quality' ? region.conditionalQuality : key === 'used' ? region.selectedBy.length : region[key];
  const regions = state.diagnosis.regions.filter(region => (!$('present-only').checked || region.coverage > 0) && (!query || `${region.index} ${region.hex} ${region.key}`.toLowerCase().includes(query))).sort((a, b) => direction * (value(a) - value(b)) || a.index - b.index);
  const size = $('page-size').value === 'all' ? Math.max(1, regions.length) : Number($('page-size').value), pages = Math.max(1, Math.ceil(regions.length / size)); state.page = Math.min(state.page, pages - 1);
  $('bin-rows').replaceChildren();
  for (const region of regions.slice(state.page * size, (state.page + 1) * size)) {
    const row = element('tr'); row.setAttribute('aria-selected', String(region.index === state.selectedRegion));
    const cell = element('td'), choose = button('', 'bin-select', () => selectRegion(region.index)); choose.append(chip(region.hex), document.createTextNode(`${region.index} · ${region.hex}`)); cell.append(choose); row.append(cell);
    for (const text of [percent(region.coverage), percent(region.conditionalQuality), percent(region.qualityMass), region.selectedBy.length ? region.selectedBy.map(index => index + 1).join(', ') : '—']) row.append(element('td', '', text));
    $('bin-rows').append(row);
  }
  $('table-count').textContent = `${regions.length.toLocaleString()} regions · page ${state.page + 1} of ${pages}`; $('previous-page').disabled = state.page === 0; $('next-page').disabled = state.page >= pages - 1;
}
async function init() {
  const response = await fetch('/api/config'); if (!response.ok) throw Error('Could not load the inspector configuration.'); state.config = await response.json();
  $('corpus-summary').textContent = `${state.config.corpus.real} real wallpapers + ${state.config.corpus.fixtures} controlled fixtures · native OpenSearch scoring`;
  for (const method of state.config.methods) { const option = element('option', '', method.id === 'overlap-quality-dense' ? 'Dense color regions' : 'Named colors + dense picked colors'); option.value = method.id; $('method').append(option); }
  for (const [index, preset] of state.config.presets.entries()) { const option = element('option', '', preset.label); option.value = index; $('preset').append(option); }
  $('method').addEventListener('change', () => { state.method = $('method').value; updatePreview(); });
  $('preset').addEventListener('change', () => usePreset(state.config.presets[Number($('preset').value)]));
  $('mode-vibe').addEventListener('click', () => { state.mode = 'vibe'; renderTargets(); }); $('mode-proportions').addEventListener('click', () => { state.mode = 'proportions'; renderTargets(); });
  $('add-target').addEventListener('click', () => { state.targets.push({ color: '#209040', percent: 20 }); renderTargets(); });
  $('use-json').addEventListener('change', () => setAdvanced($('use-json').checked)); $('query-form').addEventListener('submit', search); $('cancel-search').addEventListener('click', () => state.searchController?.abort());
  $('close-inspector').addEventListener('click', closeInspection); $('inspector').addEventListener('cancel', () => { state.inspectionController?.abort(); state.inspectionGeneration++; });
  $('grid-metric').addEventListener('change', renderGrid);
  for (const id of ['present-only', 'bin-sort', 'sort-direction', 'page-size']) $(id).addEventListener('change', () => { state.page = 0; renderTable(); });
  $('bin-search').addEventListener('input', () => { state.page = 0; renderTable(); }); $('previous-page').addEventListener('click', () => { state.page--; renderTable(); }); $('next-page').addEventListener('click', () => { state.page++; renderTable(); });
  renderTargets(); await search();
}
init().catch(error => { $('search-status').className = 'error'; $('search-status').textContent = error.message; });
