// Throwaway inspector. Wallpaper ranking and score diagnostics come from OpenSearch.
// Local sorting applies only to the regions within one already-selected wallpaper.
import { layoutMatchingColors } from './overlap-color-layout.mjs';
import { colorLayerOptions, colorLayerRequest } from './overlap-color-layers.mjs';
const $ = id => document.getElementById(id);
const state = { config: null, mode: 'vibe', targets: [{ color: '#ff0000', percent: 40 }], advanced: false, method: 'overlap-quality-dense',
  searchGeneration: 0, inspectionGeneration: 0, searchController: null, inspectionController: null, searching: false,
  resultsQuery: null, resultsMethod: null, resultsParameters: null, diagnosis: null, selectedRegion: 0, page: 0,
  qualityInfluence: 1, qualityCurve: 'power', minimumQuality: 0, bucketCount: 1024, pixelCutoff: .5, cutoffBlendExponent: 0, namedMode: 'concrete-swatches', live: false, liveTimer: null, searchIsLive: false, ready: false,
  colorsGeneration: 0, colorsController: null, colorsData: null, colorsAxis: 'lightness', colorsOpener: null,
  colorsSnapshot: null, colorsRegion: null, colorsLayer: 'current' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const percent = (value, digits = 2) => finite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
const number = (value, digits = 5) => finite(value) ? (value !== 0 && Number(value.toFixed(digits)) === 0 ? value.toExponential(2) : value.toFixed(digits)) : '—';
const sampleMatches = sample => sample.matches ?? sample.quality > 0;
const colorSampleScale = sample => Math.max(.2, sample.displayWeight ?? sample.quality);
const colorSampleLabel = sample => finite(sample.weight)
  ? `${sampleMatches(sample) ? `${percent(sample.weight, 1)} area weight` : 'Does not count'} · ${percent(sample.referenceQuality, 1)} closeness · ${percent(sample.displayWeight, 1)} quality mass`
  : sampleMatches(sample) ? `${percent(sample.quality, 1)} quality` : 'Does not count · 0% quality';
const qualityLabel = parameters => `${Number(parameters?.qualityInfluence ?? 1).toFixed(2)}× quality influence`;
const curveLabel = parameters => parameters?.qualityCurve === 'power' ? 'Smooth power' : 'Original linear penalty';
// Preview only: OpenSearch uses the backend's independently computed component weights.
function cutoffBlendWeights(exponent) {
  const entries = [0, .25, .5, .75, .9].map(cutoff => ({ cutoff, weight: Math.exp(exponent * (cutoff / .9 - 1)) }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.map(entry => ({ cutoff: entry.cutoff, weight: entry.weight / total }));
}
const blendWeightLabel = weight => percent(weight, 3);
const allCutoffLabel = parameters => `all five cutoffs · weighting ${Number(parameters.cutoffBlendExponent).toFixed(1)} · ${cutoffBlendWeights(parameters.cutoffBlendExponent).map(entry => `${percent(entry.cutoff, 0)} → ${blendWeightLabel(entry.weight)}`).join(', ')}`;
const scoringLabel = parameters => `${(parameters?.bucketCount ?? 1024).toLocaleString()} buckets${parameters?.cutoffBlendExponent !== undefined ? ` · ${allCutoffLabel(parameters)} · ${parameters.namedMode}` : parameters?.pixelCutoff !== undefined ? ` · ${percent(parameters.pixelCutoff, 0)} pixel cutoff · ${parameters.namedMode}` : ''} · ${curveLabel(parameters)} · ${qualityLabel(parameters)} · minimum average quality ${percent(parameters?.minimumQuality ?? 0, 0)}`;
const thresholdStatus = term => term.qualityThresholdApplies === false ? 'Exempt (0% target)' : term.summaryOnly ? (term.passesMinimumQuality ? 'All components pass' : term.anyComponentPassesMinimumQuality ? 'Some components pass · see below' : 'No components pass') : term.passesMinimumQuality === false ? 'Below minimum · contributes 0' : 'Passes';
const isCutoff = method => method?.startsWith('cutoff-');
const isAllCutoffs = method => ['cutoff-all-levels', 'cutoff-shade-all-levels', 'cutoff-shade-hue-all-levels'].includes(method);
const isShadeAware = method => ['cutoff-shade-all-levels', 'cutoff-shade-hue-all-levels'].includes(method);
const isStrictHue = method => method === 'cutoff-shade-hue-all-levels';
const isBlendedProfile = profile => ['consensus', 'all-levels'].includes(profile);
const coverageLabel = definition => isBlendedProfile(definition?.profile) ? 'Weighted component summary' : ['feather', 'core-halo'].includes(definition?.profile) ? 'Effective coverage' : 'Physical coverage';
const coverageHelp = definition => isBlendedProfile(definition?.profile)
  ? 'Each cutoff is scored independently, then those scores are blended. Coverage and quality shown for a region are weighted summaries; they are not used as a single blended scoring input.'
  : ['feather', 'core-halo'].includes(definition?.profile)
    ? 'Coverage is effective area: a pixel admitted at half weight counts as half its area. Conditional quality is weighted by the same admission weight. Physical area inside the outer boundary is also shown in the detail panel.'
    : 'Coverage is the physical image area inside the selected color range. Conditional quality is the average closeness of those matching pixels to the anchor.';
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
  const cutoff = isCutoff(state.method), allCutoffs = isAllCutoffs(state.method), shadeAware = isShadeAware(state.method), strictHue = isStrictHue(state.method), profile = allCutoffs ? 'all-levels' : state.method.replace('cutoff-', '');
  $('cutoff-controls').hidden = !cutoff;
  $('pixel-cutoff-field').hidden = allCutoffs;
  $('pixel-cutoff').disabled = allCutoffs;
  $('cutoff-blend-controls').hidden = !allCutoffs;
  $('cutoff-blend-value').value = state.cutoffBlendExponent.toFixed(1);
  $('cutoff-blend-exponent').setAttribute('aria-valuetext', `${state.cutoffBlendExponent.toFixed(1)}${state.cutoffBlendExponent === 0 ? ', equal weights for all five cutoffs' : ', exponentially favoring stricter cutoffs'}`);
  $('cutoff-blend-weights').replaceChildren(...cutoffBlendWeights(state.cutoffBlendExponent).map(entry => {
    const row = element('div', 'cutoff-blend-weight'); row.dataset.cutoff = entry.cutoff; row.dataset.weight = entry.weight;
    const bar = element('span', 'cutoff-blend-bar'), fill = element('span'); bar.setAttribute('aria-hidden', 'true'); fill.style.width = `${entry.weight * 100}%`; bar.append(fill);
    row.append(element('span', '', `${percent(entry.cutoff, 0)} cutoff`), bar, element('output', '', blendWeightLabel(entry.weight))); return row;
  }));
  $('coverage-semantics').hidden = !cutoff;
  $('coverage-semantics').textContent = coverageHelp({ profile });
  $('method-help').textContent = strictHue ? 'Shade-aware + strict hue: retains the deeper-shade tolerance and requires hues to stay closer to the requested color. Hue credit fades smoothly outside a close central range. Neutral anchors keep their original measurement; all five cutoffs use freshly measured coverage and quality.' : shadeAware ? 'Shade-aware: deeper shades of the same color receive more credit. Hue and chroma differences still matter; neutral anchors retain the original closeness measurement. All five cutoffs use separately measured shade-aware coverage and quality.' : cutoff ? state.config?.cutoffProfiles.find(item => item.id === profile)?.description : state.method === 'overlap-quality-dense'
    ? 'Dense regions: picked colors and concrete names such as red resolve to a nearby anchor. Abstract vibes such as dark and grayscale retain their broader definitions.'
    : 'Hybrid: named colors and vibes keep their broad definitions. Picked hex colors use the dense regions. Change a swatch to try a precise color.';
  $('cutoff-help').textContent = allCutoffs
    ? 'All five stored cutoffs are always used: 0%, 25%, 50%, 75%, and 90%. Each level measures and scores the wallpaper separately before its score is blended.'
    : `Only colors within OKLab distance ${number(.24 * (1 - state.pixelCutoff), 3)} of the anchor can contribute. Higher cutoffs require closer matches.${profile === 'consensus' ? ' This level and the next two stricter levels receive 20%, 30%, and 50% of the score; repeated strictest levels merge.' : ''}`;
  $('range-help').textContent = cutoff
    ? `${allCutoffs ? 'Each cutoff controls admission into its own stored measurements. Cutoff weighting blends the five separately calculated scores.' : 'Pixel cutoff controls admission before the image measurements are stored.'} Minimum average quality gates each measured bin afterward. These are separate controls. ${shadeAware ? `Closeness uses shade-aware OKLab geometry with reduced lightness penalty and partial shade normalization.${strictHue ? ' An additional hue factor reduces credit for neighboring hues before each cutoff is measured.' : ''}` : 'Closeness uses OKLab distance from the stored anchor, not a percentage of RGB or hue.'}`
    : 'Original baseline: radius 0.12, quality 100% at the anchor to 50% at the edge, where pixels stop counting. Picked colors use the nearest stored anchor.';
  $('quality-value').value = `${state.qualityInfluence.toFixed(2)}×`;
  $('quality-influence').setAttribute('aria-valuetext', qualityLabel({ qualityInfluence: state.qualityInfluence }));
  $('quality-help').textContent = state.qualityCurve === 'power'
    ? 'Smooth power: quality is raised to the slider value. At 3×, a 60% match keeps a 0.216 quality factor in vibe mode. Percentage queries apply the power to their existing weighted quality factor. Both curves match at 0× and 1×.'
    : 'Original linear penalty: stronger influence can reduce a match to zero. At 3× in vibe mode, average quality of 66.7% or less contributes nothing, even with minimum quality at 0%. Both curves match at 0× and 1×.';
  $('reset-quality').disabled = state.qualityInfluence === 1;
  $('minimum-quality-value').value = percent(state.minimumQuality, 0);
  $('minimum-quality').setAttribute('aria-valuetext', `${percent(state.minimumQuality, 0)} minimum quality`);
  $('reset-minimum-quality').disabled = state.minimumQuality === 0;
  $('bucket-description').textContent = `${state.bucketCount.toLocaleString()} overlapping color regions, each with its own coverage and match quality. A pixel can belong to several regions.`;
}
function cancelSearch() {
  clearTimeout(state.liveTimer); state.liveTimer = null;
  state.searchGeneration++; state.searchController?.abort(); state.searching = false;
  $('cancel-search').hidden = true; updatePreview();
}
function queueLiveSearch() {
  if (!state.ready || !state.live) return;
  // Invalidate immediately, so a slow old response cannot replace newer controls.
  cancelSearch();
  $('search-status').className = ''; $('search-status').textContent = 'Waiting for your changes before updating…';
  $('cancel-search').hidden = false;
  state.liveTimer = setTimeout(() => { state.liveTimer = null; search(undefined, true); }, 350);
}
function queryEdited() { updatePreview(); queueLiveSearch(); }
function setAdvanced(enabled) { state.advanced = enabled; $('use-json').checked = enabled; $('query-json').readOnly = !enabled; $('natural-controls').disabled = enabled; queryEdited(); }
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
    const usePicked = color => { target.color = color; delete target.name; choice.value = 'picked'; picker.value = color; hex.value = color; queryEdited(); };
    picker.addEventListener('input', () => usePicked(picker.value));
    hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) usePicked(hex.value); else queueLiveSearch(); });
    row.append(picker, hex);
    if (state.mode === 'proportions') {
      const amount = element('input', 'portion-input'); amount.type = 'number'; amount.min = '0'; amount.max = '100'; amount.step = 'any'; amount.required = true; amount.value = target.percent ?? 0; amount.setAttribute('aria-label', `Image percentage for color ${index + 1}`);
      amount.addEventListener('input', () => { target.percent = Number(amount.value); queryEdited(); }); row.append(amount, element('span', 'hint', '%'));
    }
    card.append(row); $('targets').append(card);
  });
  $('mode-vibe').setAttribute('aria-pressed', String(state.mode === 'vibe')); $('mode-proportions').setAttribute('aria-pressed', String(state.mode === 'proportions'));
  $('mode-help').textContent = state.mode === 'proportions' ? 'Aim close to each requested amount. Excess requested color is penalized more strongly.' : 'Reward substantial matching area and high color quality. Accent-specific queries are not supported here.';
  queryEdited();
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
function cancelRegionColors() { state.colorsController?.abort(); state.colorsGeneration++; }
function closeRegionColors() { cancelRegionColors(); if ($('color-dialog').open) $('color-dialog').close(); state.colorsOpener?.focus(); }
function closeInspection() { state.inspectionController?.abort(); state.inspectionGeneration++; closeRegionColors(); if ($('inspector').open) $('inspector').close(); }
async function search(event, live = false) {
  event?.preventDefault(); clearTimeout(state.liveTimer); state.liveTimer = null; let query;
  try {
    if (!(live ? $('query-form').checkValidity() : $('query-form').reportValidity())) throw Error('Complete the color and percentage fields before searching.');
    query = clone(currentQuery());
  }
  catch (error) { $('cancel-search').hidden = true; $('search-status').textContent = `${live ? 'Live update paused: ' : ''}${error.message}`; $('search-status').className = 'error'; return; }
  const parameters = { qualityInfluence: state.qualityInfluence, qualityCurve: state.qualityCurve, minimumQuality: state.minimumQuality, bucketCount: state.bucketCount,
    ...(isCutoff(state.method) ? { namedMode: state.namedMode, ...(isAllCutoffs(state.method) ? { cutoffBlendExponent: state.cutoffBlendExponent } : { pixelCutoff: state.pixelCutoff }) } : {}) };
  const method = state.method; state.searchController?.abort(); const generation = ++state.searchGeneration, controller = new AbortController(); state.searchController = controller;
  closeInspection(); state.searching = true; state.searchIsLive = live; updatePreview(); $('cancel-search').hidden = false; $('search-status').className = ''; $('search-status').textContent = 'OpenSearch is filtering and ranking the wallpapers…';
  try {
    const result = await post('/api/search', { methodId: method, query, parameters, limit: Number($('result-limit').value) }, controller.signal);
    if (generation !== state.searchGeneration) return;
    state.resultsQuery = query; state.resultsMethod = method; state.resultsParameters = clone(result.parameters ?? parameters); renderGallery(result.hits);
    $('method-tag').textContent = method; $('results-summary').textContent = `${result.hits.length} results · ${number(result.elapsedMs, 1)} ms · service order preserved`;
    $('query-caption').hidden = false; $('query-caption').textContent = `Results for ${querySummary(query)} · ${scoringLabel(state.resultsParameters)}`;
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
  closeRegionColors();
  state.inspectionController?.abort(); const generation = ++state.inspectionGeneration, controller = new AbortController(); state.inspectionController = controller;
  const query = clone(state.resultsQuery), method = state.resultsMethod, parameters = clone(state.resultsParameters); state.diagnosis = null;
  $('inspector-title').textContent = hit.id; $('inspection-content').hidden = true; $('inspection-status').className = ''; $('inspection-status').textContent = 'Reading stored regions and OpenSearch score diagnostics…';
  if (!$('inspector').open) $('inspector').showModal(); $('close-inspector').focus(); $('inspector').querySelector('.dialog-content').scrollTop = 0;
  try {
    const diagnosis = await post('/api/inspect', { methodId: method, id: hit.id, query, parameters }, controller.signal);
    if (generation !== state.inspectionGeneration || !$('inspector').open) return;
    const expectedCount = parameters.bucketCount ?? 1024;
    if (!Array.isArray(diagnosis.regions) || diagnosis.regions.length !== expectedCount || diagnosis.definition?.anchorCount !== expectedCount || !Array.isArray(diagnosis.score?.terms)) throw Error('Incomplete region diagnostics returned.');
    state.diagnosis = diagnosis; state.page = 0;
    state.selectedRegion = diagnosis.regions.find(region => region.selectedBy.length)?.index ?? diagnosis.regions.reduce((largest, region) => region.coverage > largest.coverage ? region : largest, diagnosis.regions[0]).index;
    $('inspection-image').src = diagnosis.imageUrl; $('inspection-image').alt = `Wallpaper ${hit.id}`; $('original-link').href = diagnosis.imageUrl;
    $('inspection-query').textContent = `${querySummary(query)} · ${method} · ${scoringLabel(parameters)}`; $('inspection-status').textContent = ''; $('inspection-content').hidden = false;
    $('present-only').checked = true; $('bin-search').value = ''; $('bin-sort').value = 'coverage'; $('sort-direction').value = 'desc';
    renderInspection();
  } catch (error) { if (generation === state.inspectionGeneration) { $('inspection-status').className = 'error'; $('inspection-status').textContent = error.name === 'AbortError' ? 'Inspection canceled.' : error.message; } }
}
function renderInspection() {
  const diagnosis = state.diagnosis;
  $('bin-heading').textContent = `All ${diagnosis.regions.length.toLocaleString()} overlapping regions`;
  $('bin-coverage-help').textContent = `${coverageHelp(diagnosis.definition)} Original pixels are sampled before membership is measured; a reduced palette is not used.`;
  const areaLabel = coverageLabel(diagnosis.definition);
  document.querySelector('.bin-table thead tr th:nth-child(2)').textContent = areaLabel;
  document.querySelector('.bin-table caption').textContent = `${areaLabel} and quality for this wallpaper${isBlendedProfile(diagnosis.definition.profile) ? ' · blended summaries; inspect components for stored values' : ''}`;
  $('grid-metric').querySelector('option[value="coverage"]').textContent = areaLabel;
  $('bin-sort').querySelector('option[value="coverage"]').textContent = areaLabel;
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
      ...(term.summaryOnly ? [] : [['Coverage field', term.coverageField], ['Quality field', term.qualityField]]), [term.summaryOnly ? 'Summary coverage' : term.coverageKind === 'effective' ? 'Effective coverage' : 'Observed coverage', percent(term.coverage)], ['Conditional quality', percent(term.conditionalQuality)],
      ...(term.coverageKind === 'effective' ? [['Physical area within support', percent(term.physicalCoverage)]] : []),
      ['Minimum quality', percent(diagnosis.parameters.minimumQuality ?? 0, 0)], ['Quality threshold', thresholdStatus(term)],
      ...(diagnosis.compiled.mode === 'proportions' ? [['Requested coverage', percent(term.amount)], ['Area factor', number(term.areaFactor)], ['Quality factor', number(term.qualityFactor)]] : [['Area factor', number(term.areaFactor)], ['Quality factor', number(term.qualityFactor)]]),
      ['Target weight', number(term.weight)], ['Score contribution', number(term.scoreContribution)],
    ]));
    if (term.summaryOnly) {
      card.append(element('p', 'hint', 'The score is the sum of these independent components. The averages above are display summaries.'));
      for (const component of term.components) card.append(element('h4', '', `${percent(component.pixelCutoff, 0)} cutoff · ${blendWeightLabel(component.componentWeight)} blend weight`), metrics([
        ['Coverage field', component.coverageField], ['Quality field', component.qualityField], ['Coverage', percent(component.coverage)], ['Conditional quality', percent(component.conditionalQuality)],
        ['Area factor', number(component.areaFactor)], ['Quality factor', number(component.qualityFactor)], ['Quality threshold', thresholdStatus(component)], ['Score contribution', number(component.scoreContribution)],
      ]));
    }
    if (term.regionIndex != null) card.append(button('Inspect this region', 'secondary full', () => { selectRegion(term.regionIndex); $('bin-detail').scrollIntoView({ block: 'nearest' }); }));
    $('target-summary').append(card);
  }
  renderGrid(); renderDetail(); renderTable();
}
function regionTitle(region) { return `Region ${region.index} · ${region.hex} · coverage ${percent(region.coverage)} · quality ${percent(region.conditionalQuality)}${region.selectedBy.length ? ` · query targets ${region.selectedBy.map(i => i + 1).join(', ')}` : ''}`; }
function colorGridOrder(regions) {
  // A stable color atlas: nearby hues in columns, dark-to-light within each column.
  // Near-neutral anchors lead the hue sequence because their hue is not meaningful.
  const hue = region => Math.hypot(region.lab[1], region.lab[2]) < .035 ? -1
    : (Math.atan2(region.lab[2], region.lab[1]) * 180 / Math.PI - 20 + 360) % 360;
  const byHue = [...regions].sort((a, b) => hue(a) - hue(b) || a.lab[0] - b.lab[0] || a.index - b.index);
  const side = Math.sqrt(regions.length);
  const columns = Array.from({ length: side }, (_, column) => byHue.slice(column * side, (column + 1) * side)
    .sort((a, b) => a.lab[0] - b.lab[0] || hue(a) - hue(b) || a.index - b.index));
  return byHue.map((_, position) => columns[position % side][Math.floor(position / side)]);
}
function renderGrid() {
  const metric = $('grid-metric').value, fragment = document.createDocumentFragment(); $('bin-grid').replaceChildren();
  const contributions = new Map();
  for (const term of state.diagnosis.score.terms) if (term.regionIndex != null) contributions.set(term.regionIndex, (contributions.get(term.regionIndex) ?? 0) + term.scoreContribution);
  const regions = colorGridOrder(state.diagnosis.regions);
  const side = Math.sqrt(regions.length), gridWidth = regions.length === 1024 ? 'none' : `${Math.max(320, side * 40)}px`;
  $('bin-grid').style.gridTemplateColumns = `repeat(${side}, minmax(0, 1fr))`;
  $('bin-grid').style.maxWidth = gridWidth; $('grid-axis').style.maxWidth = gridWidth;
  $('bin-grid').setAttribute('aria-label', `${regions.length.toLocaleString()} overlapping color regions, grouped by hue from left to right and dark to light from top to bottom. Use arrow keys to move.`);
  const valueFor = region => metric === 'score' ? contributions.get(region.index) ?? 0 : metric === 'coverage' ? region.coverage : metric === 'quality' ? region.conditionalQuality : 1;
  const maximum = Math.max(0, ...regions.map(valueFor));
  const namedCount = state.diagnosis.score.terms.filter(term => term.regionIndex == null).length;
  $('grid-legend').textContent = {
    score: 'Square size shows its contribution to this score. Regions contributing nothing shrink to tiny squares; the largest contribution fills its cell.',
    coverage: 'Square size shows image coverage, relative to the most populated region. Empty regions shrink to tiny squares. Coverage does not imply a score contribution.',
    quality: 'Square size shows conditional color quality, relative to the highest quality in this image. Regions with no matching pixels shrink to tiny squares.',
    color: 'All anchor colors at full size. Use the other views to see score contribution, image coverage or color quality.',
  }[metric] + (metric === 'score' && namedCount ? ` ${namedCount} broad named ${namedCount === 1 ? 'feature contributes' : 'features contribute'} through the target cards above, rather than these dense regions.` : '');
  for (const [position, region] of regions.entries()) {
    const cell = button('', `bin-cell${region.selectedBy.length ? ' is-used' : ''}`, () => { selectRegion(region.index); openRegionColors(region); });
    const contribution = contributions.get(region.index) ?? 0, value = valueFor(region);
    cell.dataset.index = region.index; cell.dataset.contribution = contribution; cell.dataset.gridValue = value;
    cell.title = `${regionTitle(region)} · score contribution ${number(contribution)}`; cell.setAttribute('aria-label', cell.title); cell.setAttribute('aria-pressed', String(region.index === state.selectedRegion)); cell.tabIndex = region.index === state.selectedRegion ? 0 : -1;
    const swatch = chip(region.hex, 'bin-swatch');
    swatch.style.transform = `scale(${maximum > 0 ? .22 + .78 * Math.sqrt(value / maximum) : .22})`;
    cell.append(swatch);
    cell.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -side, ArrowDown: side };
      let next = position + (offsets[event.key] ?? 0);
      if (event.key === 'Home') next = Math.floor(position / side) * side;
      else if (event.key === 'End') next = Math.floor(position / side) * side + side - 1;
      else if (!(event.key in offsets)) return;
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (next < 0 || next >= regions.length)) next = position;
      event.preventDefault(); const index = regions[Math.max(0, Math.min(regions.length - 1, next))].index;
      selectRegion(index); $('bin-grid').querySelector(`[data-index="${index}"]`).focus();
    }); fragment.append(cell);
  }
  $('bin-grid').append(fragment);
}
function selectRegion(index) { state.selectedRegion = index; for (const cell of $('bin-grid').children) { const selected = Number(cell.dataset.index) === index; cell.setAttribute('aria-pressed', String(selected)); cell.tabIndex = selected ? 0 : -1; } renderDetail(); renderTable(); }
function renderDetail() {
  const region = state.diagnosis.regions.find(region => region.index === state.selectedRegion), detail = $('bin-detail'); detail.replaceChildren();
  detail.append(chip(region.hex, 'large-chip'), element('h4', '', `Region ${region.index} · ${region.hex}`));
  detail.append(button('Explore matching colors ↗', 'secondary full', () => openRegionColors(region)));
    detail.append(element('h4', 'wallpaper-bin-heading', 'Measured in this wallpaper'), metrics([
    ['Key', region.key], [coverageLabel(state.diagnosis.definition), percent(region.coverage)], ['Conditional quality', percent(region.conditionalQuality)], ['Quality mass', percent(region.qualityMass)],
    ...(finite(region.physicalCoverage) ? [['Physical area within support', percent(region.physicalCoverage)]] : []),
    ['OKLab anchor', region.lab.map(value => number(value, 4)).join(', ')], ['Used by target(s)', region.selectedBy.length ? region.selectedBy.map(index => index + 1).join(', ') : 'None'],
  ]));
  detail.append(element('p', 'hint', 'Quality mass is coverage × quality. Coverage and conditional quality are stored separately; mass is shown only to explain their relationship.'));
  if (region.summaryOnly) {
    detail.append(element('p', 'hint', 'Weighted summaries above; scores use the separate measurements below.'));
    for (const component of region.components) detail.append(element('h4', '', `${percent(component.pixelCutoff, 0)} cutoff · ${blendWeightLabel(component.componentWeight)} blend weight`), metrics([
      ['Coverage', percent(component.coverage)], ['Conditional quality', percent(component.conditionalQuality)], ['Coverage field', component.coverageField],
    ]));
  }
  for (const term of state.diagnosis.score.terms.filter(term => term.regionIndex === region.index)) detail.append(element('p', 'region-note', `Target ${term.targetIndex + 1} contributes ${number(term.scoreContribution)} to this score ${term.summaryOnly ? `across ${term.components.length} independently scored cutoffs` : `using ${term.coverageField} and ${term.qualityField}`}.${term.passesMinimumQuality === false ? term.summaryOnly ? ' Components below the minimum average quality contribute zero.' : ` Its quality is below the ${percent(state.diagnosis.parameters.minimumQuality, 0)} minimum.` : ''}`));
  if (!region.selectedBy.length) detail.append(element('p', 'region-note', 'This region is not read by this query and contributes no separate score term.'));
}
async function openRegionColors(region) {
  state.colorsSnapshot = clone({ method: state.diagnosis.method, definition: state.diagnosis.definition, parameters: state.diagnosis.parameters });
  state.colorsRegion = region;
  const options = colorLayerOptions(state.colorsSnapshot);
  state.colorsLayer = options[0]?.value ?? 'current';
  $('color-layer-controls').hidden = !options.length;
  $('color-layer').replaceChildren(...options.map(({ value, label }) => { const option = element('option', '', label); option.value = value; return option; }));
  $('color-layer').value = state.colorsLayer;
  state.colorsOpener = $('bin-grid').querySelector(`[data-index="${region.index}"]`);
  if (!$('color-dialog').open) $('color-dialog').showModal();
  $('close-color-dialog').focus(); $('color-dialog').querySelector('.dialog-content').scrollTop = 0;
  await loadRegionColorLayer();
}
async function loadRegionColorLayer() {
  cancelRegionColors(); state.colorsData = null;
  const generation = state.colorsGeneration, controller = new AbortController(); state.colorsController = controller;
  const snapshot = state.colorsSnapshot, region = state.colorsRegion, layer = state.colorsLayer;
  const count = snapshot.parameters.bucketCount ?? 1024;
  const options = colorLayerOptions(snapshot), selected = options.find(option => option.value === layer);
  $('color-dialog-title').textContent = `Region ${region.index} · ${region.hex} · ${selected?.label ?? 'matching colors'}`;
  $('color-layer-help').textContent = layer === 'combined'
    ? 'Combined view uses the cutoff weights from this inspected search. Choose a layer to see its color range on its own.'
    : layer === 'current'
      ? 'Current profile uses this inspected search. Individual layers show their own color range without changing the search.'
      : options[0]?.value === 'combined'
        ? 'This layer is shown on its own, before its blend weight is applied. Choose the combined view to restore the inspected weighting. This does not change the search.'
        : 'This layer uses the selected profile at its own cutoff. Choose the current profile to restore the inspected setting. This does not change the search.';
  $('matching-status').className = 'hint'; $('matching-status').textContent = 'Loading matching colors…'; $('matching-colors').replaceChildren();
  $('matching-panel').setAttribute('aria-busy', 'true');
  setColorAxis(state.colorsAxis);
  try {
    const params = new URLSearchParams(colorLayerRequest(snapshot, region.index, layer));
    const response = await fetch(`/api/region-colors?${params}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? 'Could not load matching colors.');
    if (generation !== state.colorsGeneration || !$('color-dialog').open || !$('inspector').open) return;
    if (data.region?.index !== region.index || data.region?.hex !== region.hex || !Array.isArray(data.samples) || !data.samples.length) throw Error('Incomplete matching-color samples.');
    state.colorsData = { ...data, bucketCount: count, layer, executedParameters: clone(snapshot.parameters) };
    $('matching-status').textContent = `${data.samples.length.toLocaleString()} matching examples, plus reference colors across the full range. Colors that do not count stay visible as tiny squares.`;
    renderMatchingPlane();
  } catch (error) {
    if (generation !== state.colorsGeneration || error.name === 'AbortError') return;
    $('matching-status').className = 'error'; $('matching-status').textContent = error.message;
    $('matching-colors').append(button('Retry matching colors', 'secondary', loadRegionColorLayer));
  } finally {
    if (generation === state.colorsGeneration) $('matching-panel').setAttribute('aria-busy', 'false');
  }
}
function setColorAxis(axis) {
  state.colorsAxis = axis;
  for (const value of ['lightness', 'saturation']) {
    const tab = $(`color-tab-${value}`), selected = value === axis;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
  }
  $('matching-panel').setAttribute('aria-labelledby', `color-tab-${axis}`);
  if (state.colorsData) renderMatchingPlane();
}
function renderMatchingPlane() {
  const data = state.colorsData, axis = state.colorsAxis, layout = layoutMatchingColors(data.samples, { axis, anchorHex: data.region.hex, contextSamples: data.contextPlanes?.[axis] ?? [] });
  const container = $('matching-colors'); container.replaceChildren();
  const axisName = title(axis), otherAxis = axis === 'lightness' ? 'saturation' : 'lightness';
  container.append(element('p', 'hint', `Hue changes left → right in 5° steps. ${axisName} increases top → bottom in 5% steps. Each cell shows its best sampled match, or a tiny reference color when none of its samples count. Select a cell to inspect its colors. ${title(otherAxis)} can vary within a cell. Scroll horizontally on smaller screens.`));
  const scroll = element('div', 'matching-plane-scroll'), plane = element('div', 'matching-plane');
  const vertical = element('div', 'matching-y-axis'); vertical.setAttribute('aria-hidden', 'true');
  vertical.append(element('span', 'matching-axis-name', `${axisName} ↓`));
  for (const value of [0, .25, .5, .75, 1]) vertical.append(element('span', '', percent(value, 0)));
  const horizontal = element('div', 'matching-x-axis'); horizontal.setAttribute('aria-hidden', 'true');
  for (let column = 0; column <= 60; column += 12) {
    const hue = (layout.hueStart + column * layout.hueStep + 360) % 360, tick = element('span', '', `${Math.round(hue)}°`);
    tick.style.gridColumn = `${column + 1} / span 6`; tick.style.borderTopColor = `hsl(${hue} 100% 50%)`; horizontal.append(tick);
  }
  const neutral = element('span', '', 'Gray'); neutral.className = 'matching-neutral-label'; neutral.style.gridColumn = `${layout.neutralColumn + 1}`; horizontal.append(neutral);
  const grid = element('div', 'matching-grid'); grid.id = 'matching-grid';
  grid.dataset.regionIndex = data.region.index; grid.dataset.bucketCount = data.bucketCount; grid.dataset.axis = axis;
  grid.dataset.layer = data.layer; grid.dataset.profile = data.definition.profile ?? 'original';
  grid.dataset.metric = data.definition.metric ?? 'oklab';
  grid.dataset.cutoff = data.definition.cutoff ?? '';
  grid.dataset.columns = layout.columns; grid.dataset.rows = layout.rows;
  grid.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
  horizontal.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', `Matching colors by HSL hue horizontally and ${axis} vertically. Use arrow keys to move between occupied cells.`);
  const group = element('section', 'matching-cell-samples'), groupHeading = element('h3'); groupHeading.id = 'matching-cell-heading';
  group.setAttribute('aria-labelledby', groupHeading.id);
  const strip = element('div', 'matching-cell-strip'); strip.id = 'matching-cell-strip';
  const description = element('p', 'matching-sample-detail'); description.id = 'matching-sample-detail'; description.setAttribute('aria-live', 'polite');
  const show = sample => {
    description.replaceChildren(chip(sample.hex), element('span', '', `${sample.hex} · ${colorSampleLabel(sample)}${sample.isAnchor ? ' · bin center' : ''} · H ${sample.hsl.hue === null ? 'none' : `${number(sample.hsl.hue, 1)}°`} · S ${percent(sample.hsl.saturation, 1)} · L ${percent(sample.hsl.lightness, 1)} · distance ${number(sample.distance, 4)}`));
    if (finite(sample.hueGate)) description.append(element('span', '', `OKLab hue gap: ${finite(sample.hueGapDegrees) ? `${number(sample.hueGapDegrees, 1)}°` : 'not defined for a neutral color'} · hue credit: ${percent(sample.hueGate, 1)}. The hue angle used for matching differs from the HSL browsing axis.`));
    if (sample.components?.length > 1) description.append(element('span', '', `Components: ${sample.components.map(component => `${percent(component.cutoff, 0)} cutoff → ${percent(component.pixelWeight, 1)} pixel weight (score blend ${blendWeightLabel(component.scoreWeight)})`).join('; ')}`));
    description.dataset.hex = sample.hex; description.dataset.quality = sample.quality;
  };
  const buttons = [];
  const choose = (cell, position) => {
    for (const [index, node] of buttons.entries()) if (node) { node.setAttribute('aria-pressed', String(index === position)); node.tabIndex = index === position ? 0 : -1; }
    const hue = cell.column === layout.neutralColumn ? 'no hue (grayscale)' : `hue ${Math.round((layout.hueStart + cell.column * layout.hueStep + 360) % 360)}°`;
    const matchingCount = cell.samples.filter(sampleMatches).length;
    groupHeading.textContent = `${cell.samples.length} ${cell.samples.length === 1 ? 'color' : 'colors'} · ${matchingCount} ${matchingCount === 1 ? 'counts' : 'count'} · near ${hue}, ${axis} ${percent(cell.row * layout.axisStep, 0)}`;
    strip.replaceChildren();
    for (const sample of [...cell.samples].sort((a, b) => a.hsl[otherAxis] - b.hsl[otherAxis] || b.quality - a.quality)) {
      const swatchButton = button('', `matching-cell${sample.isAnchor ? ' is-anchor' : ''}`, () => show(sample));
      swatchButton.dataset.hex = sample.hex; swatchButton.dataset.quality = sample.quality; swatchButton.dataset.displayWeight = sample.displayWeight ?? sample.quality;
      swatchButton.dataset.matches = String(sampleMatches(sample));
      swatchButton.title = `${sample.hex} · ${colorSampleLabel(sample)}`; swatchButton.setAttribute('aria-label', swatchButton.title);
      const swatch = chip(sample.hex, 'matching-swatch'); swatch.style.transform = `scale(${colorSampleScale(sample)})`; swatchButton.append(swatch);
      swatchButton.addEventListener('pointerenter', () => show(sample)); swatchButton.addEventListener('focus', () => show(sample)); strip.append(swatchButton);
    }
    show(cell.representative);
  };
  for (const [position, cell] of layout.cells.entries()) {
    if (!cell) { const empty = element('span', 'matching-empty'); empty.setAttribute('aria-hidden', 'true'); grid.append(empty); buttons.push(null); continue; }
    const sample = cell.representative, node = button('', `matching-cell${sample.isAnchor ? ' is-anchor' : ''}`, () => choose(cell, position));
    node.dataset.hex = sample.hex; node.dataset.quality = sample.quality; node.dataset.displayWeight = sample.displayWeight ?? sample.quality; node.dataset.column = cell.column; node.dataset.row = cell.row; node.dataset.sampleCount = cell.samples.length;
    node.dataset.matches = String(sampleMatches(sample));
    node.title = `${sample.hex} · ${colorSampleLabel(sample)} · ${cell.samples.length} ${cell.samples.length === 1 ? 'color' : 'colors'} in cell`;
    node.setAttribute('aria-label', node.title); node.tabIndex = sample.isAnchor ? 0 : -1;
    const swatch = chip(sample.hex, 'matching-swatch'); swatch.style.transform = `scale(${colorSampleScale(sample)})`; node.append(swatch);
    node.addEventListener('pointerenter', () => show(sample)); node.addEventListener('focus', () => choose(cell, position));
    node.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -layout.columns, ArrowDown: layout.columns };
      let next = position, step = offsets[event.key];
      if (event.key === 'Home' || event.key === 'End') {
        next = cell.row * layout.columns + (event.key === 'End' ? layout.columns - 1 : 0); step = event.key === 'End' ? -1 : 1;
      } else if (step) next += step;
      else return;
      event.preventDefault();
      while (next >= 0 && next < buttons.length && !buttons[next]) {
        if (Math.abs(step) === 1 && Math.floor(next / layout.columns) !== cell.row) break;
        next += step;
      }
      const aligned = next >= 0 && next < buttons.length && buttons[next] && (Math.abs(step) !== 1 || Math.floor(next / layout.columns) === cell.row);
      if (aligned) buttons[next].focus();
      else if (event.key.startsWith('Arrow')) {
        // A neutral anchor may occupy an otherwise empty row and column.
        // Fall back to visual reading order so every occupied cell is reachable.
        const direction = step > 0 ? 1 : -1; next = position + direction;
        while (next >= 0 && next < buttons.length && !buttons[next]) next += direction;
        if (next >= 0 && next < buttons.length) buttons[next].focus();
      }
    });
    buttons.push(node); grid.append(node);
  }
  const corner = element('span', 'matching-hue-title', 'Hue →');
  plane.append(corner, horizontal, vertical, grid); scroll.append(plane);
  const legend = element('div', 'matching-legend');
  for (const quality of [1, .75, .5, 0]) {
    const item = element('span'), box = element('span', 'quality-example'), swatch = chip(data.region.hex, 'matching-swatch');
    swatch.style.transform = `scale(${colorSampleScale({ quality })})`; box.append(swatch); item.append(box, document.createTextNode(quality === 0 ? data.definition.profile ? '0% mass · tiny' : 'Does not count' : percent(quality, 0))); legend.append(item);
  }
  group.append(groupHeading, element('p', 'hint', `Colors below are ordered by ${otherAxis}.`), strip, description);
  const cutoffView = Boolean(data.definition.profile);
  container.append(scroll, legend, element('p', 'hint', `${cutoffView ? 'Square size shows area weight × reference closeness (quality mass)' : 'Square size shows raw match quality'}, with a tiny visible square for colors that do not count. The white outline marks the bin center. References use full saturation in the Lightness tab and 50% lightness in the Saturation tab. These examples are not measured wallpaper pixels. Gray has no hue and only 0% saturation.`), group,
    element('p', 'hint', cutoffView
      ? `Axes use HSL for browsing. ${data.definition.metric === 'shade-hue-aware' ? `Closeness uses shade-aware OKLab geometry plus stricter hue admission: full hue credit within ${data.definition.hueParameters.coreDegrees}° of the anchor, smoothly fading to zero at ${data.definition.hueParameters.edgeDegrees}° for fully chromatic anchors; near-neutral targets blend toward the original metric. These are OKLab hue angles, not the HSL axis angles. Neutral anchors retain the original metric.` : data.definition.metric === 'shade-aware' ? 'Closeness uses shade-aware OKLab geometry: deeper shades receive more credit while hue and chroma differences still matter. Neutral anchors retain the original metric.' : 'Closeness uses OKLab: 100% at the center, reaching 0% at distance 0.24.'} ${data.definition.profile === 'all-levels' ? allCutoffLabel(data.executedParameters) : `Profile: ${data.definition.profile}; outer cutoff: ${percent(data.definition.cutoff, 0)}`}.${isBlendedProfile(data.definition.profile) ? ' This membership preview averages the component weights; actual ranking combines separately calculated scores.' : ''} The average-quality sliders change wallpaper scoring, not these pixel memberships.`
      : 'Axes use HSL for browsing. Membership and quality still use OKLab: 100% at the center to 50% at the edge. The quality sliders affect the wallpaper’s average score, not this color range.'));
  const anchorPosition = layout.cells.findIndex(cell => cell?.representative.isAnchor), first = anchorPosition >= 0 ? anchorPosition : layout.cells.findIndex(Boolean);
  if (first >= 0) {
    choose(layout.cells[first], first);
    if (scroll.scrollWidth > scroll.clientWidth) {
      const rect = buttons[first].getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
      scroll.scrollLeft += rect.left - viewport.left - (scroll.clientWidth - rect.width) / 2;
    }
  }
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
    const cell = element('td'), choose = button('', 'bin-select', () => { selectRegion(region.index); openRegionColors(region); }); choose.append(chip(region.hex), document.createTextNode(`${region.index} · ${region.hex}`)); cell.append(choose); row.append(cell);
    for (const text of [percent(region.coverage), percent(region.conditionalQuality), percent(region.qualityMass), region.selectedBy.length ? region.selectedBy.map(index => index + 1).join(', ') : '—']) row.append(element('td', '', text));
    $('bin-rows').append(row);
  }
  $('table-count').textContent = `${regions.length.toLocaleString()} regions · page ${state.page + 1} of ${pages}`; $('previous-page').disabled = state.page === 0; $('next-page').disabled = state.page >= pages - 1;
}
async function init() {
  const response = await fetch('/api/config'); if (!response.ok) throw Error('Could not load the inspector configuration.'); state.config = await response.json();
  $('corpus-summary').textContent = `${state.config.corpus.real} real wallpapers · native OpenSearch scoring`;
  for (const count of state.config.bucketCounts ?? [1024]) { const option = element('option', '', `${count.toLocaleString()} buckets${count === 1024 ? ' (original)' : ''}`); option.value = count; $('bucket-count').append(option); }
  state.bucketCount = state.config.defaultBucketCount ?? 1024; $('bucket-count').value = state.bucketCount;
  $('bucket-count').addEventListener('change', () => { state.bucketCount = Number($('bucket-count').value); queryEdited(); });
  for (const method of state.config.methods) { const option = element('option', '', method.id === 'overlap-quality-dense' ? 'Original · dense color regions' : method.id === 'overlap-quality-hybrid' ? 'Original · named + picked colors' : method.label); option.value = method.id; $('method').append(option); }
  for (const level of state.config.cutoffLevels ?? []) { const option = element('option', '', `${level.label} minimum closeness${level.cutoff === .5 ? ' · original boundary' : level.cutoff === 0 ? ' · broadest' : level.cutoff === .9 ? ' · tightest' : ''}`); option.value = level.cutoff; $('pixel-cutoff').append(option); }
  $('pixel-cutoff').value = state.pixelCutoff;
  $('pixel-cutoff').addEventListener('change', () => { state.pixelCutoff = Number($('pixel-cutoff').value); queryEdited(); });
  $('cutoff-blend-exponent').addEventListener('input', () => { state.cutoffBlendExponent = Number($('cutoff-blend-exponent').value); queryEdited(); });
  $('named-mode').addEventListener('change', () => { state.namedMode = $('named-mode').value; queryEdited(); });
  for (const [index, preset] of state.config.presets.entries()) { const option = element('option', '', preset.label); option.value = index; $('preset').append(option); }
  $('method').addEventListener('change', () => { state.method = $('method').value; queryEdited(); });
  $('preset').addEventListener('change', () => usePreset(state.config.presets[Number($('preset').value)]));
  $('mode-vibe').addEventListener('click', () => { state.mode = 'vibe'; renderTargets(); }); $('mode-proportions').addEventListener('click', () => { state.mode = 'proportions'; renderTargets(); });
  $('add-target').addEventListener('click', () => { state.targets.push({ color: '#209040', percent: 20 }); renderTargets(); });
  $('use-json').addEventListener('change', () => setAdvanced($('use-json').checked));
  $('query-json').addEventListener('input', () => { if (state.advanced) queryEdited(); });
  $('quality-influence').addEventListener('input', () => { state.qualityInfluence = Number($('quality-influence').value); queryEdited(); });
  $('quality-curve').addEventListener('change', () => { state.qualityCurve = $('quality-curve').value; queryEdited(); });
  $('reset-quality').addEventListener('click', () => { state.qualityInfluence = 1; $('quality-influence').value = '1'; queryEdited(); });
  $('minimum-quality').addEventListener('input', () => { state.minimumQuality = Number($('minimum-quality').value) / 100; queryEdited(); });
  $('reset-minimum-quality').addEventListener('click', () => { state.minimumQuality = 0; $('minimum-quality').value = '0'; queryEdited(); });
  $('result-limit').addEventListener('change', queryEdited);
  $('live-update').addEventListener('change', () => {
    state.live = $('live-update').checked;
    if (state.live) queueLiveSearch();
    else {
      const pending = state.liveTimer !== null;
      clearTimeout(state.liveTimer); state.liveTimer = null;
      if (pending || (state.searchIsLive && state.searching)) { cancelSearch(); $('search-status').className = ''; $('search-status').textContent = 'Live updates off. Press Search wallpapers to apply changes.'; }
    }
  });
  $('query-form').addEventListener('submit', search);
  $('cancel-search').addEventListener('click', () => { cancelSearch(); $('search-status').className = ''; $('search-status').textContent = 'Search canceled. Previous results retain their original query and quality settings.'; });
  $('close-inspector').addEventListener('click', closeInspection); $('inspector').addEventListener('cancel', () => { state.inspectionController?.abort(); state.inspectionGeneration++; cancelRegionColors(); });
  $('close-color-dialog').addEventListener('click', closeRegionColors);
  $('color-layer').addEventListener('change', () => { state.colorsLayer = $('color-layer').value; loadRegionColorLayer(); });
  $('color-dialog').addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    // Handle the top modal before the browser's native grouped close request.
    event.preventDefault(); event.stopPropagation(); closeRegionColors();
  });
  $('color-dialog').addEventListener('cancel', event => { event.preventDefault(); closeRegionColors(); });
  for (const axis of ['lightness', 'saturation']) {
    const tab = $(`color-tab-${axis}`);
    tab.addEventListener('click', () => setColorAxis(axis));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'lightness' : event.key === 'End' ? 'saturation' : axis === 'lightness' ? 'saturation' : 'lightness';
      setColorAxis(next); $(`color-tab-${next}`).focus();
    });
  }
  $('grid-metric').addEventListener('change', renderGrid);
  for (const id of ['present-only', 'bin-sort', 'sort-direction', 'page-size']) $(id).addEventListener('change', () => { state.page = 0; renderTable(); });
  $('bin-search').addEventListener('input', () => { state.page = 0; renderTable(); }); $('previous-page').addEventListener('click', () => { state.page--; renderTable(); }); $('next-page').addEventListener('click', () => { state.page++; renderTable(); });
  renderTargets(); state.ready = true; await search();
}
init().catch(error => { $('search-status').className = 'error'; $('search-status').textContent = error.message; });
