#!/usr/bin/env node
/**
 * Which `nuxeo-client` services are missing from `AGENTS/01-services.md`, as an issue body.
 *
 * ## The defect this replaces
 *
 * `staleness-check.yml` did this in bash, and interpolated its own generated text back into a
 * shell body with `${{ steps.check.outputs.missing }}`. The text contains backticks — the list
 * items read `` - `content-model.service.ts` not found in … `` — so bash took them as command
 * substitution and tried to execute `content-model.service.ts`, exiting 127.
 *
 * It failed **seven consecutive weeks**, from 14 September, and filed nothing. Nobody noticed
 * because the issue step runs *only when there is drift to report*: a green run meant "nothing to
 * say", a red run meant "something to say, and it will not be said", and those are the two states
 * a scheduled job is least likely to be watched in.
 *
 * ## Why a script rather than better quoting
 *
 * Escaping the value would have fixed this instance and left the class. There is no shell body
 * holding generated text here at all: this writes the issue body to a **file**, and the workflow
 * passes that file to `gh issue create --body-file`. A service named
 * `` `rm -rf ~`$(id).service.ts `` reaches the issue as those literal characters.
 *
 * ## Usage
 *
 *   node scripts/agents-staleness-report.mjs --out <path>
 *   node scripts/agents-staleness-report.mjs --out <path> --services <dir> --doc <file>
 *
 * `--services` and `--doc` default to the real locations and exist so the controls in
 * `agents-staleness-report.selftest.mjs` can drive it over fixtures, including hostile filenames
 * that must never appear in this repository.
 *
 * Writes `drift_detected=true|false` to `$GITHUB_OUTPUT` when set, and always to stdout. The body
 * file is written only when there is drift.
 *
 * Exit 0 whenever it could read its inputs: this reports, it does not gate. Exit 1 only when the
 * services directory or the document is unreadable, because then "no drift" would be a lie.
 */

import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) args.set(arg.slice(2), process.argv[++i]);
}

const out = args.get('out');
if (!out) {
  console.error('agents-staleness-report: --out <path> is required.');
  process.exit(1);
}
/* Defaults are relative to the repository, overrides to the caller's working directory — an
 * override resolved against the repository root would silently look in the wrong place for
 * anyone running this from anywhere else, which `--out` already does not do. */
const DEFAULT_SERVICES = 'libs/shared/nuxeo-client/src/lib/services';
const DEFAULT_DOC = 'AGENTS/01-services.md';
const servicesDir = args.has('services')
  ? resolve(args.get('services'))
  : resolve(repoRoot, DEFAULT_SERVICES);
const docPath = args.has('doc') ? resolve(args.get('doc')) : resolve(repoRoot, DEFAULT_DOC);

let entries;
let doc;
try {
  entries = readdirSync(servicesDir);
  doc = readFileSync(docPath, 'utf8');
} catch (error) {
  console.error(
    `agents-staleness-report: cannot read ${servicesDir} or ${docPath} — ${error.message}.\n` +
      '  Reporting "no drift" from inputs it could not read is the failure mode worth avoiding.',
  );
  process.exit(1);
}

/**
 * The service basename, as the bash version derived it: `basename "$file" .service.ts`.
 *
 * `*.spec*` is skipped for the same reason it was there — `browse.service.spec.ts` and
 * `browse.service.export.spec.ts` are tests of a service, not services.
 */
const services = entries
  .filter((name) => name.endsWith('.service.ts'))
  .map((name) => name.slice(0, -'.service.ts'.length))
  .filter((name) => !name.includes('.spec'))
  .sort();

/** Case-insensitive substring, matching the `grep -qi` the bash version used. */
const lowerDoc = doc.toLowerCase();
const missing = services.filter((name) => !lowerDoc.includes(name.toLowerCase()));

const driftDetected = missing.length > 0;

if (driftDetected) {
  writeFileSync(
    out,
    [
      '## AGENTS.md Staleness Report',
      '',
      'The following service files exist in the codebase but are not documented in',
      '`AGENTS/01-services.md`:',
      '',
      ...missing.map((name) => `- \`${name}.service.ts\` not found in AGENTS/01-services.md`),
      '',
      '### What to do',
      '',
      '1. Open `AGENTS/01-services.md`',
      '2. Add a section for each missing service with its public method signatures',
      '3. Commit: `docs: update AGENTS/01-services.md with new services`',
      '',
      '---',
      '',
      '*Generated automatically by the AGENTS.md Staleness Agent (staleness-check.yml), through',
      '`scripts/agents-staleness-report.mjs`.*',
      '',
    ].join('\n'),
    'utf8',
  );
}

const line = `drift_detected=${driftDetected}`;
if (process.env['GITHUB_OUTPUT']) appendFileSync(process.env['GITHUB_OUTPUT'], `${line}\n`, 'utf8');
console.log(line);
console.log(
  driftDetected
    ? `${missing.length} of ${services.length} service(s) undocumented: ${missing.join(', ')}\n` +
        `issue body written to ${out}`
    : `all ${services.length} service(s) appear in ${args.get('doc') ?? DEFAULT_DOC}`,
);
