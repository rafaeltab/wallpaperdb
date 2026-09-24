const $ = (selector) => document.querySelector(selector);
const allowedStatuses = new Set(['ranked', 'none-match', 'unsure', 'skipped', 'notes-only']);
let batch;
let state;
let storageKey;
let submitting = false;
let storageAvailable = true;
let tieNext = false;
let storedAnswerSignature = '{}';
let concurrentDraft = false;
let recoveryOriginal = null;

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') element.className = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child !== undefined && child !== null) element.append(child);
  return element;
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function freshState() {
  return { batchId: batch.id, batchVersion: batch.version, activeCaseId: batch.cases[0].id, answers: {}, lastSubmission: null, pendingSubmission: null };
}

function currentCase() {
  return batch.cases.find((item) => item.id === state.activeCaseId) || batch.cases[0];
}

function answerFor(caseId) {
  return state.answers[caseId] || { caseId, status: 'notes-only', ranking: [], notes: '', updatedAt: new Date().toISOString() };
}

function answeredItems() {
  return batch.cases.map((item) => state.answers[item.id]).filter(Boolean);
}

function fingerprint() {
  return JSON.stringify(answeredItems());
}

function showNotice(text, isError = false) {
  $('#notice').textContent = text;
  $('#notice').classList.toggle('error', isError);
  $('#notice').hidden = !text;
}

function answerSignature(raw) {
  if (!raw) return '{}';
  try { return JSON.stringify(JSON.parse(raw).answers || {}); }
  catch { return raw; }
}

function detectConcurrentDraft(raw) {
  if (answerSignature(raw) !== storedAnswerSignature && !concurrentDraft) {
    concurrentDraft = true;
    storageAvailable = false;
    showNotice('Another tab changed this batch’s browser draft. This tab will keep its edits in memory without overwriting that draft. Submit or export this tab’s answers, then reload to see the other tab’s work.', true);
  }
  return concurrentDraft;
}

function saveLocal() {
  try {
    if (!detectConcurrentDraft(localStorage.getItem(storageKey))) {
      const serialized = JSON.stringify(state);
      localStorage.setItem(storageKey, serialized);
      storedAnswerSignature = answerSignature(serialized);
      storageAvailable = true;
    }
  } catch {
    storageAvailable = false;
    showNotice('This browser could not save your draft. Keep this page open and submit or export your answers before leaving.', true);
  }
  updateOverview();
}

function restoreState() {
  state = freshState();
  let raw;
  let invalidAnswers = 0;
  try {
    raw = localStorage.getItem(storageKey);
    storedAnswerSignature = answerSignature(raw);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.batchId !== batch.id || saved.batchVersion !== batch.version || !saved.answers || typeof saved.answers !== 'object') throw new Error('Wrong draft version');
    for (const item of batch.cases) {
      const answer = saved.answers[item.id];
      if (!answer) continue;
      const labels = new Set(item.examples.map((example) => example.label));
      const flat = Array.isArray(answer.ranking) ? answer.ranking.flat() : [];
      if (answer.caseId !== item.id || !allowedStatuses.has(answer.status) || typeof answer.notes !== 'string' || !Array.isArray(answer.ranking) || answer.ranking.some((group) => !Array.isArray(group) || !group.length) || flat.some((label) => !labels.has(label)) || new Set(flat).size !== flat.length || !Number.isFinite(Date.parse(answer.updatedAt)) || ((answer.status === 'skipped' || answer.status === 'notes-only') && flat.length) || (answer.status === 'ranked' && !flat.length)) {
        invalidAnswers++;
        continue;
      }
      state.answers[item.id] = { caseId: item.id, status: answer.status, ranking: answer.ranking, notes: answer.notes, updatedAt: answer.updatedAt };
    }
    if (batch.cases.some((item) => item.id === saved.activeCaseId)) state.activeCaseId = saved.activeCaseId;
    state.lastSubmission = saved.lastSubmission || null;
    state.pendingSubmission = saved.pendingSubmission || null;
    if (invalidAnswers) preserveOriginalDraft(raw, `${invalidAnswers} saved answer(s) could not be restored. Valid answers were recovered.`);
  } catch {
    if (raw) preserveOriginalDraft(raw, 'The saved browser draft could not be read.');
    else {
      storageAvailable = false;
      showNotice('This browser’s saved draft could not be accessed. Submit or export your answers before leaving.', true);
    }
  }
}

function preserveOriginalDraft(raw, explanation) {
  recoveryOriginal = raw;
  try { localStorage.setItem(`${storageKey}:recovery:${Date.now()}`, raw); }
  catch { /* The original remains available in memory for immediate export. */ }
  const recoveryButton = node('button', { type: 'button', onclick: () => downloadBlob(recoveryOriginal, `${batch.id}-original-browser-draft.txt`, 'text/plain') }, 'Export original draft');
  recoveryButton.id = 'export-recovery';
  $('.header-actions').prepend(recoveryButton);
  showNotice(`${explanation} The original is preserved separately; use Export original draft to keep an exact copy before continuing.`, true);
}

function changeAnswer(change, rerender = true) {
  const item = currentCase();
  const answer = structuredClone(answerFor(item.id));
  if (change(answer) === false) return;
  answer.updatedAt = new Date().toISOString();
  if (!answer.ranking.length && answer.status === 'ranked') answer.status = 'notes-only';
  if (answer.status === 'notes-only' && !answer.notes.trim()) delete state.answers[item.id];
  else state.answers[item.id] = answer;
  saveLocal();
  if (rerender) renderAnswer();
  updateImageRanks();
}

function selectImage(label) {
  changeAnswer((answer) => {
    const existing = answer.ranking.findIndex((group) => group.includes(label));
    if (existing >= 0) {
      answer.ranking[existing] = answer.ranking[existing].filter((entry) => entry !== label);
      answer.ranking = answer.ranking.filter((group) => group.length);
    } else if (tieNext && answer.ranking.length) {
      answer.ranking.at(-1).push(label);
      tieNext = false;
    } else {
      answer.ranking.push([label]);
      tieNext = false;
    }
    if (answer.status === 'notes-only' || answer.status === 'skipped') answer.status = 'ranked';
  });
}

function statusText(item) {
  const answer = state.answers[item.id];
  if (!answer) return 'Not reviewed';
  const count = answer.ranking.flat().length;
  if (answer.status === 'ranked') return count === item.examples.length ? 'Ranked' : `${count}/${item.examples.length} ranked · partial`;
  return { 'none-match': 'None fits well', unsure: 'Unsure', skipped: 'Skipped', 'notes-only': 'Notes only' }[answer.status];
}

function updateOverview() {
  if (!batch) return;
  const answers = answeredItems();
  const reviewed = answers.filter((answer) => !['skipped', 'notes-only'].includes(answer.status)).length;
  const notes = answers.filter((answer) => answer.status === 'notes-only').length;
  const skipped = answers.filter((answer) => answer.status === 'skipped').length;
  const partial = answers.filter((answer) => answer.status === 'ranked' && answer.ranking.flat().length < batch.cases.find((item) => item.id === answer.caseId).examples.length).length;
  $('#progress-count').textContent = `${reviewed} / ${batch.cases.length} reviewed${partial ? ` · ${partial} partial` : ''}${notes ? ` · ${notes} notes only` : ''}${skipped ? ` · ${skipped} skipped` : ''}`;
  $('#menu-count').textContent = `${reviewed}/${batch.cases.length}`;
  $('#storage-status').textContent = concurrentDraft ? 'Another tab changed the draft — submit/export this tab before reloading.' : storageAvailable ? 'Draft saved in this browser. Submit to save it to the shared library.' : 'Browser save unavailable — submit or export to keep your work.';
  for (const button of $('#case-list').children) {
    const item = batch.cases.find((entry) => entry.id === button.dataset.caseId);
    const answer = state.answers[item.id];
    button.querySelector('.case-state').textContent = statusText(item);
    button.classList.toggle('has-answer', Boolean(answer && !['skipped', 'notes-only'].includes(answer.status)));
    button.classList.toggle('is-skipped', answer?.status === 'skipped');
    if (item.id === state.activeCaseId) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    button.setAttribute('aria-label', `Comparison ${batch.cases.indexOf(item) + 1}: ${item.query.text}. ${statusText(item)}`);
  }
  const unchanged = state.lastSubmission?.fingerprint === fingerprint();
  $('#submission-status').textContent = state.lastSubmission ? unchanged ? `Submitted ${new Date(state.lastSubmission.savedAt).toLocaleString()}.` : 'There are changes since your last submission.' : 'No answers submitted yet.';
  $('#submit').disabled = submitting || !answers.length;
  $('#submit').textContent = submitting ? 'Saving…' : unchanged ? 'Submit again' : 'Submit answers';
  $('#export').disabled = !answers.length;
  $('#clear').disabled = submitting || !answers.length || concurrentDraft;
  const next = $('.page-navigation .next');
  if (next) next.disabled = batch.cases.indexOf(currentCase()) === batch.cases.length - 1 ? submitting || !answers.length : false;
  const inline = $('#inline-saved');
  if (inline) inline.textContent = storageAvailable ? 'Saved in this browser.' : 'Not saved in this browser.';
}

function navigate(caseId) {
  state.activeCaseId = caseId;
  tieNext = false;
  saveLocal();
  renderCase();
  if (matchMedia('(max-width: 760px)').matches) $('#case-menu').open = false;
  $('#review').focus({ preventScroll: true });
  $('#review').scrollIntoView({ behavior: 'instant', block: 'start' });
}

function safeSourceLink(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

function imageCard(example) {
  const imageUrl = `/${example.filename.split('/').map(encodeURIComponent).join('/')}`;
  const picture = node('img', { src: imageUrl, alt: `Wallpaper ${example.label}`, decoding: 'async' });
  picture.addEventListener('error', () => {
    const card = picture.closest('figure');
    if (!card.querySelector('.image-error')) card.append(node('p', { class: 'image-error' }, 'This photograph did not load. Try opening the full-size image or skip this comparison.'));
  });
  return node('figure', { class: 'photo-card', 'data-label': example.label },
    node('figcaption', { class: 'photo-caption' }, node('strong', {}, example.label), node('span', { class: 'rank-badge' }, '')),
    node('a', { class: 'photo-link', href: imageUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open wallpaper ${example.label} at full size` }, picture),
    node('div', { class: 'photo-actions' },
      node('button', { type: 'button', class: 'pick-image', onclick: () => selectImage(example.label), 'aria-pressed': 'false' }, `Rank ${example.label}`),
      node('a', { href: imageUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open wallpaper ${example.label} at full size` }, 'Full size ↗')));
}

function updateImageRanks() {
  const ranking = answerFor(currentCase().id).ranking;
  for (const figure of document.querySelectorAll('.photo-card')) {
    const label = figure.dataset.label;
    const index = ranking.findIndex((group) => group.includes(label));
    figure.classList.toggle('selected', index >= 0);
    figure.querySelector('.rank-badge').textContent = index >= 0 ? `${ranking[index].length > 1 ? 'Tied ' : ''}#${index + 1}` : '';
    figure.querySelector('.pick-image').textContent = index >= 0 ? `Remove ${label}` : `Rank ${label}`;
    figure.querySelector('.pick-image').setAttribute('aria-pressed', String(index >= 0));
  }
}

function renderCase() {
  const item = currentCase();
  const index = batch.cases.indexOf(item);
  const heading = node('div', { class: 'query-heading' }, node('h1', { id: 'query-title' }, item.query.text));
  if (/^#[0-9a-f]{6}$/i.test(item.query.swatchHex || '')) {
    const swatch = node('span', { class: 'swatch', role: 'img', 'aria-label': `Target color ${item.query.swatchHex}` });
    swatch.style.backgroundColor = item.query.swatchHex;
    heading.prepend(swatch);
  }
  const photos = node('section', { class: 'photo-grid', 'aria-label': 'Wallpaper examples' }, item.examples.map(imageCard));
  const panel = node('section', { class: 'answer-panel', id: 'answer-panel', 'aria-label': 'Your assessment' });
  const previous = node('button', { type: 'button', onclick: () => navigate(batch.cases[index - 1].id) }, '← Previous');
  previous.disabled = index === 0;
  const next = node('button', { type: 'button', class: 'next primary', onclick: () => {
    if (index < batch.cases.length - 1) navigate(batch.cases[index + 1].id);
    else submitAnswers();
  } }, index < batch.cases.length - 1 ? 'Next comparison →' : 'Submit answers');
  next.disabled = submitting || (index === batch.cases.length - 1 && !answeredItems().length);
  const credits = node('ul');
  for (const example of item.examples) {
    const source = safeSourceLink(example.sourcePage);
    const license = safeSourceLink(example.licenseUrl);
    credits.append(node('li', {}, `${example.label}: `,
      source ? node('a', { href: source, target: '_blank', rel: 'noopener noreferrer' }, 'Source photograph') : 'Source unavailable',
      ` — ${example.author || 'original author unknown'}. `,
      license ? node('a', { href: license, target: '_blank', rel: 'noopener noreferrer' }, example.license || 'License') : `License: ${example.license || 'unknown'}`,
      '. Image shown unchanged.'));
  }
  $('#review').replaceChildren(
    node('header', {}, node('p', { class: 'eyebrow' }, `Comparison ${index + 1} of ${batch.cases.length} · Your search request`), heading,
      item.query.detail ? node('p', { class: 'query-detail' }, item.query.detail) : null,
      node('p', { class: 'instruction' }, 'Judge the whole image. Click Rank in your preferred order; ties, partial orders, and uncertainty are welcome.')),
    node('div', { class: 'review-layout' }, photos, panel),
    node('div', { class: 'page-navigation' }, previous, node('span', { class: 'position' }, `${index + 1} / ${batch.cases.length}`), next),
    node('details', { class: 'credits' }, node('summary', {}, 'Image sources and attribution'), credits));
  renderAnswer();
  updateImageRanks();
  updateOverview();
  document.title = `${index + 1}/${batch.cases.length} · ${item.query.text} · Color review`;
}

function renderAnswer() {
  const item = currentCase();
  const answer = answerFor(item.id);
  const selected = answer.ranking.flat();
  const ranking = node('ol', { class: 'ranked-order', 'aria-label': 'Your ranking from best to worst' });
  answer.ranking.forEach((group, index) => {
    const up = node('button', { type: 'button', 'aria-label': `Move ${group.join(' and ')} up`, onclick: () => changeAnswer((draft) => {
      [draft.ranking[index - 1], draft.ranking[index]] = [draft.ranking[index], draft.ranking[index - 1]];
    }) }, '↑');
    const down = node('button', { type: 'button', 'aria-label': `Move ${group.join(' and ')} down`, onclick: () => changeAnswer((draft) => {
      [draft.ranking[index + 1], draft.ranking[index]] = [draft.ranking[index], draft.ranking[index + 1]];
    }) }, '↓');
    up.disabled = index === 0;
    down.disabled = index === answer.ranking.length - 1;
    ranking.append(node('li', { class: 'rank-row' }, node('span', { class: 'rank-index' }, `${index + 1}.`),
      node('div', { class: 'rank-group' }, group.map((label) => node('button', { type: 'button', class: 'rank-chip', 'aria-label': `Remove ${label} from ranking`, onclick: () => selectImage(label) }, label, node('span', { 'aria-hidden': 'true' }, '×')))),
      node('div', { class: 'rank-move' }, up, down)));
  });
  const tie = node('input', { type: 'checkbox', id: 'tie-next', onchange: (event) => { tieNext = event.target.checked; } });
  tie.disabled = !answer.ranking.length || selected.length === item.examples.length;
  if (!answer.ranking.length) tieNext = false;
  tie.checked = tieNext;
  const setStatus = (status) => changeAnswer((draft) => {
    if (draft.status === status) draft.status = draft.ranking.length ? 'ranked' : 'notes-only';
    else {
      if (status === 'skipped' && draft.ranking.length && !confirm('Skip this comparison and clear its ranking? Your notes will be kept.')) return false;
      draft.status = status;
      if (status === 'skipped') draft.ranking = [];
    }
  });
  const statusOptions = node('div', { class: 'status-options', 'aria-label': 'Overall assessment' },
    node('button', { type: 'button', 'aria-pressed': String(answer.status === 'none-match'), onclick: () => setStatus('none-match') }, 'None fits well'),
    node('button', { type: 'button', 'aria-pressed': String(answer.status === 'unsure'), onclick: () => setStatus('unsure') }, 'I’m unsure'),
    node('button', { type: 'button', class: 'skip-answer', 'aria-pressed': String(answer.status === 'skipped'), onclick: () => setStatus('skipped') }, 'Skip for now'));
  const statusDescription = { 'none-match': 'No good match. You can still rank which comes closest.', unsure: 'Your uncertainty is recorded alongside any order or notes.', skipped: 'Skipped for now. Any notes are preserved.', ranked: 'This records preference, not rejection of lower-ranked images.', 'notes-only': 'An order is optional. Notes alone are useful too.' }[answer.status];
  const notes = node('textarea', { id: 'case-notes', maxlength: '6000', placeholder: 'Optional: e.g. A has too little red; B is too muted.', 'aria-describedby': 'notes-help notes-count', oninput: (event) => {
    changeAnswer((draft) => { draft.notes = event.target.value; }, false);
    $('#notes-count').textContent = `${event.target.value.length.toLocaleString()} / 6,000 characters`;
  } });
  notes.value = answer.notes;
  const missing = item.examples.map((example) => example.label).filter((label) => !selected.includes(label));
  $('#answer-panel').replaceChildren(
    node('div', { class: 'ranking-section' },
      node('h2', {}, 'Your order'), node('p', { class: 'help' }, 'Best match first. Click a ranked letter to remove it.'),
      answer.ranking.length ? ranking : node('p', { class: 'rank-empty' }, 'Click Rank below your favorite image to begin.'),
      node('label', { class: 'tie-control' }, tie, 'Next pick ties with the last group'),
      node('p', { class: 'ranking-note' }, missing.length ? `${selected.length}/${item.examples.length} ranked. Unranked: ${missing.join(', ')}. These remain unjudged, not last.` : 'All images ranked. Images in the same group are tied.'),
      answer.ranking.length ? node('button', { type: 'button', class: 'quiet clear-order', onclick: () => changeAnswer((draft) => { draft.ranking = []; }) }, 'Clear order') : null,
      node('hr', { class: 'answer-separator' }), statusOptions, node('p', { class: 'status-description' }, statusDescription)),
    node('div', { class: 'notes-section' }, node('hr', { class: 'answer-separator' }), node('label', { class: 'notes-label', for: 'case-notes' }, 'Notes · optional'), notes,
      node('p', { class: 'notes-help', id: 'notes-help' }, 'You can mention individual letters or the comparison overall. Notes save as you type.'),
      node('p', { class: 'notes-help', id: 'notes-count' }, `${answer.notes.length.toLocaleString()} / 6,000 characters`)),
    node('p', { class: 'inline-saved', id: 'inline-saved', 'aria-live': 'polite' }, storageAvailable ? 'Saved in this browser.' : 'Not saved in this browser.'));
}

function submissionPayload() {
  const current = fingerprint();
  if (state.pendingSubmission?.fingerprint !== current) state.pendingSubmission = { id: uuid(), fingerprint: current };
  saveLocal();
  return { batchId: batch.id, batchVersion: batch.version, answers: answeredItems(), submissionId: state.pendingSubmission.id };
}

async function submitAnswers() {
  if (submitting || !answeredItems().length) return;
  const tooLong = answeredItems().find((answer) => answer.notes.length > 6000);
  if (tooLong) {
    navigate(tooLong.caseId);
    showNotice('A restored note exceeds the 6,000-character limit. Export JSON to preserve the original, then shorten this note before submitting. No text has been removed.', true);
    $('#case-notes').focus();
    return;
  }
  const payload = submissionPayload();
  const sentFingerprint = fingerprint();
  submitting = true;
  updateOverview();
  const bottomSubmit = $('.page-navigation .next');
  if (bottomSubmit && batch.cases.indexOf(currentCase()) === batch.cases.length - 1) bottomSubmit.disabled = true;
  showNotice('Saving your answers to the shared library…');
  try {
    const response = await fetch('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Save failed (HTTP ${response.status})`);
    if (!result?.id || !result?.savedAt) throw new Error('The server did not confirm a saved submission');
    state.lastSubmission = { id: result.id, savedAt: result.savedAt, fingerprint: sentFingerprint };
    saveLocal();
    const noteCount = payload.answers.filter((answer) => answer.status === 'notes-only').length;
    const skipCount = payload.answers.filter((answer) => answer.status === 'skipped').length;
    const answerCount = payload.answers.length - noteCount - skipCount;
    showNotice(`Saved to the shared library: ${answerCount} reviewed${noteCount ? `, ${noteCount} notes-only` : ''}${skipCount ? `, ${skipCount} skipped` : ''}. You can keep reviewing and submit again.${fingerprint() !== sentFingerprint ? ' Your newest edits are still in the browser; submit again to save those too.' : ''}`);
  } catch (error) {
    showNotice(`Could not confirm the save: ${error.message}. Your browser draft is retained. Retry, or use Export JSON to save a copy.`, true);
  } finally {
    submitting = false;
    updateOverview();
    const next = $('.page-navigation .next');
    if (next) next.disabled = batch.cases.indexOf(currentCase()) === batch.cases.length - 1 && !answeredItems().length;
  }
}

function exportAnswers() {
  const payload = submissionPayload();
  downloadBlob(JSON.stringify(payload, null, 2) + '\n', `${batch.id}-responses-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, 'application/json');
  showNotice('JSON export requested. This contains every recorded answer and note; it does not submit them to the server.');
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = node('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function start() {
  try {
    const response = await fetch('/api/batch', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    batch = await response.json();
    if (!batch.id || !Number.isInteger(batch.version) || !Array.isArray(batch.cases) || !batch.cases.length) throw new Error('Invalid batch data');
    const ids = new Set();
    for (const item of batch.cases) {
      if (!item.id || ids.has(item.id) || typeof item.query?.text !== 'string' || !Array.isArray(item.examples) || !item.examples.length) throw new Error('Invalid comparison data');
      ids.add(item.id);
      const labels = new Set();
      for (const example of item.examples) {
        if (!example.label || labels.has(example.label) || typeof example.filename !== 'string' || !example.filename.startsWith('corpus/') || example.filename.split('/').includes('..')) throw new Error('Invalid image data');
        labels.add(example.label);
      }
    }
    storageKey = `wallpaperdb:color-review:${batch.id}:v${batch.version}`;
    restoreState();
    window.addEventListener('storage', (event) => {
      if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) {
        detectConcurrentDraft(event.key === null ? null : event.newValue);
        updateOverview();
      }
    });
    window.addEventListener('beforeunload', (event) => {
      if (!storageAvailable && answeredItems().length && state.lastSubmission?.fingerprint !== fingerprint()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    $('#case-list').replaceChildren(...batch.cases.map((item, index) => node('button', { type: 'button', class: 'case-link', 'data-case-id': item.id, onclick: () => navigate(item.id) },
      node('span', { class: 'case-number', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')),
      node('span', { class: 'case-copy' }, node('span', { class: 'case-title' }, item.query.text), node('span', { class: 'case-state' }, 'Not reviewed')))));
    if (matchMedia('(max-width: 760px)').matches) $('#case-menu').open = false;
    $('#submit').addEventListener('click', submitAnswers);
    $('#export').addEventListener('click', exportAnswers);
    $('#clear').addEventListener('click', () => {
      if (!confirm('Clear this batch’s browser draft? Export first if you need a copy. Submitted files in the shared library will not be deleted.')) return;
      state = freshState();
      tieNext = false;
      saveLocal();
      renderCase();
      showNotice('This batch’s browser draft was cleared. Previously submitted files remain in the shared library.');
    });
    renderCase();
  } catch (error) {
    $('#review').replaceChildren(node('div', { class: 'loading' }, node('h1', {}, 'The comparisons could not load'), node('p', {}, `Please try again. ${error.message}`), node('button', { type: 'button', onclick: () => location.reload() }, 'Reload')));
    $('#progress-count').textContent = 'Unable to load comparisons';
    $('#storage-status').textContent = 'Your existing browser draft has not been changed.';
  }
}

start();
