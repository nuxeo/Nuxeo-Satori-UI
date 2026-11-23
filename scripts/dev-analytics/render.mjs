/**
 * Renders a snapshot as (a) one self-contained HTML page and (b) Markdown for the Actions job
 * summary. Both are built server-side from the snapshot: no client script, no CDN, no fetch, so
 * the file works from an artifact download and nothing in it can execute. Every interpolated
 * value goes through `esc`.
 */

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Escapes text for a Markdown table cell or list item. The backslash goes FIRST: escaping `|` as
 * `\|` and leaving backslashes alone lets a value ending in `\` turn the escape into an escaped
 * backslash, freeing the pipe. Job names and error messages come from the API, so treat them as input.
 */
export const mdCell = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/[|`<>*_[\]]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, ' ');

const NO = 'no data';
const num = (v, suffix = '') => (v == null ? NO : `${Number.isInteger(v) ? v : v.toFixed(1)}${suffix}`);
const hours = (v) => (v == null ? NO : v >= 48 ? `${(v / 24).toFixed(1)} d` : `${v.toFixed(1)} h`);

/** Inline SVG trend line. Needs two points to draw; otherwise says so rather than drawing a dot. */
function spark(points, { w = 140, h = 34 } = {}) {
  const ys = points.filter((p) => p != null);
  if (ys.length < 2) return '<span class="muted">needs 2+ snapshots</span>';
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => (p == null ? null : `${(i * step).toFixed(1)},${(h - 4 - ((p - min) / span) * (h - 8)).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="trend over ${points.length} snapshots, from ${esc(ys[0])} to ${esc(ys.at(-1))}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${d}"/></svg>`;
}

function bars(rows, { max = 100, unit = '%' } = {}) {
  return rows.map(({ label, value, note }) => {
    // A true zero draws no bar; only a non-zero value gets the 2% minimum so it stays visible.
    const width = value == null || value === 0 ? 0 : Math.max(2, Math.min(100, (value / max) * 100));
    return `<div class="bar"><span class="bl" title="${esc(label)}">${esc(label)}</span><span class="bt"><i style="width:${width.toFixed(1)}%"></i></span><span class="bv">${value == null ? NO : esc(num(value, unit))}${note ? ` <small>${esc(note)}</small>` : ''}</span></div>`;
  }).join('');
}

function card(title, value, sub, trend) {
  return `<div class="card"><h3>${esc(title)}</h3><div class="big">${esc(value)}</div><div class="sub">${esc(sub ?? '')}</div>${trend ?? ''}</div>`;
}

const table = (head, rows) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const series = (s, key) => (s.history ?? []).map((h) => h[key]);

export function renderDashboard(s) {
  const prs = s.prs;
  const ci = s.ci;
  const unit = s.unit;
  const cov = s.coverage;
  const e2e = s.e2e;

  const sections = [];

  sections.push(`<section><h2>Delivery and review</h2><div class="grid">
    ${card('Merged PRs', prs ? String(prs.merged) : NO, `last ${s.windowDays} days → ${s.defaultBranch ?? 'default branch'}`)}
    ${card('Lead time (median)', hours(prs?.leadHours?.median), `p90 ${hours(prs?.leadHours?.p90)} · first commit → merge`, spark(series(s, 'prLeadMedianHours')))}
    ${card('PR size (median)', prs ? num(prs.size.median, ' lines') : NO, `p90 ${num(prs?.size?.p90, ' lines')}`, spark(series(s, 'prSizeMedian')))}
    ${card('Merged without review', num(prs?.mergedWithoutReviewPct, '%'), 'no review by someone other than the author')}
  </div>
  ${prs ? `<h3>Where the time goes (median · p90)</h3>${table(['Stage', 'Median', 'p90'], [
    ['Open → first review', hours(prs.toFirstReviewHours.median), hours(prs.toFirstReviewHours.p90)],
    ['First review → approval', hours(prs.reviewToApprovalHours.median), hours(prs.reviewToApprovalHours.p90)],
    ['Approval → merge', hours(prs.approvalToMergeHours.median), hours(prs.approvalToMergeHours.p90)],
  ])}
  <p class="muted">Changes-requested rounds per PR: ${esc(num(prs.changesRequestedPerPr))} · Linked to a Jira key: ${esc(num(prs.jiraLinkedPct, '%'))} · AI-assisted (PR body carries the Claude Code line — a heuristic, undercounts): ${esc(num(prs.aiAssistedPct, '%'))}</p>
  <h3>Slowest merged PRs</h3>${table(['PR', 'Lead time', 'Lines changed'], prs.slowest.map((p) => [`#${p.number}`, hours(p.leadHours), String(p.size)]))}` : ''}
  </section>`);

  sections.push(`<section><h2>CI health${ci ? ` <small>(${esc(ci.runs)} runs of ci.yml)</small>` : ''}</h2><div class="grid">
    ${card('Pass rate', num(ci?.passRatePct, '%'), 'all attempts')}
    ${card('First-attempt pass rate', num(ci?.firstAttemptPassRatePct, '%'), `${ci ? ci.passedOnRerun : '–'} runs went green only on a rerun`, spark(series(s, 'ciFirstAttemptPassRate')))}
    ${card('Duration (median)', ci?.durationMinutes?.median == null ? NO : `${ci.durationMinutes.median} min`, `p90 ${num(ci?.durationMinutes?.p90, ' min')} · upper bound, includes waits`)}
  </div>
  ${ci?.jobs?.length ? `<h3>Failure rate by job (latest ${esc(ci.jobSampleRuns)} runs)</h3>${bars(ci.jobs.slice(0, 10).map((j) => ({ label: j.name, value: j.failureRatePct, note: `${j.failures}/${j.runs}` })))}` : ''}
  </section>`);

  sections.push(`<section><h2>Unit tests</h2><div class="grid">
    ${card('Declared tests', unit ? String(unit.declared) : NO, `${unit?.files ?? '–'} spec files · static count`, spark(series(s, 'unitTestsDeclared')))}
    ${card('Skipped / todo', unit ? String(unit.skipped) : NO, 'a floor: describe.skip counts once', spark(series(s, 'unitTestsSkipped')))}
    ${card('Expects per test', unit ? num(unit.expectsPerTest) : NO, `${unit?.withoutAssertions ?? '–'} spec files declare tests but never call expect()`)}
    ${card('Line coverage', num(cov?.overall?.lines, '%'), `branches ${num(cov?.overall?.branches, '%')} · functions ${num(cov?.overall?.functions, '%')}`, spark(series(s, 'coverageLines')))}
  </div>
  ${unit ? `<h3>Tests per project (top 12)</h3>${table(['Project', 'Declared', 'Skipped', 'expect() / test'], unit.projects.slice(0, 12).map((p) => [p.project, String(p.declared), String(p.skipped), p.declared ? (p.expects / p.declared).toFixed(2) : '–']))}` : ''}
  ${cov ? `<h3>Lowest line coverage by project (≥ 50 lines)</h3>${bars(cov.projects.filter((p) => p.linesFound >= 50).slice(0, 12).map((p) => ({ label: p.project, value: p.lines, note: `${p.linesFound} lines` })))}` : ''}
  </section>`);

  sections.push(`<section><h2>End-to-end (Playwright)</h2><div class="grid">
    ${card('Scenarios', e2e ? String(e2e.total) : NO, e2e ? `${e2e.passed} passed · ${e2e.failed} failed · ${e2e.skipped} skipped` : 'no recent e2e-nightly artifact', spark(series(s, 'e2eTotal')))}
    ${card('First-attempt pass rate', num(e2e?.firstAttemptPassRatePct, '%'), 'passed without a retry, of those that ran', spark(series(s, 'e2ePassRate')))}
    ${card('Flaky (passed on retry)', e2e ? String(e2e.flaky) : NO, 'the gap between pass-after-retry and first attempt', spark(series(s, 'e2eFlaky')))}
    ${card('Duration', e2e?.durationMinutes == null ? NO : `${e2e.durationMinutes} min`, 'slowest browser job')}
  </div>
  ${e2e ? `${table(['Project', 'Total', 'Passed', 'Failed', 'Flaky', 'Skipped'], e2e.projects.map((p) => [p.project, p.total, p.passed, p.failed, p.flaky, p.skipped].map(String)))}
  ${e2e.flakyTests.length ? `<h3>Flaky tests</h3>${table(['Test', 'Project', 'Retries'], e2e.flakyTests.slice(0, 15).map((t) => [t.title, t.project, String(t.retries)]))}` : ''}` : ''}
  </section>`);

  if (s.gaps.length) sections.push(`<section class="gaps"><h2>Not measured this run</h2><ul>${s.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></section>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Dev analytics — ${esc(s.repo ?? 'repository')}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1f24;--mut:#667085;--line:#e4e7ec;--card:#f7f8fa;--acc:#2f6fed}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e8eb;--mut:#98a2b3;--line:#2a2f37;--card:#1b1f26;--acc:#6b9bff}}
body{font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px;max-width:1100px;margin-inline:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{font-size:13px;margin:18px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
small,.muted,.sub{color:var(--mut)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}.card h3{margin:0 0 4px}.big{font-size:26px;font-weight:600}.sub{font-size:12px;min-height:18px}
.spark{color:var(--acc);display:block;margin-top:6px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line)}
.bar{display:grid;grid-template-columns:minmax(120px,260px) 1fr 140px;gap:10px;align-items:center;margin:3px 0}.bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bt{background:var(--line);border-radius:4px;height:10px;display:block}.bt i{display:block;height:10px;border-radius:4px;background:var(--acc)}.bv{text-align:right}
.gaps{border-left:3px solid var(--mut);padding-left:12px}
</style></head><body>
<h1>Dev analytics</h1>
<div class="muted">${esc(s.repo ?? 'repository')} · generated ${esc(s.generatedAt)} · window ${esc(s.windowDays)} days · ${esc((s.history ?? []).length)} snapshot(s) of history</div>
${sections.join('\n')}
<p class="muted">Test counts are static declarations, not executions. Medians and p90 use nearest rank. A section with “no data” was not measured — see the list above, never read it as zero.</p>
</body></html>`;
}

export function renderSummary(s) {
  const L = [];
  const row = (...c) => `| ${c.join(' | ')} |`;
  L.push(`## Dev analytics — ${mdCell(s.repo ?? 'repository')}`, '', `Window: last ${s.windowDays} days · generated ${s.generatedAt}`, '');
  if (s.prs) {
    L.push('### Delivery and review', '', row('Metric', 'Median', 'p90'), row('---', '---', '---'),
      row('Lead time (first commit → merge)', hours(s.prs.leadHours.median), hours(s.prs.leadHours.p90)),
      row('Open → first review', hours(s.prs.toFirstReviewHours.median), hours(s.prs.toFirstReviewHours.p90)),
      row('First review → approval', hours(s.prs.reviewToApprovalHours.median), hours(s.prs.reviewToApprovalHours.p90)),
      row('Approval → merge', hours(s.prs.approvalToMergeHours.median), hours(s.prs.approvalToMergeHours.p90)),
      row('PR size (lines)', num(s.prs.size.median), num(s.prs.size.p90)), '',
      `${s.prs.merged} PRs merged · ${num(s.prs.mergedWithoutReviewPct, '%')} without review · ${num(s.prs.jiraLinkedPct, '%')} Jira-linked`, '');
  }
  if (s.ci) {
    L.push('### CI', '', `${s.ci.runs} runs · pass ${num(s.ci.passRatePct, '%')} · first attempt ${num(s.ci.firstAttemptPassRatePct, '%')} · ${s.ci.passedOnRerun} green only on rerun`, '');
    if (s.ci.jobs.length) L.push(row('Job', 'Failures', 'Rate'), row('---', '---', '---'), ...s.ci.jobs.slice(0, 8).map((j) => row(mdCell(j.name), `${j.failures}/${j.runs}`, num(j.failureRatePct, '%'))), '');
  }
  if (s.unit) L.push('### Unit tests', '', `${s.unit.declared} declared (${s.unit.skipped} skipped) across ${s.unit.files} spec files · ${num(s.unit.expectsPerTest)} expects/test · ${s.unit.withoutAssertions} files with tests but no expect()`, '');
  if (s.coverage) L.push('### Coverage', '', `Lines ${num(s.coverage.overall.lines, '%')} · branches ${num(s.coverage.overall.branches, '%')} · functions ${num(s.coverage.overall.functions, '%')}`, '');
  if (s.e2e) L.push('### E2E', '', `${s.e2e.total} scenarios · ${s.e2e.passed} passed · ${s.e2e.failed} failed · ${s.e2e.flaky} flaky · first-attempt ${num(s.e2e.firstAttemptPassRatePct, '%')}`, '');
  if (s.gaps.length) L.push('### Not measured this run', '', ...s.gaps.map((g) => `- ${mdCell(g)}`), '');
  return L.join('\n');
}
