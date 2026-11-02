/** Browser rendering uses text nodes for external prose and fixed-origin issue links. */
export const planPresentation = `
function appendIssues(output, label, issues) {
  output.append(document.createTextNode(label + ': '));
  if (!issues.length) output.append(document.createTextNode('None'));
  issues.forEach((number, index) => {
    if (index) output.append(document.createTextNode(', '));
    const link = document.createElement('a');
    link.href = 'https://github.com/rafaeltab/wallpaperdb/issues/' + encodeURIComponent(number);
    link.textContent = '#' + number;
    output.append(link);
  });
  output.append(document.createTextNode('\\n'));
}
function renderPlan(output, result) {
  output.replaceChildren(document.createTextNode((result.kind === 'stale'
    ? 'Stale proposal. Generate a fresh preview.' : 'Validated advisory proposal') + '\\n\\nIssue context\\n'));
  for (const issue of result.input.issues) {
    appendIssues(output, 'Issue', [issue.number]);
    output.append(document.createTextNode(issue.title + '\\n'));
    appendIssues(output, 'Explicit prerequisites', issue.blockers);
    appendIssues(output, 'Parent specs', issue.parents);
    if (issue.recovery) {
      const recovery = issue.recovery;
      output.append(document.createTextNode('Conflict recovery: ' + (recovery.classification || 'Unclassified') + ': ' + recovery.progress + '\\n'));
      if (recovery.question) output.append(document.createTextNode('Question: ' + recovery.question + '\\n'));
      if (recovery.threadId) {
        const link = document.createElement('a');
        link.href = 't3-thread://v1/' + encodeURIComponent(recovery.threadId);
        link.textContent = 'Open recovery thread';
        output.append(link, document.createTextNode('\\n'));
      }
    }
  }
  output.append(document.createTextNode('\\nProposed\\n'));
  for (const selection of result.selected) {
    output.append(document.createTextNode('#' + selection.issue + ': ' + selection.reason + '\\n'));
    appendIssues(output, 'Proposed dependencies', selection.dependsOn);
    appendIssues(output, 'Proposed conflicts', selection.conflicts);
  }
  output.append(document.createTextNode('\\nRejected or blocked\\n' +
    (result.rejected.map(item => '#' + item.issue + ': ' + item.reason).join('\\n') || 'None') +
    '\\n\\nNo work was dispatched.'));
}
`;
