// THROWAWAY comparison UI. The server returns the global ranking; this page
// preserves its order and keeps each tab's query/control state separately.
const NAMED = [['', 'Picked color'], ['dark', 'Dark'], ['grayscale', 'Grayscale'], ['strict_grayscale', 'Strict grayscale'],
  ['near_neutral', 'Almost grayscale'], ['bright', 'Bright'], ['vivid', 'Vivid']];
const PRESETS = {
  red: { mode: 'vibe', targets: [{ color: '#ff0000', percent: 100 }] },
  dark: { mode: 'vibe', targets: [{ name: 'dark', color: '#101014', percent: 100 }] },
  grayscale: { mode: 'vibe', targets: [{ name: 'grayscale', color: '#808080', percent: 100 }] },
  green40: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] },
  redgreen: { mode: 'proportions', targets: [{ color: '#ff2200', percent: 50 }, { color: '#22cc44', percent: 50 }] },
  rainbow: { mode: 'proportions', targets: ['#ff2200', '#ff8800', '#ffff00', '#22cc44', '#2266ff'].map(color => ({ color, percent: 20 })) },
  grayred: { mode: 'proportions', targets: [{ name: 'grayscale', color: '#808080', percent: 80 }, { color: '#ff0000', percent: 20 }] },
  trans: { mode: 'proportions', targets: [{ color: '#5bcefa', percent: 40 }, { color: '#f5a9b8', percent: 40 }, { color: '#ffffff', percent: 20 }] },
};
const FALLBACK_LEVELS = {
  3: [{ label: 'Broad matches', qualityInfluence: 0, cutoffBlendExponent: 0 }, { label: 'Favorite balance', qualityInfluence: .5, cutoffBlendExponent: 1 }, { label: 'Closest matches', qualityInfluence: 1, cutoffBlendExponent: 3 }],
  5: [{ label: 'Broad matches', qualityInfluence: 0, cutoffBlendExponent: 0 }, { label: 'Relaxed', qualityInfluence: .5, cutoffBlendExponent: 0 }, { label: 'Favorite balance', qualityInfluence: .5, cutoffBlendExponent: 1 }, { label: 'Selective', qualityInfluence: 1, cutoffBlendExponent: 1 }, { label: 'Closest matches', qualityInfluence: 1, cutoffBlendExponent: 3 }],
};

export function strictnessQueryError(query, percentageStep) {
  if (!query || !['vibe', 'proportions'].includes(query.mode) || !Array.isArray(query.targets) || !query.targets.length || query.targets.length > 8) return 'Choose between one and eight colors.';
  if (query.targets.some(target => target.name ? !NAMED.some(([name]) => name === target.name) : !/^#[0-9a-f]{6}$/i.test(target.color ?? ''))) return 'Enter a complete color such as #FF2200.';
  if (query.mode !== 'proportions') return '';
  if (query.targets.some(target => !Number.isFinite(target.percent) || target.percent < 0 || target.percent > 100 || !Number.isInteger(target.percent / percentageStep))) return `Use percentages in steps of ${percentageStep}, between 0% and 100%.`;
  const total = query.targets.reduce((sum, target) => sum + target.percent, 0);
  return total <= 0 ? 'Request at least some color area; the total must be greater than 0%.' : total > 100 ? `${total}% requested. Reduce the total to 100% or less.` : '';
}

/** A visible proposal only. The UI requires an explicit confirmation before
 * applying it. Largest remainders preserve the nearest ten-percent total and
 * cannot turn a valid closed palette into more than100%. */
export function strictnessPercentAdjustment(query) {
  const error = strictnessQueryError(query, 5); if (error) throw Error(error);
  const proposed = structuredClone(query); if (query.mode !== 'proportions') return proposed;
  const total = query.targets.reduce((sum, target) => sum + target.percent, 0);
  const desiredTotal = Math.min(100, Math.max(10, Math.round(total / 10) * 10));
  proposed.targets.forEach(target => { target.percent = Math.floor(target.percent / 10) * 10; });
  let remaining = (desiredTotal - proposed.targets.reduce((sum, target) => sum + target.percent, 0)) / 10;
  const order = query.targets.map((target, index) => ({ index, remainder: target.percent % 10 })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const item of order) { if (!remaining) break; proposed.targets[item.index].percent += 10; remaining--; }
  const proposedError = strictnessQueryError(proposed, 10); if (remaining || proposedError) throw Error(proposedError || 'Could not prepare a valid percentage adjustment.');
  return proposed;
}

const $ = selector => document.querySelector(selector);
const state = {
  variant: 'linked', meta: null, controller: null, timer: null, generation: 0, pendingAdjustment: null,
  tabs: {
    original: { query: structuredClone(PRESETS.red), preset: 'red', quality: .5, cutoff: 1, result: null, visited: false },
    linked: { query: structuredClone(PRESETS.red), preset: 'red', steps: 5, levels: { 3: 1, 5: 2 }, result: null, visited: true },
  },
};
const active = () => state.tabs[state.variant];
const step = () => state.variant === 'original' ? 5 : 10;
const labelFor = variant => variant === 'original' ? 'Original controls' : 'Combined slider';
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function setStatus(text, error = false) { $('#search-status').textContent = text; $('#search-status').classList.toggle('error', error); }
function stopRequest() {
  clearTimeout(state.timer); state.timer = null; state.generation++; state.controller?.abort(); state.controller = null;
  $('#wallpaper-grid').setAttribute('aria-busy', 'false'); $('#run-search').textContent = 'Search wallpapers';
}
function levels() { return state.meta?.levels?.[state.tabs.linked.steps] ?? FALLBACK_LEVELS[state.tabs.linked.steps]; }
function bank() {
  const banks = state.meta?.banks;
  return Array.isArray(banks) ? banks.find(item => item.id === 'linked-' + state.tabs.linked.steps) : banks?.[state.tabs.linked.steps];
}
function unavailableReason() {
  if (!state.meta) return 'Loading available choices…';
  const variant = state.meta.variants?.[state.variant];
  if (variant?.available === false) return variant.unavailableReason ?? variant.reason ?? 'This option is still being prepared. Reload the page when it is ready.';
  if (state.variant === 'linked' && bank()?.available === false) return bank().unavailableReason ?? bank().reason ?? 'These slider choices are still being prepared. Reload the page when they are ready.';
  return '';
}
function queryPayload(query) {
  return { mode: query.mode, targets: query.targets.map(target => ({ ...(target.name ? { name: target.name } : { color: target.color }), ...(query.mode === 'proportions' ? { percent: target.percent } : {}) })) };
}
function requestBody() {
  const tab = active();
  return { variant: state.variant, steps: state.variant === 'linked' ? tab.steps : 3, level: state.variant === 'linked' ? tab.levels[tab.steps] : 1,
    query: queryPayload(tab.query), limit: Number($('#result-limit').value),
    ...(state.variant === 'original' ? { parameters: { qualityInfluence: tab.quality, cutoffBlendExponent: tab.cutoff } } : {}) };
}
function targetLabel(target) { return target.name ? NAMED.find(([name]) => name === target.name)?.[1] ?? target.name : target.color.toUpperCase(); }
function describeQuery(query) { return query.targets.map(target => `${query.mode === 'proportions' ? target.percent + '% ' : ''}${targetLabel(target)}`).join(' · '); }
function controlLabel() {
  if (state.variant === 'original') return `quality ${active().quality} · weighting ${active().cutoff}`;
  return `${active().steps} choices · ${levels()[active().levels[active().steps]].label}`;
}
function updateQueryValidation() {
  const tab = active(), total = tab.query.targets.reduce((sum, target) => sum + Number(target.percent), 0);
  const error = strictnessQueryError(tab.query, step());
  $('#query-validation').textContent = error;
  $('#area-remainder').textContent = tab.query.mode === 'proportions' ? (Number.isFinite(total) && total <= 100 ? `${100 - total}% unspecified · rest unconstrained` : 'Reduce the requested area to 100% or less') : 'Colors describe the overall feeling of the wallpaper.';
  $('#add-color').disabled = tab.query.targets.length >= 8;
  $('#run-search').disabled = Boolean(unavailableReason());
  return error;
}
function changed({ custom = false } = {}) {
  if (custom) { active().preset = 'custom'; $('#query-preset').value = 'custom'; }
  stopRequest(); const error = updateQueryValidation();
  if (active().result) $('#wallpaper-grid').classList.add('stale');
  const unavailable = unavailableReason();
  if (unavailable) { setStatus(unavailable, Boolean(state.meta)); return; }
  if (error) { setStatus('Query needs an adjustment before searching. Previous results are unchanged.', true); return; }
  if ($('#live-update').checked) { setStatus('Settings changed. Updating…'); state.timer = setTimeout(search, 300); }
  else setStatus('Settings changed. Press Search wallpapers to update.');
}
function renderLevel() {
  const tab = state.tabs.linked, selected = levels()[tab.levels[tab.steps]], favorite = tab.levels[tab.steps] === Math.floor(tab.steps / 2);
  $('#linked-steps').value = String(tab.steps);
  $('#linked-level').max = String(tab.steps - 1); $('#linked-level').value = String(tab.levels[tab.steps]);
  $('#linked-level').setAttribute('aria-valuetext', `${selected.label}, ${tab.levels[tab.steps] + 1} of ${tab.steps}`);
  $('#level-label').textContent = selected.label;
  $('#level-pair').textContent = `Quality influence ${selected.qualityInfluence} · cutoff weighting ${selected.cutoffBlendExponent}`;
  $('#level-description').textContent = favorite ? 'Your saved balance between quality and coverage.' : tab.levels[tab.steps] < Math.floor(tab.steps / 2)
    ? 'More room for loosely matching colors, with more emphasis on coverage.' : 'More emphasis on close color matches and the stricter cutoff layers.';
  $('#level-ticks').replaceChildren(...levels().map((item, index) => element('span', '', index === Math.floor(tab.steps / 2) ? 'Saved favorite' : item.label)));
}
function renderTargets() {
  const tab = active(), root = $('#query-targets'); root.replaceChildren();
  $('#query-mode').value = tab.query.mode; $('#query-preset').value = tab.preset;
  tab.query.targets.forEach((target, index) => {
    const row = element('div', 'target'), kind = element('select'); kind.setAttribute('aria-label', `Color ${index + 1} type`);
    for (const [value, text] of NAMED) { const option = element('option', '', text); option.value = value; kind.append(option); }
    kind.value = target.name ?? '';
    const remove = element('button', 'remove', '×'); remove.type = 'button'; remove.disabled = tab.query.targets.length === 1; remove.setAttribute('aria-label', `Remove color ${index + 1}`);
    const color = element('input'); color.type = 'color'; color.value = /^#[0-9a-f]{6}$/i.test(target.color) ? target.color : '#ff0000'; color.setAttribute('aria-label', `Color ${index + 1}`);
    const hex = element('input'); hex.type = 'text'; hex.value = target.color; hex.maxLength = 7; hex.pattern = '#[0-9a-fA-F]{6}'; hex.setAttribute('aria-label', `Color ${index + 1} hex code`);
    color.disabled = hex.disabled = Boolean(target.name);
    kind.addEventListener('change', () => { if (kind.value) target.name = kind.value; else delete target.name; color.disabled = hex.disabled = Boolean(target.name); changed({ custom: true }); });
    color.addEventListener('input', () => { target.color = color.value; hex.value = color.value; changed({ custom: true }); });
    hex.addEventListener('input', () => { target.color = hex.value; if (/^#[0-9a-f]{6}$/i.test(target.color)) color.value = target.color; changed({ custom: true }); });
    remove.addEventListener('click', () => { tab.query.targets.splice(index, 1); renderTargets(); changed({ custom: true }); });
    const area = element('label', 'percent-label', 'Area '), range = element('input'), amount = element('input');
    range.type = 'range'; range.min = '0'; range.max = '100'; range.step = String(step()); range.value = Number.isFinite(target.percent) ? String(target.percent) : '0'; range.setAttribute('aria-label', `Color ${index + 1} area`);
    amount.type = 'number'; amount.min = '0'; amount.max = '100'; amount.step = String(step()); amount.value = Number.isFinite(target.percent) ? String(target.percent) : ''; amount.setAttribute('aria-label', `Color ${index + 1} percentage`);
    range.addEventListener('input', () => { target.percent = Number(range.value); amount.value = range.value; changed({ custom: true }); });
    amount.addEventListener('input', () => { target.percent = amount.value === '' ? NaN : Number(amount.value); if (Number.isFinite(target.percent)) range.value = String(target.percent); changed({ custom: true }); });
    area.hidden = tab.query.mode !== 'proportions'; amount.disabled = range.disabled = area.hidden;
    area.append(range, amount, document.createTextNode('%')); row.append(kind, remove, color, hex, area); root.append(row);
  }); updateQueryValidation();
}
function renderCached() {
  const cached = active().result;
  if (!cached) {
    $('#wallpaper-grid').replaceChildren(element('p', 'empty', 'Your results will appear here.'));
    $('#wallpaper-grid').classList.remove('stale'); $('#results-title').textContent = 'Wallpapers'; $('#results-description').textContent = 'Choose colors and search.';
    return false;
  }
  renderResults(cached);
  const matches = cached.fingerprint === JSON.stringify(requestBody());
  $('#wallpaper-grid').classList.toggle('stale', !matches);
  return matches;
}
function switchTab(variant, focus = false) {
  if (variant === state.variant) return;
  stopRequest(); const previous = active(), next = state.tabs[variant];
  let copied = false, needsCopyReview = false;
  if (!next.visited) {
    const copyError = strictnessQueryError(previous.query, variant === 'linked' ? 10 : 5);
    if (!copyError) { next.query = structuredClone(previous.query); next.preset = previous.preset; copied = true; }
    else needsCopyReview = true;
    next.visited = true;
  }
  state.variant = variant;
  for (const item of ['original', 'linked']) {
    const selected = item === variant, tab = $('#tab-' + item);
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; $('#panel-' + item).hidden = !selected;
  }
  if (focus) $('#tab-' + variant).focus();
  $('#copy-query').textContent = variant === 'linked' ? 'Use Original query' : 'Use Combined query';
  $('#query-state-note').textContent = copied ? 'Copied the same query for this first comparison. Each tab now keeps its own edits.'
    : needsCopyReview ? 'The other query needs different area steps. Use the copy button to review an adjustment.' : 'Each tab keeps its own query and settings. Use the copy button to compare the same query.';
  $('#original-quality').value = String(state.tabs.original.quality); $('#original-cutoff').value = String(state.tabs.original.cutoff);
  renderLevel(); renderTargets();
  if (renderCached()) setStatus('Showing this tab’s previous results.');
  else changed();
}
function showWallpaper(hit, rank, context) {
  $('#wallpaper-title').textContent = hit.title || hit.id;
  $('#wallpaper-image').src = hit.imageUrl; $('#wallpaper-image').alt = hit.title || hit.id;
  $('#wallpaper-details').textContent = `${context} · rank ${rank} · score ${Number(hit.score).toFixed(6)}`;
  $('#wallpaper-full').href = hit.imageUrl; $('#wallpaper-source').hidden = !hit.sourceUrl;
  if (hit.sourceUrl) $('#wallpaper-source').href = hit.sourceUrl;
  $('#wallpaper-dialog').showModal();
}
function renderResults(cached) {
  const { result, context, queryDescription } = cached, grid = $('#wallpaper-grid');
  grid.replaceChildren(); grid.classList.remove('stale');
  $('#results-title').textContent = `${result.hits.length} wallpapers · ${context}`;
  $('#results-description').textContent = queryDescription;
  if (!result.hits.length) { grid.append(element('p', 'empty', 'No wallpapers matched this query.')); return; }
  result.hits.forEach((hit, index) => {
    const card = element('button', 'wallpaper-card'); card.type = 'button'; card.setAttribute('aria-label', `Rank ${index + 1}: ${hit.title || hit.id}`);
    const image = element('img'); image.src = hit.thumbnailUrl || hit.imageUrl; image.alt = hit.title || hit.id; image.loading = 'lazy'; image.decoding = 'async';
    const meta = element('div', 'card-meta'); meta.append(element('strong', '', `#${index + 1}`), element('span', '', `Score ${Number(hit.score).toFixed(4)}`));
    card.append(image, meta, element('div', 'card-title', hit.title || hit.id));
    card.addEventListener('click', () => showWallpaper(hit, index + 1, context)); grid.append(card);
  });
}
async function search() {
  stopRequest(); const error = updateQueryValidation() || unavailableReason();
  if (error) { setStatus(error, true); return; }
  const variant = state.variant, tab = active(), body = requestBody(), fingerprint = JSON.stringify(body);
  const context = `${labelFor(variant)} · ${controlLabel()}`, queryDescription = describeQuery(tab.query);
  const generation = state.generation, controller = new AbortController(); state.controller = controller;
  $('#wallpaper-grid').setAttribute('aria-busy', 'true'); $('#run-search').textContent = 'Searching…';
  setStatus('Searching wallpapers…');
  try {
    const response = await fetch('/api/strictness/search', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: fingerprint });
    const result = await response.json(); if (!response.ok) throw Error(result.error ?? 'Search failed.');
    if (generation !== state.generation || controller.signal.aborted) return;
    if (result.supported === false) throw Error(result.reason ?? 'This combination is unavailable.');
    if (!Array.isArray(result.hits)) throw Error('The search returned an unexpected response.');
    tab.result = { result, context, queryDescription, fingerprint }; renderResults(tab.result);
    const elapsed = Number(result.elapsedMs);
    setStatus(`Showing ${result.hits.length} of ${state.meta.wallpaperCount ?? 523} real wallpapers${Number.isFinite(elapsed) ? ` · ${elapsed.toFixed(0)} ms` : ''}. Click a wallpaper to see the full image.`);
  } catch (failure) {
    if (generation !== state.generation || controller.signal.aborted) return;
    if (tab.result) $('#wallpaper-grid').classList.add('stale');
    else $('#wallpaper-grid').replaceChildren(element('p', 'empty', failure.message));
    setStatus(`${failure.message}${tab.result ? ' Previous results remain visible.' : ''}`, true);
  } finally {
    if (generation === state.generation) { state.controller = null; $('#wallpaper-grid').setAttribute('aria-busy', 'false'); $('#run-search').textContent = 'Search wallpapers'; }
  }
}
function applyCopiedQuery(query, preset = 'custom') {
  active().query = structuredClone(query); active().preset = preset;
  $('#query-state-note').textContent = 'Query copied. Each tab keeps its own edits and controls.';
  renderTargets(); changed();
}
function copyQuery() {
  const source = state.tabs[state.variant === 'linked' ? 'original' : 'linked'];
  const originalError = strictnessQueryError(source.query, 5);
  if (originalError) { setStatus('The other tab’s query needs fixing first: ' + originalError, true); return; }
  if (!strictnessQueryError(source.query, step())) { applyCopiedQuery(source.query, source.preset); return; }
  const adjusted = strictnessPercentAdjustment(source.query); state.pendingAdjustment = { variant: state.variant, query: adjusted };
  const preview = $('#adjustment-preview'); preview.replaceChildren();
  source.query.targets.forEach((target, index) => {
    const row = element('div', 'adjustment-row'), swatch = element('span', 'color-dot'); swatch.style.backgroundColor = target.color;
    row.append(swatch, element('span', '', targetLabel(target)), element('strong', 'adjustment-amount', `${target.percent}% → ${adjusted.targets[index].percent}%`)); preview.append(row);
  });
  const total = query => query.targets.reduce((sum, target) => sum + target.percent, 0);
  $('#adjustment-total').textContent = `Requested total: ${total(source.query)}% → ${total(adjusted)}%. The other ${100 - total(adjusted)}% remains unconstrained.`;
  $('#adjustment-dialog').showModal();
}
function wireDialog(dialog, close) {
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
async function initialize() {
  $('#strictness-form').addEventListener('submit', event => { event.preventDefault(); search(); });
  for (const variant of ['original', 'linked']) {
    const tab = $('#tab-' + variant);
    tab.addEventListener('click', () => switchTab(variant));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'Home' ? 'original' : event.key === 'End' ? 'linked' : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? (state.variant === 'original' ? 'linked' : 'original') : null;
      if (next) { event.preventDefault(); switchTab(next, true); }
    });
  }
  $('#original-quality').addEventListener('change', () => { state.tabs.original.quality = Number($('#original-quality').value); changed(); });
  $('#original-cutoff').addEventListener('change', () => { state.tabs.original.cutoff = Number($('#original-cutoff').value); changed(); });
  $('#reset-original').addEventListener('click', () => { state.tabs.original.quality = .5; state.tabs.original.cutoff = 1; $('#original-quality').value = '0.5'; $('#original-cutoff').value = '1'; changed(); });
  $('#linked-steps').addEventListener('change', () => { state.tabs.linked.steps = Number($('#linked-steps').value); renderLevel(); changed(); });
  $('#linked-level').addEventListener('input', () => { state.tabs.linked.levels[state.tabs.linked.steps] = Number($('#linked-level').value); renderLevel(); changed(); });
  $('#reset-linked').addEventListener('click', () => { state.tabs.linked.levels[state.tabs.linked.steps] = Math.floor(state.tabs.linked.steps / 2); renderLevel(); changed(); });
  $('#query-mode').addEventListener('change', () => { active().query.mode = $('#query-mode').value; renderTargets(); changed({ custom: true }); });
  $('#query-preset').addEventListener('change', () => { const id = $('#query-preset').value; if (PRESETS[id]) { active().query = structuredClone(PRESETS[id]); active().preset = id; renderTargets(); changed(); } });
  $('#add-color').addEventListener('click', () => {
    const query = active().query, total = query.targets.reduce((sum, target) => sum + Number(target.percent), 0);
    query.targets.push({ color: '#22cc44', percent: query.mode === 'proportions' ? Math.max(0, Math.min(20, Math.floor((100 - total) / step()) * step())) : 20 }); renderTargets(); changed({ custom: true });
  });
  $('#result-limit').addEventListener('change', () => { changed(); });
  $('#live-update').addEventListener('change', () => { if ($('#live-update').checked) search(); else { clearTimeout(state.timer); state.timer = null; } });
  $('#copy-query').addEventListener('click', copyQuery);
  wireDialog($('#wallpaper-dialog'), $('#close-wallpaper'));
  wireDialog($('#adjustment-dialog'), $('#cancel-adjustment-top'));
  $('#cancel-adjustment').addEventListener('click', () => $('#adjustment-dialog').close());
  $('#accept-adjustment').addEventListener('click', () => {
    const pending = state.pendingAdjustment;
    if (pending && pending.variant === state.variant) applyCopiedQuery(pending.query);
    $('#adjustment-dialog').close();
  });
  $('#adjustment-dialog').addEventListener('close', () => { state.pendingAdjustment = null; });
  renderLevel(); renderTargets(); renderCached();
  try {
    const response = await fetch('/api/strictness'); const meta = await response.json(); if (!response.ok) throw Error(meta.error ?? 'Could not load the prototype.');
    state.meta = meta; $('#corpus-count').textContent = `${meta.wallpaperCount ?? 523} real wallpapers`;
    const all = $('#result-limit option[value="523"]'); all.value = String(meta.wallpaperCount ?? 523); all.textContent = `All ${meta.wallpaperCount ?? 523}`;
    renderLevel(); updateQueryValidation(); await search();
  } catch (error) { setStatus(error.message, true); $('#run-search').disabled = true; }
}

if (typeof document !== 'undefined') initialize();
