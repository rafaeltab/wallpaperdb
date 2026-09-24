const $ = (id) => document.getElementById(id);
const colors = [
  ['custom', 'Precise hex color', '#ff2200'],
  ['red', 'Red', '#ed3030'], ['orange', 'Orange', '#f48124'], ['yellow', 'Yellow', '#f0d438'],
  ['green', 'Green', '#25a34a'], ['teal', 'Teal', '#208c80'], ['cyan', 'Cyan', '#36bed4'],
  ['blue', 'Blue', '#2872de'], ['purple', 'Purple', '#8954bf'],
  ['pink', 'Pink', '#eb99ba'], ['brown', 'Brown', '#865639'],
  ['dark', 'Dark', '#101014'], ['bright', 'Bright', '#ffe550'], ['light', 'Light', '#eeeeee'],
  ['vivid', 'Vivid', '#ff6633'], ['muted', 'Muted', '#a09891'],
  ['grayscale', 'Grayscale', '#808080'], ['strict_grayscale', 'Strict grayscale', '#808080'], ['near_neutral', 'Near neutral', '#938b83'],
  ['monochromatic', 'Monochromatic', '#8d8278'], ['rainbow', 'Rainbow colors', '#00aacc'],
  ['black', 'Black', '#000000'], ['gray', 'Gray', '#808080'], ['white', 'White', '#ffffff'],
];
const axes = { oklab: [['distance', 'Perceptual distance']], rgb: [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], hsv: [['h', 'Hue'], ['s', 'Saturation'], ['v', 'Value']], hsl: [['h', 'Hue'], ['s', 'Saturation'], ['l', 'Lightness']] };
const state = { metadata: null, mode: 'vibe', targets: [{ name: 'red', color: '#ed3030', percent: 40, edgeWeight: 0.5 }], selected: new Set(), controllers: [], running: false, generation: 0 };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, className, callback) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', callback);
  return node;
}
function select(options, value, callback) {
  const node = element('select');
  for (const [id, label] of options) { const option = element('option', '', label); option.value = id; node.append(option); }
  node.value = value;
  node.addEventListener('change', () => callback(node.value));
  return node;
}
function targetQuery(target) {
  return {
    color: target.color,
    ...(target.name ? { name: target.name } : {}),
    ...(state.mode === 'proportions' ? { percent: target.percent } : {}),
    ...(target.customRange ? { space: target.space ?? 'oklab', tolerance: target.tolerance ?? { distance: 0.2 } } : target.name ? {} : { space: 'oklab' }),
    edgeWeight: target.edgeWeight ?? 0.5,
  };
}
function query() {
  const targets = state.targets.map(targetQuery);
  return { mode: state.mode, targets, ...(state.mode === 'proportions' ? { unspecifiedRemainderPercent: Math.max(0, 100 - targets.reduce((sum, target) => sum + target.percent, 0)) } : {}) };
}
function updatePreview() {
  $('query-preview').textContent = JSON.stringify(query(), null, 2);
  const total = state.targets.reduce((sum, target) => sum + (Number(target.percent) || 0), 0);
  $('remainder').hidden = state.mode !== 'proportions';
  $('remainder').classList.toggle('invalid', total > 100);
  $('remainder').textContent = total > 100 ? `${total}% requested — reduce the total to 100% or less.` : total === 100 ? 'Full composition: all color portions are specified.' : `${Math.round((100 - total) * 10) / 10}% unspecified. Extra requested color still counts toward its target.`;
  $('search').disabled = state.running || state.selected.size === 0 || (state.mode === 'proportions' && total > 100);
  $('search-top').disabled = $('search').disabled;
  $('search-top').textContent = state.running ? 'Comparing…' : 'Compare selected';
  $('add-target').disabled = state.targets.length >= 8;
}
function slider(label, value, callback) {
  const wrapper = element('label', 'slider-label');
  wrapper.append(element('span', '', label));
  const output = element('output', '', `${Math.round(value * 100)}%`);
  const input = element('input');
  input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1'; input.value = String(Math.round(value * 100));
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => { output.value = `${input.value}%`; callback(Number(input.value) / 100); updatePreview(); });
  wrapper.append(output, input);
  return wrapper;
}
function renderTargets() {
  $('targets').replaceChildren();
  state.targets.forEach((target, index) => {
    const card = element('div', 'target');
    const top = element('div', 'target-top');
    const name = select(colors.map(([id, label]) => [id, label]), target.name ?? 'custom', (value) => {
      target.name = value === 'custom' ? undefined : value;
      target.color = colors.find(([id]) => id === value)[2];
      target.customRange = false; delete target.tolerance; delete target.space;
      renderTargets();
    });
    name.setAttribute('aria-label', `Color or vibe ${index + 1}`);
    top.append(name);
    if (state.targets.length > 1) { const remove = button('×', 'remove-target', () => { state.targets.splice(index, 1); renderTargets(); }); remove.setAttribute('aria-label', `Remove target ${index + 1}`); top.append(remove); }
    card.append(top);
    const row = element('div', 'color-row');
    const picker = element('input'); picker.type = 'color'; picker.value = target.color; picker.setAttribute('aria-label', `Choose color ${index + 1}`);
    const hex = element('input', 'hex-input'); hex.value = target.color; hex.maxLength = 7; hex.setAttribute('aria-label', `Hex color ${index + 1}`); hex.spellcheck = false;
    picker.addEventListener('input', () => { target.color = picker.value; hex.value = picker.value; delete target.name; name.value = 'custom'; updatePreview(); });
    hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { target.color = hex.value; picker.value = hex.value; delete target.name; name.value = 'custom'; updatePreview(); } else { hex.value = target.color; toast('Use a six-digit hex value, such as #ff2200.'); } });
    row.append(picker, hex);
    if (state.mode === 'proportions') {
      const percent = element('input', 'percent-input'); percent.type = 'number'; percent.min = '0'; percent.max = '100'; percent.step = '1'; percent.value = String(target.percent ?? 0); percent.setAttribute('aria-label', `Percentage for target ${index + 1}`);
      percent.addEventListener('input', () => { target.percent = Number(percent.value); updatePreview(); });
      row.append(percent, element('span', 'percent-label', '%'));
    }
    card.append(row);
    const details = element('details'); details.open = Boolean(target.customRange);
    details.append(element('summary', '', 'Color range and falloff'));
    const toggleLabel = element('label', 'range-toggle');
    const toggle = element('input'); toggle.type = 'checkbox'; toggle.checked = Boolean(target.customRange);
    toggleLabel.append(toggle, element('span', '', 'Use a custom range around this color'));
    toggle.addEventListener('change', () => { target.customRange = toggle.checked; target.space ??= 'oklab'; target.tolerance ??= { distance: 0.2 }; renderTargets(); });
    details.append(toggleLabel);
    if (target.customRange) {
      const ranges = element('div', 'range-fields');
      const colorSpace = select([['oklab', 'Perceptual distance (OKLab)'], ['rgb', 'Separate RGB distances'], ['hsv', 'Separate hue / saturation / value'], ['hsl', 'Separate hue / saturation / lightness']], target.space ?? 'oklab', (value) => {
        target.space = value;
        target.tolerance = Object.fromEntries(axes[value].map(([key]) => [key, key === 'h' ? 0.2 : 0.25]));
        renderTargets();
      });
      colorSpace.className = 'range-space'; colorSpace.setAttribute('aria-label', `Color space for target ${index + 1}`); ranges.append(colorSpace);
      for (const [key, label] of axes[target.space ?? 'oklab']) ranges.append(slider(label, target.tolerance?.[key] ?? 0.2, (value) => { target.tolerance ??= {}; target.tolerance[key] = value; }));
      ranges.append(element('p', 'target-note', target.space === 'hsv' || target.space === 'hsl' ? 'Hue wraps around the color wheel. 100% allows every hue. Other axes use their full 0–100% scale.' : target.space === 'rgb' ? 'Distances use each channel’s full 0–255 range.' : 'A perceptual range around the swatch; the exact distance convention is shown in the method details.'));
      details.append(ranges);
    }
    if (target.customRange) {
      details.append(slider('Value at the range edge', target.edgeWeight ?? 0.5, (value) => { target.edgeWeight = value; }));
      details.append(element('p', 'target-note', 'The center has full value. Methods can differ in how they use range, area, and color quality; unsupported controls are reported.'));
    } else details.append(element('p', 'target-note', target.name
      ? 'Named colors use each method’s built-in perceptual family. Enable a custom range to choose the color distances and edge falloff.'
      : 'Picked colors use each method’s default color-distance model. Enable a custom range to choose the distances and edge falloff; methods without those controls will report unsupported.'));
    card.append(details);
    $('targets').append(card);
  });
  $('mode-vibe').setAttribute('aria-pressed', String(state.mode === 'vibe'));
  $('mode-proportions').setAttribute('aria-pressed', String(state.mode === 'proportions'));
  const namedVibePair = state.mode === 'vibe' && state.targets.length === 2 && state.targets.every(target => target.name && !target.customRange);
  const pairNames = new Set(state.targets.map(target => target.name));
  $('mode-help').textContent = state.mode !== 'vibe'
    ? 'Aim close to each requested area, including when the remainder is unspecified.'
    : namedVibePair && pairNames.has('dark') && pairNames.has('bright')
      ? 'Find a mostly dark wallpaper with small bright areas that stand out.'
      : namedVibePair && pairNames.has('grayscale') && pairNames.has('red')
        ? 'Find a mostly grayscale wallpaper with red as the colored accent.'
        : 'Find wallpapers that feel like your chosen colors.';
  updatePreview();
}
function engineName(method, evidence = {}) {
  const engine = evidence.engine ?? method.engine ?? 'opensearch';
  return { opensearch: 'OpenSearch', clickhouse: 'ClickHouse' }[engine] ?? engine;
}
function methodDescription(method) {
  if (typeof method.description === 'string') return method.description;
  return typeof method.execution === 'string' ? method.execution : method.execution?.kind ?? engineName(method);
}
function renderMethods() {
  if (!state.metadata) return;
  $('methods').replaceChildren();
  const groups = new Map();
  const searchText = $('method-search').value.trim().toLowerCase();
  $('select-all').textContent = searchText ? 'All methods' : 'All';
  const matching = state.metadata.methods.filter((method) => !searchText || [method.id, method.label, method.family].some((value) => String(value ?? '').toLowerCase().includes(searchText)));
  const updateCount = () => { $('method-count').textContent = `${matching.length} of ${state.metadata.methods.length} methods shown · ${state.selected.size} selected`; };
  updateCount();
  const groupFor = (method) => {
    if (method.engine === 'clickhouse') return 'Other search services';
    if (['intent-refinement', 'direct-palette', 'relative-contrast'].includes(method.family)) return 'Refined methods';
    if (['vector', 'vector-reference'].includes(method.family)) return 'Vector distances';
    if (['native', 'native-refined', 'postings', 'rank-features', 'native-precision-grid', 'overlap-quality'].includes(method.family)) return 'Indexed color features';
    if (['distribution', 'transport'].includes(method.family)) return 'Distribution and transport';
    return 'Area, palette, and composition';
  };
  for (const method of matching) {
    const group = groupFor(method);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(method);
  }
  for (const group of ['Refined methods', 'Vector distances', 'Indexed color features', 'Area, palette, and composition', 'Distribution and transport', 'Other search services']) {
    const methods = groups.get(group);
    if (!methods?.length) continue;
    const details = element('details', 'method-group');
    details.open = Boolean(searchText) || methods.some((method) => state.selected.has(method.id));
    const summary = element('summary');
    const updateLabel = () => { summary.textContent = `${group} · ${methods.filter((method) => state.selected.has(method.id)).length}/${methods.length}`; };
    updateLabel(); details.append(summary);
    for (const method of methods) {
    const label = element('label', 'method-option');
    label.title = [method.description, ...strings(method.limitations)].filter(Boolean).join(' ');
    const check = element('input'); check.type = 'checkbox'; check.checked = state.selected.has(method.id);
    check.addEventListener('change', () => { if (check.checked) state.selected.add(method.id); else state.selected.delete(method.id); updateLabel(); updateCount(); updatePreview(); });
    const description = element('span');
    description.append(element('span', 'name', method.label ?? method.id), element('span', 'sub', `${engineName(method)} · ${method.family ?? methodDescription(method)}`));
    label.append(check, description); details.append(label);
    }
    $('methods').append(details);
  }
  if (!matching.length) $('methods').append(element('p', 'hint', 'No method names match. Clear the search to see every method.'));
  updatePreview();
}
function selectDefault() {
  const methods = state.metadata.methods;
  const defaults = methods.filter((method) => method.defaultSelected);
  if (defaults.length) state.selected = new Set(defaults.map((method) => method.id));
  else {
    const starter = ['hsv-cosine-ann', 'feature-intent-balanced', 'hybrid-relative-accents'].filter((id) => methods.some((method) => method.id === id));
    if (starter.length === 3) { state.selected = new Set(starter); renderMethods(); return; }
    const families = new Set();
    state.selected = new Set();
    for (const method of methods) { const family = method.family ?? method.id; if (!families.has(family)) { families.add(family); state.selected.add(method.id); } if (state.selected.size >= 3) break; }
  }
  renderMethods();
}
function usePreset(preset) {
  state.mode = preset.query.mode;
  state.targets = preset.query.targets.map((target) => ({ ...structuredClone(target), customRange: Boolean(target.tolerance), percent: target.percent ?? 40 }));
  renderTargets();
}
function badge(label, type) {
  const node = element('span', `badge ${type ?? ''}`, label);
  if (label === 'Exact for this score') node.title = 'Global ordering for the stored scoring objective. This does not guarantee agreement with human perception.';
  if (label === 'Approximate retrieval') node.title = 'Approximate nearest-neighbor retrieval can miss documents that score higher globally.';
  return node;
}
function newColumn(method) {
  const column = element('section', 'result-column');
  const head = element('div', 'result-head');
  head.append(element('div', 'method-family', method.family ?? 'Search method'), element('h3', '', method.label ?? method.id));
  const badges = element('div', 'badges'); head.append(badges);
  const description = methodDescription(method); if (description) head.append(element('p', 'result-description', description));
  const content = element('div', 'column-message'); content.append(element('span', 'spinner'), document.createTextNode('Waiting to query…'));
  column.append(head, content);
  return { column, head, badges, content };
}
function strings(value) { return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []; }
function renderResponse(parts, method, result) {
  parts.content.remove();
  if (result.supported === false) {
    parts.badges.append(badge('Unsupported query', 'approximate'));
    parts.column.append(element('p', 'column-message error', result.reason ?? 'This method does not support the query.'));
    return;
  }
  parts.badges.append(badge(`${result.elapsedMs.toFixed(1)} ms`, result.exceedsOneSecond ? 'slow' : 'good'));
  if (result.exceedsOneSecond) parts.badges.append(badge('Over 1 second', 'slow'));
  const evidence = result.evidence ?? {};
  const execution = result.execution ?? method.execution ?? {};
  const approximate = result.approximate ?? evidence.approximate ?? execution.approximate ?? method.approximate;
  const exact = result.exact ?? evidence.exact ?? execution.exact ?? method.exact;
  if (approximate === true || exact === false || /approx|ann|hnsw/i.test(String(method.retrieval ?? execution.kind ?? ''))) parts.badges.append(badge('Approximate retrieval', 'approximate'));
  else if (exact === true || approximate === false || /exact/i.test(String(method.retrieval ?? execution.kind ?? ''))) parts.badges.append(badge('Exact for this score'));
  else parts.badges.append(badge('See method guarantees'));
  if (method.objectiveApproximation) parts.badges.append(badge('Interpolated color score · global indexed ranking', 'approximate'));
  const took = evidence.serviceTookMs ?? evidence.tookMs ?? evidence.took ?? result.tookMs;
  if (typeof took === 'number') parts.badges.append(badge(`${engineName(method, evidence)} ${took} ms`));
  else parts.badges.append(badge(engineName(method, evidence)));
  const warnings = [...strings(method.limitations), ...strings(result.warnings), ...strings(evidence.warnings)];
  if (warnings.length || Object.keys(evidence).length) {
    const notes = element('details', 'result-notes'); notes.append(element('summary', '', warnings.length ? `Method notes · ${warnings.length}` : 'Query evidence'));
    if (warnings.length) { const list = element('ul'); for (const warning of [...new Set(warnings)]) list.append(element('li', '', warning)); notes.append(list); }
    if (Object.keys(evidence).length) notes.append(element('pre', '', JSON.stringify(evidence, null, 2)));
    parts.column.append(notes);
  }
  const eligible = typeof result.totalEligible === 'number' ? ` of ${evidence.totalRelation === 'gte' ? '≥' : ''}${result.totalEligible.toLocaleString()} eligible` : '';
  parts.badges.append(badge(`${result.hits.length} shown${eligible}`));
  if (!result.hits.length) { parts.column.append(element('p', 'column-message', 'No wallpapers matched this query.')); return; }
  const list = element('div', 'wallpaper-list');
  result.hits.forEach((hit, index) => {
    const figure = element('figure', 'wallpaper');
    const imageButton = button('', 'wallpaper-button', () => showImage(hit, method, index));
    imageButton.setAttribute('aria-label', `Open result ${index + 1}, ${hit.id}`);
    const img = element('img'); img.src = hit.thumbnailUrl ?? hit.imageUrl; img.alt = hit.id; img.loading = index < 3 ? 'eager' : 'lazy'; img.decoding = 'async';
    imageButton.append(img, element('span', 'rank', String(index + 1)));
    const caption = element('figcaption'); caption.append(element('span', 'wallpaper-id', hit.id), element('span', 'wallpaper-score', `score ${Number(hit.score).toPrecision(4)}`));
    figure.append(imageButton, caption); list.append(figure);
  });
  parts.column.append(list);
}
function showImage(hit, method, rank) {
  $('lightbox-image').src = hit.imageUrl;
  $('lightbox-image').alt = hit.id;
  $('lightbox-caption').textContent = `${method.label ?? method.id} · #${rank + 1} · ${hit.id} · score ${Number(hit.score).toPrecision(5)}`;
  $('lightbox-original').href = hit.imageUrl;
  $('lightbox').showModal();
}
async function search() {
  const selected = state.metadata.methods.filter((method) => state.selected.has(method.id));
  if (!selected.length || state.running) return;
  state.running = true;
  const generation = ++state.generation;
  const requestQuery = query();
  const limit = Number($('result-count').value);
  const includeFixtures = $('include-fixtures').checked;
  $('results').replaceChildren();
  $('cancel').hidden = false;
  $('comparison-summary').textContent = `${selected.length} methods · ${limit} results each · queries run one at a time to reduce interference.`;
  updatePreview();
  let finished = 0;
  const columns = selected.map((method) => { const parts = newColumn(method); $('results').append(parts.column); return { method, parts }; });
  document.querySelector('.results-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  for (const { method, parts } of columns) {
    if (state.generation !== generation) { parts.content.textContent = 'Canceled before querying.'; continue; }
    const controller = new AbortController();
    state.controllers.push(controller);
    parts.content.replaceChildren(element('span', 'spinner'), document.createTextNode(`Querying ${engineName(method)}…`));
    $('status').textContent = `Query ${finished + 1} of ${selected.length}: ${method.label ?? method.id}`;
    try {
      const response = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ methodId: method.id, query: requestQuery, limit, includeFixtures }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      renderResponse(parts, method, result);
    } catch (error) {
      parts.content.replaceChildren(document.createTextNode(error.name === 'AbortError' ? 'Canceled.' : error.message));
      parts.content.classList.add('error');
      parts.badges.append(badge('Query unavailable', 'error'));
    } finally { finished++; }
  }
  state.running = false;
  state.controllers = [];
  $('cancel').hidden = true;
  $('status').textContent = state.generation === generation ? `Finished ${finished} method queries. Click an image for its original.` : 'Pending queries canceled.';
  updatePreview();
}
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; setTimeout(() => { $('toast').hidden = true; }, 3500); }
function shareUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('query', JSON.stringify(query()));
  url.searchParams.set('methods', [...state.selected].join(','));
  if ($('include-fixtures').checked) url.searchParams.set('fixtures', '1');
  return url.href;
}

$('mode-vibe').addEventListener('click', () => { state.mode = 'vibe'; renderTargets(); });
$('mode-proportions').addEventListener('click', () => { state.mode = 'proportions'; renderTargets(); });
$('add-target').addEventListener('click', () => { state.targets.push({ name: 'green', color: '#25a34a', percent: Math.max(0, 100 - state.targets.reduce((sum, target) => sum + target.percent, 0)), edgeWeight: 0.5 }); renderTargets(); });
$('preset').addEventListener('change', () => usePreset(state.metadata.presets[Number($('preset').value)]));
$('select-default').addEventListener('click', selectDefault);
$('select-all').addEventListener('click', () => { state.selected = new Set(state.metadata.methods.map((method) => method.id)); renderMethods(); });
$('select-none').addEventListener('click', () => { state.selected.clear(); renderMethods(); });
$('method-search').addEventListener('input', renderMethods);
$('expand-methods').addEventListener('click', () => { for (const family of document.querySelectorAll('.method-group')) family.open = true; });
$('collapse-methods').addEventListener('click', () => { for (const family of document.querySelectorAll('.method-group')) family.open = false; });
$('search').addEventListener('click', search);
$('search-top').addEventListener('click', search);
$('cancel').addEventListener('click', () => { state.generation++; for (const controller of state.controllers) controller.abort(); });
$('image-size').addEventListener('change', () => $('results').classList.toggle('compact-images', $('image-size').value === 'compact'));
$('close-lightbox').addEventListener('click', () => $('lightbox').close());
$('lightbox').addEventListener('click', (event) => { if (event.target === $('lightbox')) $('lightbox').close(); });
$('copy-link').addEventListener('click', async () => {
  const url = shareUrl();
  try { await navigator.clipboard.writeText(url); toast('Query link copied.'); }
  catch { history.replaceState(null, '', url); toast('Query added to the address bar. Copy the URL to share it.'); }
});

try {
  const response = await fetch('/api/meta');
  if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`);
  state.metadata = await response.json();
  $('corpus-summary').textContent = `${(state.metadata.wallpaperCount ?? state.metadata.corpusCount).toLocaleString()} wallpapers + ${state.metadata.fixtureCount ?? 0} test swatches · ${state.metadata.methods.length} service-backed methods`;
  $('fixtures-label').textContent = `Include ${state.metadata.fixtureCount ?? 0} controlled test swatches`;
  if (state.metadata.reportUrl) $('evaluation-link').href = state.metadata.reportUrl;
  if (state.metadata.findingsUrl) { $('findings-link').href = state.metadata.findingsUrl; $('findings-link').hidden = false; }
  for (const [index, preset] of state.metadata.presets.entries()) { const option = element('option', '', preset.label); option.value = String(index); $('preset').append(option); }
  selectDefault();
  const params = new URLSearchParams(location.search);
  $('include-fixtures').checked = params.get('fixtures') === '1';
  if (params.has('query')) {
    try { const savedQuery = JSON.parse(params.get('query')); if (!['vibe', 'proportions'].includes(savedQuery.mode) || !Array.isArray(savedQuery.targets) || savedQuery.targets.length > 8) throw new Error('Invalid'); usePreset({ query: savedQuery }); }
    catch { toast('Could not load the query from this link.'); renderTargets(); }
  } else renderTargets();
  if (params.has('methods')) { state.selected = new Set(params.get('methods').split(',').filter((id) => state.metadata.methods.some((method) => method.id === id))); renderMethods(); }
} catch (error) {
  $('corpus-summary').textContent = 'The prototype service could not be loaded.';
  $('status').textContent = error.message;
  $('search').disabled = true;
}
