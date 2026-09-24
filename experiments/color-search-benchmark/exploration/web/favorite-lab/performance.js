const $ = selector => document.querySelector(selector);
const names = {
  'cutoff-shade-hue-all-levels': 'Original favorite', 'favorite-fused-script': 'Fused script', 'favorite-typed-script': 'Typed script',
  'favorite-utility-numeric': 'Precomputed numeric', 'favorite-utility-numeric-docvalues': 'Numeric · lean fetch',
  'favorite-utility-rank8': 'Rank features · 8 bit', 'favorite-utility-rank16': 'Rank features · 16 bit',
  'favorite-utility-rank18': 'Rank features · 18 bit', 'favorite-utility-rank27': 'Rank features · 27 bit',
  'favorite-utility-rank27-docvalues': '27 bit · lean fetch', 'favorite-utility-rankfloat': 'Rank features · float',
  'favorite-utility-sorted': 'Direct sort', 'favorite-utility-sorted-docvalues': 'Direct sort · lean fetch',
  'favorite-utility-sorted-scored': 'Direct sort + score', 'favorite-utility-bounded': 'Global bounds',
  'favorite-utility-maxima-bounded': 'Global bounds + seed maxima',
  'favorite-utility-numeric-multiplicity': 'Repeated target weights',
  'favorite-utility-bounded-pooled-delete': 'Global bounds · pooled cleanup',
  'favorite-utility-maxima-bounded-pooled-delete': 'Global maxima · pooled cleanup',
};
const queryNames = { 'picked-one-vibe': 'One color · vibe', 'picked-one-green40': '40% green', 'picked-two-portions': 'Two colors', 'picked-five-portions': 'Five colors' };
const statusNames = { passed: 'Met limit here', failed: 'Failed limit', incomplete: 'Incomplete campaign', unmeasured: 'Unmeasured' };
const fmt = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
const when = value => value ? new Date(value).toLocaleString() : 'Not finished';
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const note = (parent, text, className = 'subtle') => parent.append(el('p', text, className));
function table(headers, rows) {
  const scroll = el('div', undefined, 'table-scroll'), node = el('table'), head = el('tr');
  for (const text of headers) { const th = el('th', text); th.scope = 'col'; head.append(th); }
  const thead = el('thead'); thead.append(head); node.append(thead); const body = el('tbody');
  for (const cells of rows) { const tr = el('tr'); for (const value of cells) { const td = el('td'); typeof value === 'object' && value instanceof Node ? td.append(value) : td.textContent = value; tr.append(td); } body.append(tr); }
  node.append(body); scroll.append(node); return scroll;
}
let data, selected = 'full-100k';
function options(select, values, label) {
  select.replaceChildren(el('option', label)); select.firstChild.value = '';
  for (const [value, text] of values) { const option = el('option', text); option.value = value; select.append(option); }
}
function selectCohort(id) {
  selected = id; const cohort = data.cohorts.find(item => item.id === id);
  for (const button of $('#cohorts').children) button.setAttribute('aria-current', String(button.dataset.cohort === id));
  $('#scope-title').textContent = cohort.title; $('#scope-description').textContent = cohort.description;
  const profiles = cohort.campaigns.flatMap(campaign => campaign.profiles);
  options($('#method-filter'), [...new Set(profiles.map(row => row.method))].sort().map(id => [id, names[id] ?? id]), 'All methods');
  options($('#query-filter'), [...new Set(profiles.map(row => row.queryId))].sort().map(id => [id, queryNames[id] ?? id]), 'All queries');
  options($('#load-filter'), cohort.measuredConcurrencies.map(count => [String(count), String(count)]), 'All measured loads');
  $('#filters').hidden = profiles.length === 0;
  const concurrency = cohort.measuredConcurrencies.length ? cohort.measuredConcurrencies.join(', ') : 'none';
  const arrivals = cohort.measuredArrivalRates.length ? `${cohort.measuredArrivalRates.join(', ')} requests/s` : 'unmeasured';
  $('#coverage').textContent = id === 'real-545' ? 'Preference agreement below measures the saved judgments. Small-corpus timings are not a substitute for scale tests.' :
    `Recorded concurrency: ${concurrency}. Scheduled arrivals: ${arrivals}. ${[4, 16].filter(c => !cohort.measuredConcurrencies.includes(c)).map(c => `Concurrency ${c} is unmeasured.`).join(' ')} Missing tests do not count as passes.`;
  render();
}
function render() {
  const cohort = data.cohorts.find(item => item.id === selected), container = $('#measurements'); container.replaceChildren();
  const method = $('#method-filter').value, query = $('#query-filter').value, concurrency = $('#load-filter').value;
  let shown = 0;
  for (const campaign of [...cohort.campaigns].reverse()) {
    const rows = campaign.profiles.filter(row => (!method || row.method === method) && (!query || row.queryId === query) && (!concurrency || String(row.concurrency) === concurrency));
    // An interrupted campaign's unfinished requests must remain visible even
    // when filters hide every completed profile. Totals are campaign-wide.
    if (!rows.length && campaign.complete) continue; shown++;
    const card = el('section', undefined, 'campaign'), header = el('div', undefined, 'campaign-header');
    header.append(el('h3', campaign.id.replace('/benchmark.json', '').replace('/arrival.json', '')),
      el('span', campaign.complete ? 'Campaign complete' : 'Campaign incomplete', `badge ${campaign.complete ? '' : 'incomplete'}`)); card.append(header);
    note(card, `${campaign.kind === 'arrivals' ? 'Scheduled arrivals · p95 includes queue delay and failed requests' : 'Closed loop · p95 includes successful requests only'} · ${when(campaign.finishedAt)}`);
    const pending = campaign.pendingEvidence;
    if (!campaign.complete) {
      if (pending?.status === 'verified') {
        note(card, `Campaign-wide raw log: ${fmt(campaign.timed?.requests)} timed requests, ${fmt(campaign.timed?.errors)} errors, ${fmt(campaign.timed?.strictFailures)} strict failures. These totals do not change with the filters.`, campaign.timed?.strictFailures > 0 ? 'notice danger' : 'notice');
        note(card, `Unfinished work: ${fmt(pending.timed?.requests)} timed requests, including ${fmt(pending.timed?.errors)} errors and ${fmt(pending.timed?.strictFailures)} strict failures, are outside the completed profiles below. They have no final profile latency or viability result.`, pending.timed?.strictFailures > 0 ? 'notice danger' : 'notice');
        if (pending.warmup?.requests) note(card, `Also outside completed checkpoints: ${fmt(pending.warmup.requests)} warmup requests with ${fmt(pending.warmup.strictFailures)} strict failures.`, 'notice');
      } else note(card, 'Pending request evidence is unavailable. Any counts below cover completed profiles only; zero errors there does not mean this campaign had zero errors.', 'notice');
    }
    if (rows.length) card.append(table(['Method', 'Query', 'Filter', 'Load', 'p95 · ms', 'Strict failures', 'Warmup failures', 'Requests', 'Result'], rows.map(row => {
      const name = el('span', names[row.method] ?? row.method); name.title = `${row.method}\n${row.candidateId}`;
      return [name, queryNames[row.queryId] ?? row.queryId ?? '—', row.selectivity ?? '—',
        row.arrivalRate !== null && row.arrivalRate !== undefined ? `${row.arrivalRate}/s` : `C${row.concurrency ?? '?'}`,
        fmt(campaign.kind === 'arrivals' ? row.p95EndToEndMs : row.p95SuccessfulMs), fmt(row.timed?.strictFailures), fmt(row.strictWarmupFailures),
        fmt(row.timed?.requests), el('span', statusNames[row.status], `badge ${row.status}`)];
    })));
    const details = el('details'); details.append(el('summary', 'Index, controls and evidence'));
    for (const index of campaign.indexes) note(details, `${index.index} · ${fmt(index.count)} records · ${index.scope} · ${fmt(index.utilityCount)} precomputed utilities · ${Number.isFinite(index.primaryStoreBytes) ? (index.primaryStoreBytes / 1e9).toFixed(2) + ' GB primary store' : 'store unrecorded'}`);
    const controls = [...new Set(rows.map(row => JSON.stringify(row.parameters)))]; for (const controlsText of controls) details.append(el('p', controlsText, 'subtle'));
    note(details, `Artifact SHA-256: ${campaign.artifactSha256 ?? 'unrecorded'}`);
    if (pending?.status === 'verified') {
      note(details, `Independent audit SHA-256: ${pending.audit.sha256}`);
      note(details, `Raw request log SHA-256 at inventory: ${pending.rawRequests.sha256}`);
      note(details, pending.evidenceBoundary);
    }
    if (campaign.skipped.length) note(details, `${campaign.skipped.length} skipped entries. Skipped measurements are not passes.`);
    if (campaign.interruption) note(details, `Interrupted: ${campaign.interruption}`);
    card.append(details); container.append(card);
  }
  if (!shown && selected !== 'real-545') container.append(el('p', cohort.campaigns.length ? 'No measured rows match these filters.' : 'No query performance measurements in this snapshot. Index progress below is separate from query performance.', 'empty'));
  renderFeedback(selected === 'real-545');
  const builds = $('#build-details'); builds.replaceChildren(); $('#builds').hidden = !cohort.indexes.length;
  for (const index of cohort.indexes) {
    const item = el('div', undefined, 'build'); item.append(el('h3', index.index ?? index.artifact));
    note(item, `${index.complete ? 'Completed build' : index.failure ? 'Build stopped' : 'Incomplete build'} · ${fmt(index.indexedCount ?? index.count)} / ${fmt(index.requestedCount ?? index.count)} records at snapshot · ${fmt(index.utilityCount)} utilities`);
    if (Number.isFinite(index.primaryStoreBytes)) note(item, `${(index.primaryStoreBytes / 1e9).toFixed(2)} GB measured primary store`);
    note(item, index.artifact); builds.append(item);
  }
}
function renderFeedback(show) {
  const container = $('#feedback'); container.replaceChildren(); container.hidden = !show; if (!show) return;
  note(container, 'Agreement is averaged per query, with ties receiving half credit. Compare supported cases and judged pairs before comparing percentages. These repeated runs are not independent votes.');
  if (data.fidelity.some(run => run.intendedArithmeticPassed === false)) container.append(el('p', 'Known correctness caveat: duplicate targets that resolve to the same color field have a shared scoring defect in the preserved methods. Matching their baseline does not mean the intended duplicate-target arithmetic is correct.', 'notice'));
  for (const run of [...data.feedback].reverse()) {
    const card = el('section', undefined, 'campaign'); card.append(el('h3', run.label ?? run.runId)); note(card, when(run.createdAt));
    card.append(table(['Method', 'Preference agreement', 'Without uncertain pairs', 'Cases supported / total', 'Pairs assessed / total', 'Unsupported', 'Errors'], run.candidates.map(candidate => [
      names[candidate.method] ?? candidate.method ?? candidate.id, percent(candidate.agreement?.queryMacroAgreement), percent(candidate.withoutUncertain?.queryMacroAgreement),
      `${fmt(candidate.coverage?.ok)} / ${fmt(candidate.coverage?.total)}`, `${fmt(candidate.agreement?.assessedPairs)} / ${fmt(candidate.agreement?.totalPairs)}`,
      fmt(candidate.coverage?.unsupported), fmt(candidate.coverage?.error),
    ]))); note(card, run.artifact); container.append(card);
  }
}
async function load() {
  try {
    const response = await fetch('/api/performance', { cache: 'no-store' }); data = await response.json(); if (!response.ok) throw Error(data.error ?? 'Could not load snapshot.');
    $('#snapshot').textContent = `Snapshot generated ${when(data.generatedAt)} · published ${when(data.publishedAt)}. This page shows a saved checkpoint; refresh after a new checkpoint is published.`;
    for (const cohort of data.cohorts) { const button = el('button', cohort.title); button.type = 'button'; button.dataset.cohort = cohort.id; button.addEventListener('click', () => selectCohort(cohort.id)); $('#cohorts').append(button); }
    for (const text of data.caveats) $('#caveats').append(el('li', text));
    note($('#provenance'), `Source checkpoint: ${data.sourceCheckpoint}`); note($('#provenance'), `Checkpoint SHA-256: ${data.sourceSha256}`); note($('#provenance'), `Published file SHA-256: ${data.summarySha256}`);
    note($('#provenance'), `${data.fidelity.length} fidelity artifacts and ${data.feedback.length} feedback runs recorded. Some historical campaigns and builds failed or remain incomplete; each remains visible in its scope.`);
    for (const warning of data.warnings) note($('#provenance'), `Snapshot warning: ${warning.artifact}: ${warning.error}`);
    for (const select of [$('#method-filter'), $('#query-filter'), $('#load-filter')]) select.addEventListener('change', render);
    $('#results').hidden = false; selectCohort(selected);
  } catch (error) { $('#error').hidden = false; $('#error').textContent = error.message; $('#snapshot').textContent = 'No published results loaded.'; }
}
load();
