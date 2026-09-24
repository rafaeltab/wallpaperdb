// Throwaway diagnostic UI. Wallpaper scores and result order come from the service.
// Local sorting/filtering below applies only to the selected wallpaper's diagnostic bins.
const $ = (id) => document.getElementById(id);
const state = { config: null, colors: [], mode: 'vibe', targets: [{ name: 'red', color: '#ed3030', percent: 40 }], advanced: false,
  searchGeneration: 0, inspectionGeneration: 0, searchController: null, inspectionController: null, searching: false,
  resultsQuery: null, diagnosis: null, selectedBin: 0, activeTarget: 0, page: 0, opener: null };
const axes = { oklab: [['distance', 'Perceptual distance']], rgb: [['r', 'Red distance'], ['g', 'Green distance'], ['b', 'Blue distance']],
  hsv: [['h', 'Hue distance'], ['s', 'Saturation distance'], ['v', 'Value distance']], hsl: [['h', 'Hue distance'], ['s', 'Saturation distance'], ['l', 'Lightness distance']] };
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const percent = (value, digits = 2) => finite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
const number = (value, digits = 5) => finite(value) ? value.toFixed(digits) : '—';
const signed = (value) => finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(5)}` : 'Not defined';
const clone = (value) => JSON.parse(JSON.stringify(value));
const title = (name) => String(name ?? '').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, className, action) {
  const node = element('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node;
}
function select(options, value, action, label) {
  const node = element('select');
  for (const [id, text] of options) { const option = element('option', '', text); option.value = id; node.append(option); }
  node.value = value;
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('change', () => action(node.value)); return node;
}
function field(label, input) { const wrapper = element('label', 'field'); wrapper.append(element('span', '', label), input); return wrapper; }
function metricList(entries) {
  const list = element('dl', 'metric-list');
  for (const [name, value] of entries) list.append(element('dt', '', name), element('dd', '', value));
  return list;
}
function chip(color, className = 'color-chip') { const node = element('span', className); node.style.backgroundColor = color; node.setAttribute('aria-hidden', 'true'); return node; }
function colorName(target) { const name = target?.name ?? target?.colorName; return name ? title(name) : target?.color ?? target?.colorHex ?? 'Color'; }

function naturalQuery() {
  const targets = state.targets.map((target) => ({ color: target.color, ...(target.name ? { name: target.name } : {}),
    ...(state.mode === 'proportions' ? { percent: target.percent } : {}),
    ...(target.customRange ? { space: target.space ?? 'oklab', tolerance: target.tolerance ?? { distance: .2 }, edgeWeight: target.edgeWeight ?? .5 } : {}) }));
  return { mode: state.mode, targets, ...(state.mode === 'proportions' ? { unspecifiedRemainderPercent: Math.max(0, 100 - targets.reduce((sum, target) => sum + target.percent, 0)) } : {}) };
}
function currentQuery() {
  const query = state.advanced ? JSON.parse($('query-json').value) : naturalQuery();
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw Error('The query must be a JSON object.');
  if (!state.advanced && state.mode === 'proportions') {
    const total = state.targets.reduce((sum, target) => sum + target.percent, 0);
    if (!finite(total) || total <= 0 || total > 100) throw Error('Requested portions must total more than 0% and at most 100%.');
  }
  return query;
}
function querySummary(query) {
  const targets = query?.targets ?? query?.colorTargets ?? query?.colors;
  if (!Array.isArray(targets)) return query?.text ?? query?.swatchHex ?? 'Advanced color query';
  const mode = query.mode ?? (query.colorTargets?.length || query.colors?.length ? 'proportions' : 'vibe');
  const parts = targets.map((target) => {
    const amount = target.percent ?? target.targetImagePercent ?? (finite(target.amount) ? target.amount * 100 : undefined);
    return `${mode === 'proportions' && finite(amount) ? `${amount}% ` : ''}${colorName(target)}${target.tolerance || target.ranges || target.distance != null ? ' (custom range)' : ''}`;
  });
  const remainder = query.unspecifiedRemainderPercent;
  return `${mode === 'proportions' ? 'Target areas: ' : 'Overall vibe: '}${parts.join(' + ')}${remainder > 0 ? ` · ${remainder}% unspecified` : ''}`;
}
function updateQueryPreview() {
  if (!state.advanced) $('query-json').value = JSON.stringify(naturalQuery(), null, 2);
  const total = state.targets.reduce((sum, target) => sum + (Number(target.percent) || 0), 0);
  $('remainder').hidden = state.mode !== 'proportions';
  $('remainder').classList.toggle('invalid', total > 100 || total <= 0);
  $('remainder').textContent = total > 100 ? `${total}% requested. Reduce the total to 100% or less.` : total <= 0 ? 'At least one portion must be greater than zero.' : total === 100 ? 'Full composition: every color portion is specified.' : `${Number((100 - total).toFixed(2))}% is unspecified. Extra requested color still counts toward its target.`;
  $('add-target').disabled = state.targets.length >= 8;
  $('search').disabled = state.searching;
  $('search').textContent = state.searching ? 'Searching OpenSearch…' : 'Search wallpapers';
}
function setAdvanced(enabled) {
  state.advanced = enabled; $('use-json').checked = enabled; $('query-json').readOnly = !enabled; $('natural-controls').disabled = enabled; updateQueryPreview();
}
function rangeInput(label, value, action) {
  const input = element('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '1'; input.value = String(Math.round(value * 100));
  input.setAttribute('aria-label', `${label}, percent`);
  input.addEventListener('input', () => { action(Number(input.value) / 100); updateQueryPreview(); });
  return field(`${label} (%)`, input);
}
function renderTargets() {
  $('targets').replaceChildren();
  state.targets.forEach((target, index) => {
    const card = element('div', 'target'), top = element('div', 'target-top');
    const choice = select([['custom', 'Picked hex color'], ...state.colors.map((color) => [color.name, color.label])], target.name ?? 'custom', (name) => {
      target.name = name === 'custom' ? undefined : name; target.color = state.colors.find((color) => color.name === name)?.color ?? target.color;
      target.customRange = false; delete target.tolerance; delete target.space; renderTargets();
    }, `Color or vibe ${index + 1}`);
    top.append(choice);
    if (state.targets.length > 1) {
      const remove = button('×', 'target-remove', () => { state.targets.splice(index, 1); renderTargets(); }); remove.setAttribute('aria-label', `Remove color ${index + 1}`); top.append(remove);
    }
    card.append(top);
    const row = element('div', 'swatch-row'), picker = element('input'), hex = element('input');
    const reflectPickedColor = () => { const help = card.querySelector('.target-default-help'); if (help) help.textContent = 'Picked colors use the method’s default OKLab distance and edge falloff.'; };
    picker.type = 'color'; picker.value = target.color; picker.setAttribute('aria-label', `Pick color ${index + 1}`);
    hex.type = 'text'; hex.value = target.color; hex.maxLength = 7; hex.pattern = '#[0-9a-fA-F]{6}'; hex.required = true; hex.spellcheck = false; hex.setAttribute('aria-label', `Hex color ${index + 1}`);
    picker.addEventListener('input', () => { target.color = picker.value; hex.value = picker.value; delete target.name; choice.value = 'custom'; reflectPickedColor(); updateQueryPreview(); });
    hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { target.color = hex.value; picker.value = hex.value; delete target.name; choice.value = 'custom'; reflectPickedColor(); updateQueryPreview(); } });
    row.append(picker, hex);
    if (state.mode === 'proportions') {
      const input = element('input', 'portion-input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = 'any'; input.required = true; input.value = String(target.percent ?? 0); input.setAttribute('aria-label', `Image percentage for color ${index + 1}`);
      input.addEventListener('input', () => { target.percent = Number(input.value); updateQueryPreview(); }); row.append(input, element('span', 'hint', '%'));
    }
    card.append(row);
    const details = element('details'); details.open = Boolean(target.customRange); details.append(element('summary', '', 'Color range and falloff'));
    const toggleLabel = element('label', 'check'), toggle = element('input'); toggle.type = 'checkbox'; toggle.checked = Boolean(target.customRange);
    toggleLabel.append(toggle, element('span', '', 'Use a custom range around this color'));
    toggle.addEventListener('change', () => { target.customRange = toggle.checked; target.space ??= 'oklab'; target.tolerance ??= { distance: .2 }; target.edgeWeight ??= .5; renderTargets(); }); details.append(toggleLabel);
    if (target.customRange) {
      const ranges = element('div', 'range-fields');
      ranges.append(select([['oklab', 'Perceptual distance · OKLab'], ['rgb', 'Separate RGB distances'], ['hsv', 'Hue / saturation / value'], ['hsl', 'Hue / saturation / lightness']], target.space ?? 'oklab', (space) => {
        target.space = space; target.tolerance = Object.fromEntries(axes[space].map(([key]) => [key, key === 'h' ? 1 : .2])); renderTargets();
      }, `Range color space ${index + 1}`));
      for (const [key, label] of axes[target.space ?? 'oklab']) ranges.append(rangeInput(label, target.tolerance?.[key] ?? .2, (value) => { target.tolerance ??= {}; target.tolerance[key] = value; }));
      ranges.append(rangeInput('Quality at the range edge', target.edgeWeight ?? .5, (value) => { target.edgeWeight = value; }));
      details.append(ranges, element('p', 'hint', 'The center has full quality. Edge quality changes matching quality, not the amount of image area counted. Hue distance 100% permits any hue; use it for black, white, or gray anchors.'));
    } else details.append(element('p', 'hint target-default-help', target.name ? 'Named colors use hand-authored hue, saturation, and brightness rules. Changing the swatch switches this target to a picked hex color.' : 'Picked colors use the method’s default OKLab distance and edge falloff.'));
    card.append(details); $('targets').append(card);
  });
  $('mode-vibe').setAttribute('aria-pressed', String(state.mode === 'vibe')); $('mode-proportions').setAttribute('aria-pressed', String(state.mode === 'proportions'));
  $('mode-help').textContent = state.mode === 'proportions' ? 'Aim close to each requested share of the image. Leave part of the composition unspecified if it does not matter.' : 'Match the overall color feeling. Grayscale + red and dark + bright named pairs express accent intents.';
  updateQueryPreview();
}
function usePreset(preset) {
  if (!preset) return;
  const query = preset.query;
  if (!Array.isArray(query.targets)) { setAdvanced(true); $('query-json').value = JSON.stringify(query, null, 2); return; }
  state.mode = query.mode ?? 'vibe';
  state.targets = query.targets.map((target) => ({ ...clone(target), color: target.color ?? state.colors.find((color) => color.name === target.name)?.color ?? '#808080', percent: target.percent ?? 40,
    customRange: Boolean(target.tolerance), edgeWeight: target.edgeWeight ?? .5 }));
  setAdvanced(false); renderTargets();
}

async function post(url, body, signal) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  let result;
  try { result = await response.json(); } catch { throw Error(`The service returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw Error(result.error ?? result.message ?? `Service request failed (${response.status}).`);
  if (result.supported === false) throw Error(result.reason ?? 'This query is unsupported by the histogram method.');
  return result;
}
async function search(event) {
  event?.preventDefault();
  let query;
  try { if (!$('query-form').reportValidity()) return; query = clone(currentQuery()); }
  catch (error) { $('search-status').textContent = error.message; $('search-status').className = 'error'; return; }
  state.searchController?.abort(); const generation = ++state.searchGeneration, controller = new AbortController(); state.searchController = controller;
  closeInspection(); state.searching = true; updateQueryPreview(); $('cancel-search').hidden = false;
  $('search-status').className = ''; $('search-status').textContent = 'OpenSearch is filtering and ranking the wallpapers…';
  const started = performance.now();
  try {
    const result = await post('/api/search', { query, limit: Number($('result-limit').value), includeFixtures: $('include-fixtures').checked }, controller.signal);
    if (generation !== state.searchGeneration) return;
    if (!Array.isArray(result.hits)) throw Error('The service did not return a result list.');
    state.resultsQuery = query; renderGallery(result.hits);
    const elapsed = finite(result.elapsedMs) ? result.elapsedMs : performance.now() - started;
    $('results-summary').textContent = `${result.hits.length} results · ${elapsed.toFixed(1)} ms · service order preserved`;
    $('query-caption').hidden = false; $('query-caption').textContent = `Results for ${querySummary(query)}`;
    const warnings = result.warnings ?? result.evidence?.warnings ?? [];
    $('search-warnings').hidden = !warnings.length; $('search-warnings').textContent = warnings.join(' ');
    $('search-status').textContent = 'Select a wallpaper to inspect its color bins. These timings cover the test corpus, not a million wallpapers.';
  } catch (error) {
    if (generation !== state.searchGeneration) return;
    $('search-status').textContent = error.name === 'AbortError' ? 'Search canceled. Previous results keep their original query.' : error.message;
    $('search-status').className = error.name === 'AbortError' ? '' : 'error';
  } finally {
    if (generation === state.searchGeneration) { state.searching = false; $('cancel-search').hidden = true; updateQueryPreview(); }
  }
}
function renderGallery(hits) {
  $('gallery').replaceChildren();
  if (!hits.length) { const empty = element('div', 'empty-state'); empty.append(element('h3', '', 'No wallpapers returned'), element('p', '', 'Try a different color or a broader range.')); $('gallery').append(empty); return; }
  const fragment = document.createDocumentFragment();
  hits.forEach((hit, index) => {
    const card = button('', 'result-card', () => inspect(hit, card)); card.setAttribute('aria-label', `Inspect result ${index + 1}, ${hit.id}, score ${number(hit.score)}`);
    const image = element('img'); image.src = hit.thumbnailUrl ?? `${hit.imageUrl}${hit.imageUrl?.includes('?') ? '&' : '?'}thumbnail=1`; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    const caption = element('span', 'result-caption'); caption.append(element('span', '', `${index + 1}. ${hit.id}`), element('span', 'result-score', number(hit.score)));
    card.append(image, caption); fragment.append(card);
  });
  $('gallery').append(fragment);
}
function closeInspection() {
  state.inspectionController?.abort(); state.inspectionGeneration++;
  if ($('inspector').open) $('inspector').close();
}
async function inspect(hit, opener) {
  if (!state.resultsQuery) return;
  state.inspectionController?.abort(); const generation = ++state.inspectionGeneration, controller = new AbortController(); state.inspectionController = controller;
  const query = clone(state.resultsQuery); state.opener = opener; state.diagnosis = null;
  $('inspector-title').textContent = hit.id; $('inspection-content').hidden = true; $('inspection-status').className = '';
  $('inspection-status').textContent = 'Reading the histogram and asking OpenSearch for score diagnostics…';
  if (!$('inspector').open) $('inspector').showModal();
  $('close-inspector').focus(); $('inspector').querySelector('.dialog-content').scrollTop = 0;
  try {
    const diagnosis = await post('/api/inspect', { id: hit.id, query }, controller.signal);
    if (generation !== state.inspectionGeneration || !$('inspector').open) return;
    if (!Array.isArray(diagnosis.bins) || diagnosis.bins.length !== 4096) throw Error('The service must return all 4096 histogram bins.');
    if (!diagnosis.score || !diagnosis.totals || !diagnosis.compiled?.targets) throw Error('Incomplete score diagnosis returned by the service.');
    state.diagnosis = diagnosis; state.activeTarget = 0; state.page = 0;
    state.selectedBin = diagnosis.bins.reduce((largest, bin) => bin.coverage > largest.coverage ? bin : largest, diagnosis.bins[0]).index;
    $('inspection-image').src = diagnosis.imageUrl ?? hit.imageUrl; $('inspection-image').alt = `Wallpaper ${hit.id}`;
    $('original-link').href = diagnosis.imageUrl ?? hit.imageUrl; $('inspection-query').textContent = querySummary(query);
    $('inspection-status').textContent = ''; $('inspection-content').hidden = false;
    $('present-only').checked = true; $('bin-search').value = ''; $('bin-sort').value = 'coverage'; $('sort-direction').value = 'desc'; $('grid-metric').value = 'color';
    renderInspection();
  } catch (error) {
    if (generation !== state.inspectionGeneration) return;
    $('inspection-status').className = 'error'; $('inspection-status').textContent = error.name === 'AbortError' ? 'Inspection canceled.' : error.message;
  }
}
function renderInspection() {
  const diagnosis = state.diagnosis, totals = diagnosis.totals;
  $('score-cards').replaceChildren();
  for (const [label, value] of [['Actual service score', number(diagnosis.score.actual)], ['Reconstructed score', number(diagnosis.score.reconstructed)], ['Score difference', number(diagnosis.score.difference, 8)]]) {
    const card = element('div', 'score-card'); card.append(element('strong', '', value), element('span', '', label)); $('score-cards').append(card);
  }
  $('formula-description').textContent = diagnosis.score.description ?? `Score form: ${diagnosis.score.formulaKind ?? 'histogram composition'}. Area, conditional color quality, and any composition penalties combine into the final score. Bin area and quality-mass contributions can be summed; the final score and removal effects generally cannot.`;
  $('score-formula').textContent = diagnosis.score.formula ?? diagnosis.score.formulaKind ?? 'See service evidence';
  const terms = diagnosis.score.terms ?? {}, ledger = [];
  if (diagnosis.score.formulaKind === 'vibe') {
    for (const term of terms.targets ?? []) ledger.push([`${colorName(diagnosis.compiled.targets[term.index])} score contribution`, number(term.scoreContribution)]);
  } else {
    const labels = { meanAreaError: 'Mean area error', qualityPenalty: 'Color-quality penalty', outsidePenalty: 'Outside-color penalty', totalError: 'Total error',
      grayscaleArea: 'Grayscale area', redArea: 'Red area', redQuality: 'Red conditional quality', redAccentFactor: 'Red accent factor', qualityFactor: 'Quality factor',
      darkArea: 'Dark area', brightArea: 'Bright area', brightAccentFactor: 'Bright accent factor', unclampedScore: 'Score before clamping' };
    for (const [key, label] of Object.entries(labels)) if (finite(terms[key])) ledger.push([label, number(terms[key])]);
  }
  $('score-ledger').replaceChildren(metricList(ledger));
  $('score-ledger').hidden = !ledger.length;
  $('formula-json').textContent = JSON.stringify({ score: diagnosis.score, parameters: diagnosis.parameters, compiled: diagnosis.compiled, totals, evidence: diagnosis.evidence, warnings: diagnosis.warnings }, null, 2);
  $('histogram-summary').textContent = `${Number(totals.occupiedBinCount).toLocaleString()} occupied bins · ${Number(totals.pixelCount).toLocaleString()} sampled pixels`;
  $('target-summary').replaceChildren(); $('active-target').replaceChildren();
  diagnosis.compiled.targets.forEach((target, index) => {
    const card = element('div', 'target-metric'), heading = element('h4'); heading.append(chip(target.color ?? '#808080'), document.createTextNode(colorName(target)));
    const entries = [['Requested share', diagnosis.compiled.mode === 'proportions' ? percent(target.amount) : 'Overall vibe'], ['Matching image area', percent(totals.targetAreas?.[index])], ['Quality-weighted area', percent(totals.qualityMasses?.[index])], ['Quality within matching area', percent(totals.conditionalQualities?.[index])]];
    const term = terms.targets?.find((entry) => entry.index === index);
    for (const [key, label] of [['areaErrorContribution', 'Contribution to mean area error'], ['qualityPenaltyContribution', 'Contribution to quality penalty'], ['areaFactor', 'Area factor'], ['targetWeight', 'Target weight'], ['scoreContribution', 'Target score contribution']]) if (finite(term?.[key])) entries.push([label, number(term[key])]);
    card.append(heading, metricList(entries)); $('target-summary').append(card);
    const option = element('option', '', `${index + 1}. ${colorName(target)}`); option.value = String(index); $('active-target').append(option);
  });
  const union = element('div', 'target-metric'); union.append(element('h4', '', 'Combined color regions'), metricList([['Inside at least one region', percent(totals.unionArea)], ['Outside every region', percent(totals.outsideArea)]]), element('p', 'hint', 'Overlapping regions can count toward several target areas, but count only once in this union.'));
  $('target-summary').append(union); renderBinGrid(); renderBinDetail(); renderBinTable();
}
function binTarget(bin) { return bin.targets?.find((target) => target.index === state.activeTarget) ?? bin.targets?.[state.activeTarget] ?? {}; }
function binValue(bin, key) {
  if (key === 'effect') return bin.leaveOneOutEffect;
  if (key === 'index' || key === 'coverage') return bin[key];
  return binTarget(bin)[key];
}
function binTooltip(bin) {
  const target = binTarget(bin);
  return `Bin ${bin.index}, ${bin.hex}; ${percent(bin.coverage)} image area; area weight ${number(target.areaWeight, 3)}; quality weight ${number(target.qualityWeight, 3)}; removal effect ${signed(bin.leaveOneOutEffect)}`;
}
function renderBinGrid() {
  const diagnosis = state.diagnosis; if (!diagnosis) return;
  const metric = $('grid-metric').value, maxCoverage = Math.max(...diagnosis.bins.map((bin) => bin.coverage), 1e-12), maxEffect = Math.max(...diagnosis.bins.map((bin) => Math.abs(bin.leaveOneOutEffect ?? 0)), 1e-12);
  const legends = { color: 'Occupied colors are fully visible; empty bins are dimmed. Square size is constant and does not represent image area.', coverage: 'Brightness shows stored coverage relative to the most common bin. Exact percentages appear on selection.', areaWeight: 'Green intensity shows the selected target’s area weight. Query weights exist even when the image contains no pixels in that bin.', qualityWeight: 'Green intensity shows the selected target’s quality weight, including membership and falloff. It is not image coverage.', effect: 'Green supports the score; orange reduces it. Brightness scales with absolute leave-one-bin-out effect. Dark bins have zero or undefined effect.' };
  $('grid-legend').textContent = legends[metric];
  const fragment = document.createDocumentFragment();
  diagnosis.bins.forEach((bin) => {
    const cell = element('button', `bin-cell${bin.occupied ? '' : ' is-empty'}`); cell.type = 'button'; cell.dataset.index = String(bin.index); cell.tabIndex = bin.index === state.selectedBin ? 0 : -1;
    cell.title = binTooltip(bin); cell.setAttribute('aria-label', cell.title); cell.setAttribute('aria-pressed', String(bin.index === state.selectedBin));
    if (metric === 'color') { cell.style.backgroundColor = bin.hex; cell.style.opacity = bin.occupied ? '1' : '.17'; }
    else if (metric === 'coverage') { cell.style.backgroundColor = bin.hex; cell.style.opacity = String(.08 + .92 * Math.sqrt(bin.coverage / maxCoverage)); }
    else if (metric === 'effect') { const effect = bin.leaveOneOutEffect ?? 0; cell.style.backgroundColor = effect >= 0 ? '#85e2b7' : '#f4aa70'; cell.style.opacity = String(.07 + .93 * Math.sqrt(Math.abs(effect) / maxEffect)); }
    else { cell.style.backgroundColor = '#85e2b7'; cell.style.opacity = String(.07 + .93 * Math.max(0, Math.min(1, binValue(bin, metric) ?? 0))); }
    fragment.append(cell);
  });
  $('bin-grid').replaceChildren(fragment);
}
function chooseBin(index, focus = false) {
  if (!state.diagnosis?.bins.some((bin) => bin.index === index)) return;
  const previous = $('bin-grid').querySelector('[aria-pressed="true"]'); if (previous) { previous.setAttribute('aria-pressed', 'false'); previous.tabIndex = -1; }
  state.selectedBin = index;
  const cell = $('bin-grid').querySelector(`[data-index="${index}"]`); if (cell) { cell.setAttribute('aria-pressed', 'true'); cell.tabIndex = 0; if (focus) cell.focus({ preventScroll: true }); }
  renderBinDetail();
  for (const row of $('bin-rows').rows) row.setAttribute('aria-selected', String(Number(row.dataset.index) === index));
}
function renderBinDetail() {
  const bin = state.diagnosis?.bins.find((value) => value.index === state.selectedBin); if (!bin) return;
  const panel = $('bin-detail'); panel.replaceChildren(chip(bin.hex, 'large-chip'), element('h4', '', `Bin ${bin.index} · ${bin.hex}`));
  panel.append(element('p', 'hint', `Exact RGB center ${bin.rgb.map((value) => number(value, 2)).join(', ')}. The hex swatch is its rounded representative.`), metricList([['Sampled pixels', Number(bin.count).toLocaleString()], ['Image area', percent(bin.coverage, 4)], ['Union membership', number(bin.unionWeight, 3)], ['Union area contribution', percent(bin.unionContribution, 4)]]));
  const effect = element('p', `effect-value ${bin.leaveOneOutEffect > 0 ? 'positive' : bin.leaveOneOutEffect < 0 ? 'negative' : ''}`, signed(bin.leaveOneOutEffect)); panel.append(effect, element('p', 'hint', 'Leave-one-bin-out effect · full score minus score after removal and renormalization'), metricList([['Score with this bin removed', number(bin.scoreWithoutBin)]]));
  state.diagnosis.compiled.targets.forEach((target, index) => {
    const values = bin.targets?.find((entry) => entry.index === index) ?? bin.targets?.[index] ?? {};
    const section = element('div', 'target-detail'); section.append(element('h4', '', colorName(target)), metricList([['Area weight', number(values.areaWeight, 4)], ['Quality weight', number(values.qualityWeight, 4)], ['Target area contribution', percent(values.areaContribution, 4)], ['Quality-mass contribution', percent(values.qualityMassContribution, 4)]])); panel.append(section);
  });
}
function renderBinTable() {
  if (!state.diagnosis) return;
  const searchText = $('bin-search').value.trim().toLowerCase(), sortBy = $('bin-sort').value, direction = $('sort-direction').value === 'asc' ? 1 : -1;
  const bins = state.diagnosis.bins.filter((bin) => (!$('present-only').checked || bin.occupied) && (!searchText || `${bin.index} ${bin.hex} ${bin.rgb.map((value) => value.toFixed(2)).join(' ')}`.toLowerCase().includes(searchText)));
  bins.sort((a, b) => { const left = binValue(a, sortBy), right = binValue(b, sortBy); if (!finite(left)) return finite(right) ? 1 : a.index - b.index; if (!finite(right)) return -1; return direction * (left - right) || a.index - b.index; });
  const size = $('page-size').value === 'all' ? Math.max(1, bins.length) : Number($('page-size').value), pages = Math.max(1, Math.ceil(bins.length / size)); state.page = Math.max(0, Math.min(state.page, pages - 1));
  const start = state.page * size, visible = bins.slice(start, start + size), fragment = document.createDocumentFragment();
  for (const bin of visible) {
    const row = element('tr'); row.dataset.index = String(bin.index); row.setAttribute('aria-selected', String(bin.index === state.selectedBin));
    const name = element('td'), choice = button('', 'bin-select', () => chooseBin(bin.index)); choice.append(chip(bin.hex), document.createTextNode(`${bin.index} · ${bin.hex}`)); choice.setAttribute('aria-label', `Select bin ${bin.index}, ${bin.hex}`); name.append(choice); row.append(name);
    const target = binTarget(bin);
    for (const value of [Number(bin.count).toLocaleString(), percent(bin.coverage, 4), number(target.areaWeight, 3), number(target.qualityWeight, 3), percent(target.areaContribution, 4), percent(target.qualityMassContribution, 4)]) row.append(element('td', '', value));
    row.append(element('td', bin.leaveOneOutEffect > 0 ? 'positive' : bin.leaveOneOutEffect < 0 ? 'negative' : '', signed(bin.leaveOneOutEffect))); fragment.append(row);
  }
  if (!visible.length) { const row = element('tr'), cell = element('td', '', 'No bins match these filters.'); cell.colSpan = 8; row.append(cell); fragment.append(row); }
  $('bin-rows').replaceChildren(fragment);
  $('bin-table-caption').textContent = `Target: ${colorName(state.diagnosis.compiled.targets[state.activeTarget])}. Area and quality-mass contributions are fractions of the whole image.`;
  $('table-count').textContent = bins.length ? `Showing ${start + 1}–${start + visible.length} of ${bins.length} matching bins` : '0 matching bins';
  $('previous-page').disabled = state.page === 0; $('next-page').disabled = state.page >= pages - 1;
}

$('query-form').addEventListener('submit', search);
$('cancel-search').addEventListener('click', () => state.searchController?.abort());
$('mode-vibe').addEventListener('click', () => { state.mode = 'vibe'; renderTargets(); });
$('mode-proportions').addEventListener('click', () => { state.mode = 'proportions'; renderTargets(); });
$('add-target').addEventListener('click', () => { state.targets.push({ name: 'green', color: state.colors.find((color) => color.name === 'green')?.color ?? '#25a34a', percent: Math.max(0, 100 - state.targets.reduce((sum, target) => sum + target.percent, 0)) }); renderTargets(); });
$('preset').addEventListener('change', () => usePreset(state.config.presets[Number($('preset').value)]));
$('use-json').addEventListener('change', () => setAdvanced($('use-json').checked));
$('close-inspector').addEventListener('click', closeInspection);
$('inspector').addEventListener('close', () => { if ($('inspector').open) return; state.inspectionController?.abort(); state.inspectionGeneration++; state.opener?.focus({ preventScroll: true }); });
$('inspector').addEventListener('click', (event) => { if (event.target === $('inspector')) { const rect = $('inspector').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeInspection(); } });
$('active-target').addEventListener('change', () => { state.activeTarget = Number($('active-target').value); state.page = 0; renderBinGrid(); renderBinTable(); });
$('grid-metric').addEventListener('change', renderBinGrid);
$('bin-grid').addEventListener('click', (event) => { const cell = event.target.closest('[data-index]'); if (cell) chooseBin(Number(cell.dataset.index)); });
$('bin-grid').addEventListener('keydown', (event) => {
  const index = Number(event.target.dataset.index); if (!Number.isInteger(index)) return;
  const next = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - 64, ArrowDown: index + 64, Home: Math.floor(index / 64) * 64, End: Math.floor(index / 64) * 64 + 63 }[event.key];
  if (next !== undefined) { event.preventDefault(); chooseBin(Math.max(0, Math.min(4095, next)), true); }
});
for (const id of ['present-only', 'bin-sort', 'sort-direction', 'page-size']) $(id).addEventListener('change', () => { state.page = 0; renderBinTable(); });
$('bin-search').addEventListener('input', () => { state.page = 0; renderBinTable(); });
$('previous-page').addEventListener('click', () => { state.page--; renderBinTable(); });
$('next-page').addEventListener('click', () => { state.page++; renderBinTable(); });

try {
  const response = await fetch('/api/config'); if (!response.ok) throw Error(`Could not load inspector configuration (${response.status}).`);
  state.config = await response.json();
  const named = state.config.namedColors ?? { red: '#ed3030', green: '#25a34a', grayscale: '#808080', dark: '#101014', bright: '#ffe550' };
  state.colors = (Array.isArray(named) ? named.map((entry) => Array.isArray(entry) ? { name: entry[0], color: entry[1], label: title(entry[0]) } : { ...entry, color: entry.color ?? entry.hex, label: entry.label ?? title(entry.name) }) : Object.entries(named).map(([name, color]) => ({ name, color, label: title(name) }))).filter((entry) => !['monochromatic', 'rainbow'].includes(entry.name));
  const corpus = state.config.corpus ?? {};
  $('corpus-summary').textContent = `${corpus.real ?? '—'} wallpapers + ${corpus.fixtures ?? '—'} controlled fixtures · one histogram method`;
  $('fixture-label').textContent = `Include ${corpus.fixtures ?? ''} controlled test swatches`;
  state.config.presets ??= [{ label: 'Feels red', query: naturalQuery() }];
  state.config.presets.forEach((preset, index) => { const option = element('option', '', preset.label); option.value = String(index); $('preset').append(option); });
  usePreset(state.config.presets[0]); await search();
} catch (error) {
  $('corpus-summary').textContent = 'Inspector unavailable'; $('search-status').className = 'error'; $('search-status').textContent = error.message;
}
