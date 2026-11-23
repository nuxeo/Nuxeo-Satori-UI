import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const languages = ['ar', 'he', 'it', 'sv'];
const destination = 'crowdin-readiness';
mkdirSync(destination, { recursive: true });
function flatten(value, prefix = '', result = {}) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) flatten(entry, path, result);
    else result[path] = entry;
  }
  return result;
}
const english = flatten(JSON.parse(readFileSync('apps/nuxeo-ui/public/i18n/en.json', 'utf8')));
const placeholders = (value) =>
  [...String(value).matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((m) => m[1].trim()).sort();
const report = {
  generatedAt: new Date().toISOString(),
  sourceKeys: Object.keys(english).length,
  exportOnlyApprovedRequested: true,
  languages: [],
};
let progress = [];
try {
  const projectId = process.env.CROWDIN_PROJECT_ID;
  const token = process.env.CROWDIN_PERSONAL_TOKEN;
  if (!projectId || !token) throw new Error('Crowdin credentials are unavailable');
  const response = await fetch(
    `https://hyland.api.crowdin.com/api/v2/projects/${encodeURIComponent(projectId)}/languages/progress?limit=500`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error(`Crowdin progress API returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error('Unexpected progress API response');
  progress = payload.data
    .map((entry) => entry.data)
    .filter((entry) => languages.includes(entry.languageId));
  writeFileSync(`${destination}/approval-progress.json`, JSON.stringify(progress, null, 2));
} catch (error) {
  report.progressError = error.message;
}
for (const language of languages) {
  const result = {
    language,
    progress: progress.find((entry) => entry.languageId === language) ?? null,
    errors: [],
  };
  const file = `apps/nuxeo-ui/public/i18n/${language}.json`;
  if (!existsSync(file)) {
    result.errors.push({ issue: 'Export file missing' });
  } else {
    try {
      const raw = readFileSync(file, 'utf8');
      writeFileSync(`${destination}/${language}.json`, raw);
      const entries = flatten(JSON.parse(raw));
      result.exportKeys = Object.keys(entries).length;
      result.missingKeys = Object.keys(english).filter((key) => !(key in entries));
      result.extraKeys = Object.keys(entries).filter((key) => !(key in english));
      result.differentFromEnglish = Object.keys(english).filter(
        (key) => key in entries && entries[key] !== english[key],
      ).length;
      result.sameAsEnglish = Object.keys(english).filter(
        (key) => key in entries && entries[key] === english[key],
      ).length;
      if (result.extraKeys.length)
        result.errors.push({ issue: 'Keys absent from English source', keys: result.extraKeys });
      if (result.differentFromEnglish === 0)
        result.errors.push({ issue: 'Catalogue contains no non-English values' });
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value !== 'string' || !value.trim()) {
          result.errors.push({ key, issue: 'Empty or non-string translation' });
          continue;
        }
        if (
          key in english &&
          JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(english[key]))
        )
          result.errors.push({ key, issue: 'Interpolation placeholders differ from English' });
        if (/&(?:[a-zA-Z]+|#\d+);/.test(value))
          result.errors.push({ key, issue: 'HTML character reference would render literally' });
        if (/\(s\)/.test(value))
          result.errors.push({ key, issue: 'Unsupported parenthesized plural suffix' });
        if (/\\u(?:\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4})/.test(value))
          result.errors.push({ key, issue: 'Undecoded Unicode escape' });
      }
    } catch (error) {
      result.errors.push({ issue: `Invalid catalogue: ${error.message}` });
    }
  }
  result.exportChecksPassed = result.errors.length === 0;
  report.languages.push(result);
}
report.approvalStatusVerified =
  !report.progressError && report.languages.every((entry) => entry.progress);
report.exportChecksPassed = report.languages.every((entry) => entry.exportChecksPassed);
writeFileSync(`${destination}/report.json`, JSON.stringify(report, null, 2));
const lines = [
  '# NXSAT-754 Crowdin readiness',
  '',
  `English source: ${report.sourceKeys} keys. Export requested with the existing approved-only configuration.`,
  '',
  '| Language | Translated % (Crowdin) | Approved % (Crowdin) | Export keys | Different from English | Same as English | Missing keys | Validation errors |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...report.languages.map(
    (entry) =>
      `| ${entry.language} | ${entry.progress?.translationProgress ?? 'unavailable'} | ${entry.progress?.approvalProgress ?? 'unavailable'} | ${entry.exportKeys ?? 0} | ${entry.differentFromEnglish ?? 0} | ${entry.sameAsEnglish ?? 0} | ${entry.missingKeys?.length ?? 'unknown'} | ${entry.errors.length} |`,
  ),
  '',
  'Matching English text does not prove a missing approval: product names and some terms legitimately match. Crowdin progress figures above are project-level; the downloaded JSON is validated against this checkout’s application source.',
  '',
  'Passing these checks supports integration review; it does not enable a language or replace linguistic, RTL, date-adapter or full application testing.',
  '',
];
if (report.progressError)
  lines.push(`Approval verification unavailable: ${report.progressError}`, '');
for (const entry of report.languages) {
  if (entry.errors.length) {
    lines.push(`## ${entry.language}: validation findings`, '');
    for (const error of entry.errors)
      lines.push(`- ${error.key ? `${error.key}: ` : ''}${error.issue}`);
    lines.push('');
  }
}
const markdown = lines.join('\n');
writeFileSync(`${destination}/REPORT.md`, markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
if (!report.exportChecksPassed || !report.approvalStatusVerified) process.exitCode = 1;
