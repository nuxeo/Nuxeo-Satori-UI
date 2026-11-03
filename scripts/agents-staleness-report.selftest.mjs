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
 * Does `body` hold `wanted` as the whole content of one list item's code span?
 *
 * Shared by the hostile-name controls and the code-span controls, because the delimiter length
 * depends on the name — a name containing backticks gets a longer run — so no control may assume
 * a single backtick.
 */
function codeSpanHolds(body, wanted) {
  return body
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .some((line) => {
      const match = /^- (`+)( ?)([\s\S]*?)\2\1 not found in AGENTS\/01-services\.md$/.exec(line);
      return match !== null && match[3] === wanted;
    });
}

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
  /* Delimiter-agnostic: the code span's backtick run varies with the name, since a name
   * containing backticks needs a longer one (see the code-span controls below). Asserting one
   * backtick here is what made these two controls fail when `codeSpan()` was introduced. */
  expect(
    codeSpanHolds(body, `${HOSTILE}.service.ts`),
    `the body does not carry the name verbatim inside one code span:\n${body}`,
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
      codeSpanHolds(readFileSync(fx.out, 'utf8'), `${HOSTILE_REDIRECT}.service.ts`),
      'the body does not carry the name verbatim inside one code span',
    );
  },
  { needs: POSIX_FILENAMES, why: 'a Win32 filename cannot contain `>`' },
);

control(
  'a name containing a newline cannot split the body into extra list items',
  () => {
    /* A filename can hold a newline on Linux, and the item template puts the name inside a `- `
     * bullet, so a newline followed by a list marker forges an entry.
     *
     * The fixture used to be `a\nb- \`injected…\``, with a `b` in front of the marker — so the
     * forged line did not start with "- `", the count came out at 2, and the control passed
     * while the protection it names did not exist. Review caught that (PR #544), and it was
     * right twice over: the marker goes directly after the newline now, and driven that way the
     * renderer produced THREE bullets for two services. `oneLine()` is the fix.
     *
     * Asserted on the count AND on the forged text being absent as a line of its own: a count of
     * two would also hold if the escape dropped the second service entirely. */
    const fx = fixture(['a\n- `injected.service.ts`', 'plain'], '# empty\n');
    const proc = run(fx);
    expect(proc.status === 0, `exited ${proc.status}`);
    const body = readFileSync(fx.out, 'utf8');
    const items = body.split('\n').filter((line) => line.startsWith('- `'));
    expect(items.length === 2, `${items.length} list items for 2 services:\n${items.join('\n')}`);
    expect(
      items.some((line) => line.includes('plain.service.ts')),
      `the second service was lost rather than kept on its own line:\n${items.join('\n')}`,
    );
    expect(
      items.some((line) => line.includes('a\\n- `injected.service.ts`')),
      `the newline was not escaped into the one item that owns it:\n${items.join('\n')}`,
    );
    expect(!/^- `injected\.service\.ts`/m.test(body), `a forged list item survived:\n${body}`);
  },
  { needs: POSIX_FILENAMES, why: 'a Win32 filename cannot contain a newline' },
);

/**
 * The filename is wrapped in a code span that its own backticks cannot close.
 *
 * Asserted structurally rather than by rendering, because this repository has no declared
 * Markdown parser — `marked` is present only transitively. The structural property is the one
 * CommonMark turns into "exactly one code span": the delimiter is a backtick run longer than any
 * run inside the name, it appears exactly twice on the line, and nothing of the name sits outside
 * it. Corroborated against a real CommonMark parse while fixing (PR #554), which is where the
 * failing case came from: `` a` @report-canary b `` put the @mention OUTSIDE the span.
 */
for (const [label, name] of [
  ['one backtick, the escaping case', 'a` @report-canary b'],
  ['a backtick mid-name', 'a`b'],
  ['a double-backtick run', 'x``y'],
  ['a leading backtick', '`leading'],
  ['a trailing backtick', 'trailing`'],
]) {
  control(`NEGATIVE: a name with ${label} cannot escape its code span`, () => {
    const fx = fixture([name], '# nothing documented here\n');
    const proc = run(fx);
    expect(proc.status === 0, `exited ${proc.status}: ${proc.output.trim().slice(0, 200)}`);
    const item = readFileSync(fx.out, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('- '));
    expect(item !== undefined, 'no list item was written');

    const wanted = `${name}.service.ts`;
    const match = /^- (`+)( ?)([\s\S]*?)\2\1 not found in AGENTS\/01-services\.md$/.exec(item);
    expect(match !== null, `the item is not a single delimited code span:\n    ${item}`);
    const [, fence, , content] = match;
    expect(
      content === wanted,
      `the span holds ${JSON.stringify(content)}, not the whole filename ${JSON.stringify(wanted)}`,
    );
    const longestRun = Math.max(0, ...[...wanted.matchAll(/`+/g)].map((m) => m[0].length));
    expect(
      fence.length > longestRun,
      `the delimiter is ${fence.length} backtick(s) against a run of ${longestRun} in the name, ` +
        'so the name can close it early',
    );
    // The delimiter run must appear exactly twice, or something else on the line pairs with it.
    const runs = [...item.matchAll(/`+/g)].filter((m) => m[0].length === fence.length).length;
    expect(runs === 2, `the ${fence.length}-backtick delimiter appears ${runs} times, not twice`);
  });
}

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
  /* `status !== 0` alone accepted a bash that never ran: `spawnSync` reports `status: null` for
   * ENOENT, and `null !== 0` is true, so on a machine without bash this control passed while
   * proving nothing about the old shell body. Review caught it (PR #544), and it is the same
   * hollow-control shape the whole pull request is about — so the missing shell is now its own
   * reported outcome rather than being folded into the failure it is meant to contrast with. */
  if (proc.error?.code === 'ENOENT' || proc.status === null) {
    throw new Error(
      'bash did not run at all' +
        `${proc.error ? ` (${proc.error.code ?? proc.error.message})` : ''}, so the old shell ` +
        'body was never parsed and this control cannot speak for it. It needs a POSIX shell.',
    );
  }
  expect(
    existsSync(CANARY) || proc.status !== 0,
    `bash ran and exited ${proc.status} without executing the text, so the old form was not ` +
      'reproduced and this control proves nothing about it',
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

control('NEGATIVE: the workflow creates the label it files under before using it', () => {
  /* `agents-stale` does not exist on the repository and the workflow never created it, so the
   * shell-injection fix alone would have moved the failure rather than removed it — the first run
   * with drift to report would have reached `gh issue create` and stopped. Raised in review on
   * PR #544.
   *
   * Checked as a shape, like the interpolation control above: the label this workflow invents must
   * be created before any command that requires it to exist. Ordering is asserted by offset,
   * because creating it *after* `gh issue create` would read as present and fix nothing. */
  const yaml = readFileSync(WORKFLOW, 'utf8');
  /* Comment lines are dropped first. The first version of this control searched the whole file
   * and matched `gh issue create` inside the explanatory comment above the fix — which sits
   * before the label creation, so the control failed on a correct workflow. It was reading prose
   * about a command instead of the command, which is the defect class it exists to catch. */
  const commands = yaml
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !/^\s*#/.test(line));
  const lineOf = (needle) => commands.find(({ line }) => line.includes(needle))?.index ?? -1;

  const created = lineOf('gh label create agents-stale --force');
  expect(created !== -1, 'the workflow does not create `agents-stale`, so filing will be refused');
  for (const consumer of ['gh issue list --label "agents-stale"', 'gh issue create \\']) {
    const at = lineOf(consumer);
    expect(at !== -1, `the workflow no longer runs \`${consumer.trim()}\``);
    expect(
      created < at,
      `\`${consumer.trim()}\` runs before the label is created, so the label would not exist yet`,
    );
  }
  /* And the shared label is not force-created, because `gh label create --force` with no
   * `--color` picks one at random and would recolour a label other people use. */
  expect(
    lineOf('gh label create documentation') === -1,
    'the workflow force-creates the shared `documentation` label, which would recolour it at random',
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
/* Counted from the list, never written in by hand. This summary said "2 negative" while three
 * controls carried the prefix — the same defect review found in `published-links.selftest.mjs`
 * one round earlier, in the sibling file, which is how little a number in prose is worth. The
 * `NEGATIVE:` prefix is this file's marker for "runs the broken form and requires it to
 * misbehave". */
const negative = controls.filter((c) => c.name.startsWith('NEGATIVE:')).length;
console.log(
  failed
    ? `\nagents-staleness-report selftest: FAIL — ${failed} of ${ran} control(s) failed.`
    : `\nagents-staleness-report selftest: pass — ${ran} of ${controls.length} control(s), ` +
        `${negative} negative${skipped ? `, ${skipped} SKIPPED on ${process.platform}` : ''}.`,
);
process.exit(failed ? 1 : 0);
