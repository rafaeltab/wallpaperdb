const $ = selector => document.querySelector(selector);
const state = { methods: [], targets: [{ color: '#ff0000', percent: 100 }], columns: new Map(), generation: 0, controller: null, timer: null, baselineRanks: new Map() };
const named = [['', 'Picked color'], ['dark', 'Dark'], ['grayscale', 'Grayscale'], ['strict_grayscale', 'Strict grayscale'], ['near_neutral', 'Almost grayscale'], ['bright', 'Bright'], ['vivid', 'Vivid']];
const presets = {
  red: { mode: 'vibe', targets: [{ color: '#ff0000', percent: 100 }] },
  dark: { mode: 'vibe', targets: [{ name: 'dark', color: '#101014', percent: 100 }] },
  green40: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] },
  redgreen: { mode: 'proportions', targets: [{ color: '#ff2200', percent: 50 }, { color: '#22cc44', percent: 50 }] },
  rainbow: { mode: 'proportions', targets: ['#ff2200', '#ff8800', '#ffff00', '#22cc44', '#2266ff'].map(color => ({ color, percent: 20 })) },
  grayred: { mode: 'proportions', targets: [{ name: 'grayscale', color: '#808080', percent: 80 }, { color: '#ff0000', percent: 20 }] },
  trans: { mode: 'proportions', targets: [{ color: '#5bcefa', percent: 40 }, { color: '#f5a9b8', percent: 40 }, { color: '#ffffff', percent: 20 }] },
};
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function status(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('error', error); }
function changed() {
  updateRemainder(); clearTimeout(state.timer);
  // An earlier response must never make old results look like the newly edited
  // query, including while a live update is waiting for its debounce timer.
  state.generation++; state.controller?.abort(); state.controller = null;
  for (const entry of state.columns.values()) {
    entry.column.classList.remove('loading');
    entry.column.classList.add('stale');
    entry.timing.textContent = 'Query changed · results need updating';
    entry.timing.classList.remove('error');
  }
  $('#search').textContent = 'Compare methods';
  if ($('#live').checked) { status('Query changed. Updating shortly…'); state.timer = setTimeout(compare, 400); }
  else status('Query changed. Press Compare methods to update.');
}
function updateRemainder() {
  const mode = $('#mode').value, sum = state.targets.reduce((total, target) => total + Number(target.percent), 0);
  $('#remainder').textContent = mode === 'proportions' ? (sum <= 100 ? `${100 - sum}% unspecified · rest unconstrained` : `${sum}% requested · reduce to 100% or less`) : 'Colors describe the overall feeling of the wallpaper.';
  $('#add-target').disabled = state.targets.length >= 8;
}
function renderTargets() {
  const root = $('#targets'); root.replaceChildren();
  state.targets.forEach((target, index) => {
    const row = element('div', 'target'), kind = element('select'); kind.setAttribute('aria-label', `Target ${index + 1} type`);
    for (const [value, label] of named) { const option = element('option', '', label); option.value = value; kind.append(option); }
    kind.value = target.name ?? '';
    const remove = element('button', 'remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove target ${index + 1}`); remove.disabled = state.targets.length === 1;
    const color = element('input'); color.type = 'color'; color.value = target.color; color.setAttribute('aria-label', `Target ${index + 1} color`);
    const hex = element('input'); hex.type = 'text'; hex.value = target.color; hex.maxLength = 7; hex.pattern = '#[0-9a-fA-F]{6}'; hex.setAttribute('aria-label', `Target ${index + 1} hex`);
    color.disabled = hex.disabled = Boolean(target.name);
    kind.addEventListener('change', () => { if (kind.value) target.name = kind.value; else delete target.name; color.disabled = hex.disabled = Boolean(target.name); changed(); });
    color.addEventListener('input', () => { target.color = color.value; hex.value = color.value; changed(); });
    hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { target.color = hex.value; color.value = hex.value; changed(); } });
    remove.addEventListener('click', () => { state.targets.splice(index, 1); renderTargets(); changed(); });
    const amountLabel = element('label', 'percent-label', 'Area '), range = element('input'), amount = element('input');
    range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5'; range.value = target.percent; range.setAttribute('aria-label', `Target ${index + 1} area`);
    amount.type = 'number'; amount.min = '0'; amount.max = '100'; amount.step = '5'; amount.value = target.percent; amount.setAttribute('aria-label', `Target ${index + 1} percentage`);
    range.addEventListener('input', () => { amount.value = range.value; target.percent = Number(range.value); changed(); });
    amount.addEventListener('input', () => { range.value = amount.value; target.percent = Number(amount.value); changed(); });
    amountLabel.append(range, amount, document.createTextNode('%')); amountLabel.hidden = $('#mode').value !== 'proportions';
    amount.disabled = amountLabel.hidden;
    row.append(kind, remove, color, hex, amountLabel); root.append(row);
  }); updateRemainder();
}
function renderMethods() {
  const toggles = $('#method-toggles'), columns = $('#columns');
  for (const method of state.methods) {
    const unavailable = method.available === false;
    const check = element('input'); check.type = 'checkbox'; check.checked = !unavailable; check.disabled = unavailable;
    const label = element('label', unavailable ? 'unavailable' : '', method.label + (unavailable ? ' (unavailable)' : ''));
    if (unavailable) label.title = method.unavailableReason + ' Reload the page after the index is ready.';
    label.prepend(check); toggles.append(label);
    const column = element('section', 'column' + (method.id === 'cutoff-shade-hue-all-levels' ? ' reference' : ''));
    column.hidden = unavailable;
    const header = element('div', 'column-header'), category = element('span', 'category', method.category);
    const title = element('h2', '', method.label), precision = element('p', 'precision', method.precision), timing = element('p', 'column-status', 'Ready to compare.');
    header.append(category, title, precision, timing);
    const results = element('div', 'results'); results.append(element('p', 'empty', 'Results will appear here.'));
    column.append(header, results); columns.append(column);
    state.columns.set(method.id, { method, check, column, results, timing });
    check.addEventListener('change', () => { column.hidden = !check.checked; if ($('#live').checked) changed(); });
  }
}
function showImage(hit, method, rank) {
  $('#image-title').textContent = hit.title;
  $('#large-image').src = hit.imageUrl; $('#large-image').alt = hit.title;
  $('#image-details').textContent = `${method.label} · rank ${rank} · score ${Number(hit.score).toFixed(7)} · ${hit.id}`;
  $('#full-image').href = hit.imageUrl;
  $('#source-image').hidden = !hit.sourceUrl; if (hit.sourceUrl) $('#source-image').href = hit.sourceUrl;
  $('#image-dialog').showModal();
}
function renderResults(entry, result) {
  entry.column.classList.remove('stale');
  entry.results.replaceChildren();
  if (result.supported === false) { entry.results.append(element('p', 'empty', result.reason ?? 'This query is not supported.')); return; }
  if (!result.hits.length) { entry.results.append(element('p', 'empty', 'No matching wallpapers.')); return; }
  result.hits.forEach((hit, index) => {
    const card = element('button', 'card'); card.type = 'button'; card.setAttribute('aria-label', `${entry.method.label}, rank ${index + 1}: ${hit.title}`);
    const img = element('img'); img.src = hit.thumbnailUrl; img.alt = hit.title; img.loading = 'lazy';
    const meta = element('div', 'card-meta'); meta.append(element('strong', '', `#${index + 1}`), element('span', '', Number(hit.score).toFixed(6)));
    const baseline = state.baselineRanks.get(hit.id);
    if (entry.method.id !== 'cutoff-shade-hue-all-levels' && baseline) meta.append(element('span', '', `ref #${baseline}`));
    card.append(img, meta, element('div', 'card-subtitle', hit.id)); card.addEventListener('click', () => showImage(hit, entry.method, index + 1));
    entry.results.append(card);
  });
}
async function compare() {
  clearTimeout(state.timer);
  if (!$('#query-form').reportValidity()) return;
  const mode = $('#mode').value;
  const sum = state.targets.reduce((total, target) => total + Number(target.percent), 0);
  if (mode === 'proportions' && (sum > 100 || sum <= 0 || state.targets.some(target => !Number.isInteger(target.percent / 5)))) { status('Use percentages in steps of 5, with a positive total of at most 100%.', true); return; }
  const selected = [...state.columns.values()].filter(entry => entry.check.checked);
  if (!selected.length) { status('Select at least one method to compare.', true); return; }
  state.controller?.abort(); const controller = new AbortController(); state.controller = controller;
  const generation = ++state.generation; state.baselineRanks.clear();
  const query = { mode, targets: state.targets.map(target => ({ ...(target.name ? { name: target.name } : { color: target.color }), ...(mode === 'proportions' ? { percent: target.percent } : {}) })) };
  const parameters = { bucketCount: 256, qualityInfluence: Number($('#quality').value), cutoffBlendExponent: Number($('#cutoff').value) };
  const limit = Number($('#limit').value); let errors = 0;
  for (const entry of selected) { entry.column.classList.add('loading'); entry.timing.textContent = 'Waiting…'; entry.timing.classList.remove('error'); }
  $('#search').textContent = 'Restart comparison';
  // Request one column at a time so simultaneous queries do not distort
  // this small-corpus visual comparison. Every list keeps OpenSearch order.
  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i]; if (generation !== state.generation) return;
    status(`Searching ${i + 1}/${selected.length}: ${entry.method.label}…`); entry.timing.textContent = 'Searching OpenSearch…';
    try {
      const response = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ methodId: entry.method.id, query, parameters, limit }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? 'Search failed.');
      if (generation !== state.generation) return;
      if (entry.method.id === 'cutoff-shade-hue-all-levels') result.hits.forEach((hit, rank) => state.baselineRanks.set(hit.id, rank + 1));
      renderResults(entry, result);
      const requests = result.evidence?.requestCount;
      const serviceTiming = Number.isInteger(requests) && requests > 1
        ? `OpenSearch total ${result.evidence?.serviceTookMs ?? '?'} ms · ${requests} requests`
        : `OpenSearch ${result.evidence?.serviceTookMs ?? '?'} ms`;
      entry.timing.textContent = result.supported === false ? 'Unsupported query' : `${serviceTiming} · API ${result.elapsedMs.toFixed(1)} ms`;
    } catch (error) {
      if (controller.signal.aborted || generation !== state.generation) return;
      errors++; entry.column.classList.remove('stale'); entry.results.replaceChildren(element('p', 'empty', error.message)); entry.timing.textContent = 'Search unavailable'; entry.timing.classList.add('error');
    } finally { if (generation === state.generation) entry.column.classList.remove('loading'); }
  }
  if (generation === state.generation) {
    $('#search').textContent = 'Compare methods';
    status(errors ? `${selected.length - errors}/${selected.length} methods completed. Unavailable methods show their error above.` : `Compared ${selected.length} methods in sequence. Click a wallpaper to inspect it. “ref” shows its rank in the visible reference results.`, Boolean(errors));
  }
}
$('#query-form').addEventListener('submit', event => { event.preventDefault(); compare(); });
$('#mode').addEventListener('change', () => { renderTargets(); changed(); });
$('#preset').addEventListener('change', () => { const preset = presets[$('#preset').value]; $('#mode').value = preset.mode; state.targets = structuredClone(preset.targets); renderTargets(); changed(); });
$('#add-target').addEventListener('click', () => { state.targets.push({ color: '#22cc44', percent: 20 }); renderTargets(); changed(); });
for (const selector of ['#quality', '#cutoff', '#limit']) $(selector).addEventListener('change', changed);
$('#live').addEventListener('change', () => { if ($('#live').checked) compare(); else clearTimeout(state.timer); });
$('#close-dialog').addEventListener('click', () => $('#image-dialog').close());
$('#image-dialog').addEventListener('click', event => { if (event.target === $('#image-dialog')) { const rect = $('#image-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('#image-dialog').close(); } });
const inspector = new URL(location.href); inspector.port = '8227'; inspector.pathname = '/'; inspector.search = ''; inspector.hash = ''; $('#inspector-link').href = inspector.href;
renderTargets();
try {
  const response = await fetch('/api/meta'); if (!response.ok) throw Error('Could not load comparison methods.');
  const meta = await response.json(); state.methods = meta.methods; renderMethods();
  status(`Ready: ${meta.wallpaperCount} real wallpapers, ${meta.methods.filter(method => method.available !== false).length} available OpenSearch methods.`); await compare();
} catch (error) { status(error.message, true); }
