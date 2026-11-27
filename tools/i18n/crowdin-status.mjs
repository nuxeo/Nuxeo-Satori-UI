/**
 * Read-only report on what Crowdin actually holds.
 *
 * ## Why this exists
 *
 * The question "is anything translated yet?" could only be answered three ways, and all three
 * were bad. Log into the Crowdin portal, which needs project membership nobody on the team had.
 * Read the token out of GitHub secrets, which the API will not return. Or run the pull and read
 * the pull request it opens — which is how the first destructive sync was discovered, and is a
 * poor way to ask a question, because asking it changes the repository.
 *
 * So this asks over the API and writes nothing. No mutation, ever: if a future edit needs a
 * `POST`, `PATCH` or `DELETE`, it belongs in a different file, because the whole value of this one
 * is that it is safe to run at any time without thinking about consequences.
 *
 * ## What it reports and why that column
 *
 * **Approved**, not translated, is the number that decides what reaches the application.
 * `export_only_approved: 'true'` in `crowdin-conf.yml` means an unapproved translation is never
 * exported, so a language at 100% translated and 0% approved pulls back exactly nothing. Reading
 * the translated column alone would predict a working locale and be wrong about every string in
 * it. Both are printed, approved first.
 *
 * Then what has reached the repository (`coverage.mjs`, also `npm run i18n:coverage` on its own):
 * a language approved on Crowdin and absent here is waiting for a pull, and what is here is what
 * the app and the kits show. Read from the checkout, so it needs no credential.
 */

import { fileURLToPath } from 'node:url';

import { formatCoverage, measureCoverage } from './coverage.mjs';

const API = `${process.env['CROWDIN_BASE_URL'] ?? 'https://hyland.api.crowdin.com'}/api/v2`;

async function crowdin(path, token) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    // The status code narrows the diagnosis and is worth saying out loud, because these failures
    // look identical from the outside and have different fixes.
    //
    // It NARROWS rather than decides, which an earlier version of this got wrong: it reported a
    // 404 as "a project-membership grant", and a 404 says nothing of the kind — a wrong
    // `CROWDIN_PROJECT_ID`, or a project that has been deleted, produce exactly the same
    // response. Naming one cause out of three sends the reader to the wrong fix with more
    // confidence than no hint at all would have.
    const hint =
      response.status === 401
        ? ' — 401 means the token is not valid for this tenant. The Crowdin setup token and the ' +
          'CI token are different credentials; only the CI one works here.'
        : response.status === 403 || response.status === 404
          ? ` — ${response.status} means project ${process.env['CROWDIN_PROJECT_ID']} is not ` +
            'available to this token, which has three possible causes and does not distinguish ' +
            'them: the project id is wrong, the project no longer exists, or the token ' +
            'authenticates against the tenant but has no membership of this project. Check the ' +
            'id first, since it is the cheapest to rule out.'
          : '';
    throw new Error(`GET ${path} → ${response.status}${hint}\n${await response.text()}`);
  }
  return response.json();
}

/**
 * The report body, given the API's language-progress rows. Pure, so it can be asserted without a
 * tenant — and separated because the risk here is not fetching, it is a reader taking a row of
 * zeroes as good news.
 */
export function formatProgress(rows) {
  if (rows.length === 0) return 'No target languages. Nothing can be translated.';

  const width = Math.max(8, ...rows.map((row) => row.languageId.length));
  const lines = rows
    .slice()
    .sort(
      (a, b) => b.approvalProgress - a.approvalProgress || a.languageId.localeCompare(b.languageId),
    )
    .map(
      (row) =>
        `  ${row.languageId.padEnd(width)}  approved ${String(row.approvalProgress).padStart(3)}%` +
        `   translated ${String(row.translationProgress).padStart(3)}%`,
    );

  const exportable = rows.filter((row) => row.approvalProgress > 0);
  const summary = exportable.length
    ? `${exportable.length} of ${rows.length} language(s) have approved translations to export: ` +
      `${exportable.map((row) => row.languageId).join(', ')}.`
    : `NONE of the ${rows.length} target languages has an approved translation, so a pull would ` +
      'bring back nothing and every locale renders English through the fallback. Approved is the ' +
      'column that matters: `export_only_approved` means unapproved work is never exported.';

  return `${lines.join('\n')}\n\n${summary}`;
}

/**
 * The whole report: the project, its languages' progress, then the repository's coverage of the
 * checkout at `root`. Pure but for reading `root`, so the controls can assert both halves are in it.
 */
export function formatReport({ projectId, project, rows, sourceFiles, root }) {
  return (
    `Crowdin project ${projectId} — ${project.name}\n` +
    `  source language  ${project.sourceLanguageId}\n` +
    `  target languages ${rows.length}\n` +
    `  source files     ${sourceFiles.length}${sourceFiles.length ? `: ${sourceFiles.join(', ')}` : ''}\n\n` +
    formatProgress(rows) +
    `\n\n${formatCoverage(measureCoverage(root))}`
  );
}

async function main() {
  const projectId = process.env['CROWDIN_PROJECT_ID'];
  const token = process.env['CROWDIN_PERSONAL_TOKEN'];
  if (!projectId || !token) {
    console.error('CROWDIN_PROJECT_ID and CROWDIN_PERSONAL_TOKEN must both be set.');
    process.exit(1);
  }

  const { data: project } = await crowdin(`/projects/${projectId}`, token);
  const progress = await crowdin(`/projects/${projectId}/languages/progress?limit=500`, token);
  const rows = progress.data.map(({ data }) => ({
    languageId: data.languageId,
    approvalProgress: data.approvalProgress,
    translationProgress: data.translationProgress,
  }));

  const files = await crowdin(`/projects/${projectId}/files?limit=500`, token);

  const report = formatReport({
    projectId,
    project,
    rows,
    sourceFiles: files.data.map(({ data }) => data.path),
    root: fileURLToPath(new URL('../..', import.meta.url)),
  });

  console.log(report);

  // Also to the job summary, so the answer is on the run page rather than inside a log nobody
  // opens twice.
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(summaryFile, `## Crowdin status\n\n\`\`\`\n${report}\n\`\`\`\n`);
  }

  // An empty project is not a healthy answer to "what is in Crowdin", so this exits non-zero
  // rather than printing a tidy report of nothing. It says WHAT is empty and leaves the cause
  // open: zero source files could be a push that never ran, a push that ran against a different
  // project, or a file deleted in Crowdin, and the report cannot tell those apart. Naming one
  // would be guessing in the voice of a diagnosis.
  if (rows.length === 0 || files.data.length === 0) {
    console.error(
      `\nProject ${projectId} has ${rows.length} target language(s) and ${files.data.length} ` +
        'source file(s). Zero of either means there is nothing to report ON, which is a finding ' +
        'rather than a clean bill of health — a green job here would be read as confirming the ' +
        'sync works. Start from whether the push has ever succeeded against THIS project id.',
    );
    process.exit(1);
  }
}

// Importable for tests without performing any network call. Same comparison as
// `crowdin-push-context.mjs`: an exact path match, not a suffix test, which would also fire for
// any other file whose name happens to end the same way.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
