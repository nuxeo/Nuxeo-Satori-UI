#!/usr/bin/env node
/**
 * Controls for `agents-staleness-report.mjs` and for the workflow that calls it.
 *
 * `staleness-check.yml` failed every week for seven weeks and filed nothing, and nothing in this
 * repository was in a position to notice: a scheduled workflow is observed by whoever opens the
 * Actions tab, and its only output was an issue it could not create. These controls are the
 * substitute for that observation.
 *
 * Two of them are negative in the strict sense — they run the **old** interpolated shell with the
 * same hostile value and require it to misbehave. Without them the rest would pass against an
 * implementation that had never been broken, and would not distinguish "the injection is closed"
 * from "the fixture is harmless".
 *
 * Usage:  node scripts/agents-staleness-report.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;
const repoRoot = resolve(here, '..');
const script = join(here, 'agents-staleness-report.mjs');
const WORKFLOW = join(repoRoot, '.github/workflows/staleness-check.yml');

/**
 * Whether the filesystem can hold the filenames two of these controls need.
 *
 * `>` and a newline are illegal in a Win32 filename, which is a property of the filesystem and
 * not of the thing under test. Backticks, `$(…)` and `;` **are** legal there, so the main hostile
 * name below is portable and only the redirection and the newline cases are POSIX-only.
 *
 * Reported as SKIPPED, not quietly omitted. "9 of 9 green" on a platform where two could not run
 * would misreport the coverage, which is the class of defect this whole change is about.
 */
const POSIX_FILENAMES = process.platform !== 'win32';

const controls = [];
function control(name, fn, { needs = true, why = '' } = {}) {
  if (!needs) {
    controls.push({ name, skipped: true, why });
    return;
  }
  try {
    fn();
    controls.push({ name, ok: true });
  } catch (error) {
    controls.push({ name, ok: false, why: error.message });
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const workspace = mkdtempSync(join(tmpdir(), 'staleness-selftest-'));

/**
 * A service basename carrying the metacharacters the old shell body acted on: backticks,
 * `$(…)` and a statement separator. The real list items are backticked, which is the half that
 * actually fired in production, and every one of these is a legal filename on both platforms.
 *
 * The canary is a bare name, not a path: a filename cannot contain `/`, and the point is that
 * this really is a name a file can have. Everything that could execute it is spawned with its
 * working directory in `workspace`, so a canary lands there and never in the repository.
 */
const CANARY_NAME = 'canary-pwned';
const CANARY = join(workspace, CANARY_NAME);
const HOSTILE = '`id`$(touch ' + CANARY_NAME + ');content-model';
/** The same, plus a redirection — illegal in a Win32 filename, so POSIX-only. */
const HOSTILE_REDIRECT = HOSTILE + ';echo pwned>' + CANARY_NAME;

/** A fixture services directory and document, returned as the flags the script takes. */
function fixture(serviceNames, docText) {
  const dir = mkdtempSync(join(workspace, 'fx-'));
  const services = join(dir, 'services');
  mkdirSync(services);
  for (const name of serviceNames) writeFileSync(join(services, `${name}.service.ts`), '', 'utf8');
  const doc = join(dir, '01-services.md');
  writeFileSync(doc, docText, 'utf8');
  return { services, doc, out: join(dir, 'issue-body.md') };
}

function run({ services, doc, out }) {
  const proc = spawnSync(
    process.execPath,
    [script, '--out', out, '--services', services, '--doc', doc],
    /* `workspace`, not the repository: if a metacharacter in a fixture name were ever executed,
     * whatever it wrote has to land in a directory this script deletes. */
    { cwd: workspace, encoding: 'utf8' },
  );
  return { ...proc, output: `${proc.stdout ?? ''}${proc.stderr ?? ''}`, out };
}

control('a hostile service name reaches the issue body as literal text, and runs nothing', () => {
  rmSync(CANARY, { force: true });
  const fx = fixture([HOSTILE, 'content-model'], '# nothing documented here\n');
  const proc = run(fx);
  expect(proc.status === 0, `exited ${proc.status}: ${proc.output.trim().slice(0, 300)}`);
  expect(
    !existsSync(CANARY),
    `${CANARY} exists, so the metacharacters in the service name were executed`,
  );
  const body = readFileSync(fx.out, 'utf8');
  expect(
    body.includes(`\`${HOSTILE}.service.ts\` not found`),
    `the body does not carry the name verbatim:\n${body}`,
  );
  expect(/not found in AGENTS\/01-services\.md/.test(body), 'the body lost its sentence');
});

control(
  'a hostile name with a redirection too reaches the body intact, and writes no file',
  () => {
    /* The redirection is the half that would have *created* something rather than just run `id`,
     * so it is worth driving where the filesystem allows it. */
    rmSync(CANARY, { force: true });
    const fx = fixture([HOSTILE_REDIRECT], '# nothing documented here\n');
    const proc = run(fx);
    expect(proc.status === 0, `exited ${proc.status}: ${proc.output.trim().slice(0, 300)}`);
    expect(!existsSync(CANARY), `${CANARY} exists, so the redirection was executed`);
    expect(
      readFileSync(fx.out, 'utf8').includes(`\`${HOSTILE_REDIRECT}.service.ts\` not found`),
      'the body does not carry the name verbatim',
    );
  },
  { needs: POSIX_FILENAMES, why: 'a Win32 filename cannot contain `>`' },
);

control(
  'a name containing a newline cannot split the body into extra list items',
  () => {
    /* A filename can hold a newline on Linux, and the old implementation accumulated the list in a
     * shell variable with `$'\n'` separators, so one could not be told from a genuine item. The
     * body is assembled from an array here, so the item count is decided by the service count. */
    const fx = fixture(['a\nb- `injected.service.ts` not found in AGENTS', 'plain'], '# empty\n');
    const proc = run(fx);
    expect(proc.status === 0, `exited ${proc.status}`);
    const items = readFileSync(fx.out, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('- `'));
    expect(items.length === 2, `${items.length} list items for 2 services:\n${items.join('\n')}`);
  },
  { needs: POSIX_FILENAMES, why: 'a Win32 filename cannot contain a newline' },
);

control('no drift means no issue body and drift_detected=false', () => {
  const fx = fixture(['browse', 'tag'], 'BrowseService and TagService are both documented.\n');
  const proc = run(fx);
  expect(proc.status === 0, `exited ${proc.status}`);
  expect(/^drift_detected=false$/m.test(proc.stdout), `stdout was:\n${proc.stdout}`);
  expect(!existsSync(fx.out), 'an issue body was written with nothing to report');
});

control('drift means drift_detected=true and a body naming every undocumented service', () => {
  const fx = fixture(['browse', 'tag', 'content-model'], 'BrowseService only.\n');
  const proc = run(fx);
  expect(/^drift_detected=true$/m.test(proc.stdout), `stdout was:\n${proc.stdout}`);
  const body = readFileSync(fx.out, 'utf8');
  for (const name of ['tag', 'content-model']) {
    expect(body.includes(`\`${name}.service.ts\``), `${name} missing from the body:\n${body}`);
  }
  expect(!body.includes('`browse.service.ts`'), 'a documented service was reported as drift');
});

control('spec files are not mistaken for services', () => {
  const fx = fixture(['browse', 'browse.service.export.spec'], 'nothing\n');
  // `browse.service.export.spec.service.ts` is not a real shape; the real ones are
  // `browse.service.spec.ts`, which `.endsWith('.service.ts')` already excludes. This covers the
  // `.spec` filter itself, which the bash version had and which is easy to drop in a rewrite.
  const body = run(fx).out;
  expect(!readFileSync(body, 'utf8').includes('.spec'), 'a spec file was reported as a service');
});

control('unreadable inputs fail loudly rather than reporting no drift', () => {
  const fx = fixture(['browse'], 'x\n');
  const proc = run({ ...fx, services: join(workspace, 'does-not-exist') });
  expect(proc.status === 1, `exited ${proc.status}, expected 1`);
  expect(!/drift_detected/.test(proc.stdout), 'it still claimed a verdict it could not reach');
});

control('GITHUB_OUTPUT receives the verdict when the workflow sets it', () => {
  const fx = fixture(['content-model'], 'nothing\n');
  const outputFile = join(workspace, 'github-output');
  writeFileSync(outputFile, '', 'utf8');
  const proc = spawnSync(
    process.execPath,
    [script, '--out', fx.out, '--services', fx.services, '--doc', fx.doc],
    { cwd: workspace, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outputFile } },
  );
  expect(proc.status === 0, `exited ${proc.status}`);
  expect(
    readFileSync(outputFile, 'utf8').trim() === 'drift_detected=true',
    `GITHUB_OUTPUT holds ${JSON.stringify(readFileSync(outputFile, 'utf8'))}`,
  );
});

/* ── The negative controls: the old shell, with the same value ───────────────────────────────── */

control('NEGATIVE: the old interpolated shell body executes the generated text', () => {
  /* The defect, reproduced. GitHub substituted `${{ steps.check.outputs.missing }}` into the
   * script *text* before bash parsed it, so this splices the value in the same way. With the
   * production value — backticked filenames — bash tried to execute `content-model.service.ts`
   * and exited 127. Here the canary proves execution rather than relying on an exit code. */
  rmSync(CANARY, { force: true });
  const missing = '- `' + HOSTILE + '.service.ts` not found in AGENTS/01-services.md';
  const old = `MISSING="${missing}"\n{ echo "## report"; echo -e "$MISSING"; } > old-body.md\n`;
  const proc = spawnSync('bash', ['-c', old], { cwd: workspace, encoding: 'utf8' });
  expect(
    existsSync(CANARY) || proc.status !== 0,
    'the old form neither executed the text nor failed, so this control proves nothing about it',
  );
});

control('NEGATIVE: the workflow no longer interpolates a step output into any shell body', () => {
  /* The anti-regression half. The fix is a shape, not a value: once any `run:` body carries
   * `${{ steps.*.outputs.* }}` again, the class is back whatever that particular output holds. */
  const yaml = readFileSync(WORKFLOW, 'utf8');
  const runBodies = [...yaml.matchAll(/\n\s+run: (\|?)([\s\S]*?)(?=\n\s{6}- |\n\s{4}\w|$)/g)].map(
    (m) => m[2],
  );
  expect(runBodies.length >= 2, `found ${runBodies.length} run bodies, so nothing was examined`);
  for (const body of runBodies) {
    expect(
      !/\$\{\{\s*steps\./.test(body),
      `a run body interpolates a step output again:\n${body.trim().slice(0, 200)}`,
    );
  }
  /* `if:` and `env:` are GitHub expression contexts, not shell, so the verdict may be read
   * there — and must be, or the issue step cannot be conditional. Asserted, so a rewrite that
   * moved the condition into the shell would be caught. */
  expect(
    /if: steps\.check\.outputs\.drift_detected == 'true'/.test(yaml),
    'the issue step is no longer gated on the verdict',
  );
  expect(
    /--body-file/.test(yaml) && !/--body /.test(yaml),
    'the issue body is not passed as a file',
  );
  expect(
    /node scripts\/agents-staleness-report\.mjs/.test(yaml),
    'the workflow no longer calls the script these controls cover',
  );
});

rmSync(workspace, { recursive: true, force: true });

for (const c of controls) {
  const verdict = c.skipped ? 'SKIP' : c.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${verdict} ${c.name}${c.ok ? '' : `\n         ${c.why}`}`);
}
const failed = controls.filter((c) => !c.ok && !c.skipped).length;
const skipped = controls.filter((c) => c.skipped).length;
const ran = controls.length - skipped;
console.log(
  failed
    ? `\nagents-staleness-report selftest: FAIL — ${failed} of ${ran} control(s) failed.`
    : `\nagents-staleness-report selftest: pass — ${ran} of ${controls.length} control(s), ` +
        `2 negative${skipped ? `, ${skipped} SKIPPED on ${process.platform}` : ''}.`,
);
process.exit(failed ? 1 : 0);
