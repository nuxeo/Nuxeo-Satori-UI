#!/usr/bin/env node
/**
 * Controls for the crash recovery in `sanitizer-selftest-state.mjs`.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* Recovery from a
 * killed run is itself a guard, so it gets the same treatment as the checks it protects — and the
 * only honest way to test it is to **actually `SIGKILL` a process mid-perturbation**. A control
 * that threw, or sent `SIGTERM`, would pass against the code as it was before NXSAT-751: the
 * selftest already handled both, and neither reproduces the defect.
 *
 * Each control perturbs a real tracked file in a child process, kills that child outright, and
 * then asserts what the recovery path does with what it left. Every control restores the tree
 * itself, and the recovery being tested is the backstop if one of them is interrupted in turn.
 *
 * Usage:  node scripts/beta-harness/sanitizer-selftest-recovery.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MARKER,
  PERTURBED_PATHS,
  SELFTEST_ENV_FLAG,
  isLeftover,
  readMarker,
  writeFileAtomic,
} from './sanitizer-selftest-state.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SELFTEST = 'scripts/beta-harness/sanitizer-audit.selftest.mjs';
// A file URL, not a path. `C:\\...` is read by Node as an unsupported URL scheme, so the child
// would fail before perturbing anything and the control would report the wrong thing on Windows
// (review of PR 521).
const STATE_MODULE = pathToFileURL(
  join(ROOT, 'scripts', 'beta-harness', 'sanitizer-selftest-state.mjs'),
).href;

/** A small, real, registered file — cheap to perturb and quick to compare. */
const SUBJECT = 'libs/shared/nuxeo-client/src/lib/utils/navigable-url.ts';
const PERTURBATION = '\n// __nxsat751_recovery_control__\n';

/**
 * A second subject, for the controls about the audit's output.
 *
 * The first version of those controls appended a comment to `navigable-url.ts` and asserted the
 * audit named the file — which it never did, because a comment is not a finding. They passed on
 * "the tree was not repaired" and proved nothing about the hint. A perturbation used to assert
 * what the audit *says* has to be one the audit actually reports, so this neutralises the
 * sanitiser beside a bypass, exactly as the real check-5 control does.
 */
const AUDIT_SUBJECT = 'libs/shared/nuxeo-client/src/lib/utils/render-trusted-html.ts';
const neutraliseSanitiser = (text) => {
  const out = text.replace(/DOMPurify\.sanitize\(/g, 'passThroughForSelftest(');
  if (out === text)
    throw new Error('render-trusted-html.ts no longer calls DOMPurify.sanitize — update this control');
  return out;
};

const results = [];
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFileSync(join(ROOT, rel), text, 'utf8');
const markerAbs = join(ROOT, MARKER);

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Perturb `SUBJECT` in a child process that records a marker and then kills itself with SIGKILL,
 * so no handler of any kind can run. Returns the bytes the child left on disk.
 *
 * The child writes the marker through the real `writeMarker`, not a hand-rolled JSON blob: a
 * control that fabricated the marker would pass while the producer and the consumer disagreed
 * about its shape, which is the `proxy-check` class this repository keeps finding.
 *
 * `mutate` is shipped to the child as **source** rather than applied here first. The first version
 * pre-applied it to a sentinel and substituted the file contents in the child, which works for
 * "append a suffix" and breaks for any transform that has to look at what it is transforming — so
 * `neutraliseSanitiser` threw "no longer calls DOMPurify.sanitize" against a file that calls it on
 * two lines. A transform must therefore be self-contained: it is stringified, so it cannot close
 * over anything in this module.
 */
function crashMidPerturbation(
  mutate = (s) => `${s}\n// __nxsat751_recovery_control__\n`,
  subject = SUBJECT,
) {
  const original = read(subject);
  const script = `
    import { readFileSync } from 'node:fs';
    import { writeFileAtomic, writeMarker } from ${JSON.stringify(STATE_MODULE)};
    const mutate = ${mutate.toString()};
    const abs = ${JSON.stringify(join(ROOT, subject))};
    const original = readFileSync(abs, 'utf8');
    const written = mutate(original);
    if (written === original) throw new Error('the perturbation changed nothing');
    // Write-ahead and atomic, the same protocol as edit(). The first version of this crasher
    // wrote the file first - the opposite of the code it is meant to exercise - so a kill of this
    // gate could recreate the very defect it tests for (review of PR 521).
    writeMarker(${JSON.stringify(ROOT)}, new Map([[${JSON.stringify(subject)}, { original, written }]]));
    writeFileAtomic(abs, written);
    process.kill(process.pid, 'SIGKILL');
  `;
  const r = spawnSync('node', ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  // On POSIX this is reported as the signal; Windows has no signals and Node turns a hard kill
  // into an abrupt non-zero exit. Either is the uncatchable path, which is what the control is
  // about — so accept both rather than asserting how Node names it.
  const diedHard = r.signal === 'SIGKILL' || (r.signal === null && r.status !== 0);
  if (!diedHard) {
    throw new Error(
      `the crasher did not die abruptly (signal=${r.signal}, status=${r.status}) — ` +
        `the control would not be testing the uncatchable path. stderr: ${r.stderr}`,
    );
  }
  return { original, onDisk: read(subject), subject };
}

const runSelftest = (...args) =>
  spawnSync('node', [SELFTEST, ...args], { cwd: ROOT, encoding: 'utf8' });
const runAudit = (...args) =>
  spawnSync('node', ['scripts/beta-harness/sanitizer-audit.mjs', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });

// Refuse to start while a marker exists. These controls write their own markers, and `writeMarker`
// merges rather than replaces — but a run that began with someone else's interruption outstanding
// would still finish by clearing it, and could record an existing perturbation as a file's
// "original". Recover first; do not let a suite that writes to the tree start on an unknown one
// (review of PR 521).
{
  const inherited = readMarker(ROOT);
  if (inherited) {
    console.error(
      `sanitizer-selftest-recovery: refusing to start — ${MARKER} already exists` +
        (inherited.unreadable ? ` and ${inherited.unreadable}` : '') +
        `.\n  An earlier run was interrupted. Recover it first:\n` +
        `    node scripts/beta-harness/sanitizer-audit.selftest.mjs --recover-only\n` +
        `  These controls perturb real files, so starting on an unknown marker could record a\n` +
        `  leftover as a file's original and leave it behind for good.`,
    );
    process.exit(1);
  }
}

console.log('sanitizer-selftest recovery controls\n');

// ---- the defect NXSAT-751 reports --------------------------------------------------------------
// Before the fix this control fails at the first assertion: there was no marker to leave.
{
  const { original, onDisk } = crashMidPerturbation();
  try {
    check(
      'a SIGKILLed run leaves a marker describing what it perturbed',
      existsSync(markerAbs) && Boolean(readMarker(ROOT)?.paths?.[SUBJECT]),
      existsSync(markerAbs) ? 'marker present and names the file' : 'no marker was written',
    );
    check(
      'and leaves the perturbation on disk, as the defect describes',
      onDisk !== original,
      `${onDisk.length - original.length} byte(s) added`,
    );

    const recovered = runSelftest('--recover-only');
    check(
      '--recover-only repairs the file',
      read(SUBJECT) === original,
      read(SUBJECT) === original ? 'byte-identical to the original' : 'still perturbed',
    );
    check('--recover-only removes the marker', !existsSync(markerAbs));
    check('--recover-only exits 0 when it repaired everything', recovered.status === 0);
    check(
      'and says a previous run was interrupted',
      /interrupted/i.test(recovered.stdout ?? ''),
      (recovered.stdout ?? '').split('\n')[0]?.slice(0, 72),
    );
  } finally {
    write(SUBJECT, original);
    spawnSync('node', ['-e', `require('fs').rmSync(${JSON.stringify(markerAbs)},{force:true})`], {
      cwd: ROOT,
    });
  }
}

// ---- a full run recovers too, not only --recover-only -----------------------------------------
// The gate runs the selftest without arguments, so that path has to repair as well. Asserted by
// running the whole selftest, which is slow but is the thing the gate actually invokes.
{
  const { original } = crashMidPerturbation();
  try {
    const full = runSelftest();
    // The detail names the likely cause rather than only the exit code. A tree that already held
    // a marker-less perturbation — one left by an earlier interrupted run of the real selftest —
    // makes this control fail for a reason that has nothing to do with the code under test, and
    // the first version reported only `exit 1, file restored`, which sent me looking in the wrong
    // place for ten minutes.
    const firstProblem = `${full.stdout ?? ''}${full.stderr ?? ''}`
      .split('\n')
      .find((l) => /FAIL|refusing|NOT restored/i.test(l));
    check(
      'a normal selftest run repairs an inherited perturbation and still passes',
      read(SUBJECT) === original && full.status === 0,
      `exit ${full.status}, file ${read(SUBJECT) === original ? 'restored' : 'STILL PERTURBED'}` +
        (full.status === 0 ? '' : ` — ${firstProblem?.trim() ?? 'no FAIL line; check the tree for leftovers'}`),
    );
    check(
      'and reports the interrupted run rather than failing its baseline',
      /interrupted/i.test(full.stdout ?? '') && !/baseline/i.test(full.stderr ?? ''),
    );
    // The registered-path guard, asserted where it bites rather than by grepping for its message.
    check(
      'and no control perturbed a path missing from PERTURBED_PATHS',
      !/not listed in PERTURBED_PATHS/.test(`${full.stdout ?? ''}${full.stderr ?? ''}`),
    );
    // AC-4's second half. A marker left behind by a *successful* run would be worse than no
    // marker: every later run would announce an interruption that never happened, and `git status`
    // would carry an untracked file nobody put there.
    check('and leaves no marker behind after a clean finish', !existsSync(markerAbs));
  } finally {
    write(SUBJECT, original);
  }
}

// ---- the write-ahead window: killed BETWEEN the record and the file ----------------------------
// Review of PR 521 asked for the boundaries to be tested, not just "after both writes finish".
// With the record written first, a kill in that window leaves a marker describing a perturbation
// that never landed — which must be recognised as already-clean, not restored over and not
// reported as a conflict needing a human.
{
  const original = read(SUBJECT);
  const script = `
    import { writeMarker } from ${JSON.stringify(STATE_MODULE)};
    import { readFileSync } from 'node:fs';
    const abs = ${JSON.stringify(join(ROOT, SUBJECT))};
    const original = readFileSync(abs, 'utf8');
    // The record goes down, and the process dies before the file is touched.
    writeMarker(${JSON.stringify(ROOT)}, new Map([[${JSON.stringify(SUBJECT)}, { original, written: original + '\\n// never written\\n' }]]));
    process.kill(process.pid, 'SIGKILL');
  `;
  spawnSync('node', ['--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8' });
  try {
    check(
      'a marker exists although the file was never perturbed',
      existsSync(markerAbs) && read(SUBJECT) === original,
    );
    const recovered = runSelftest('--recover-only');
    check(
      'recovery calls it already clean rather than a conflict',
      /already clean/i.test(recovered.stdout ?? '') && !/NOT restored/i.test(recovered.stderr ?? ''),
      (recovered.stdout ?? '').split('\n').find((l) => /already clean/i.test(l))?.trim(),
    );
    check('leaves the file untouched', read(SUBJECT) === original);
    check('exits 0, because nothing needs a human', recovered.status === 0);
    check('and drops the marker', !existsSync(markerAbs));
  } finally {
    write(SUBJECT, original);
    runSelftest('--recover-only');
  }
}

// ---- an unreadable marker is not a clean start -------------------------------------------------
// The signature of a kill during the marker write, which is when something is most likely still
// perturbed — so treating it as absent would hide the one case the marker exists for.
{
  writeFileSync(markerAbs, '{ "paths": { truncated mid-w', 'utf8');
  try {
    const recovered = runSelftest('--recover-only');
    check(
      'an unparseable marker is reported, not ignored',
      /not valid JSON|kill mid-write/i.test(recovered.stderr ?? ''),
    );
    check('and exits non-zero', recovered.status !== 0);
    check('and is left in place as evidence', existsSync(markerAbs));
  } finally {
    writeFileSync(markerAbs, '', 'utf8');
    spawnSync('node', ['-e', `require('fs').rmSync(${JSON.stringify(markerAbs)},{force:true})`], {
      cwd: ROOT,
    });
  }
}

// ---- the conservative rule survives ------------------------------------------------------------
// The in-process `restoreAll` refuses to restore a file something else has written since. Recovery
// inherits that, or a crash followed by a developer's own edit would silently discard their work.
{
  const { original } = crashMidPerturbation();
  const mine = `${original}\n// an edit of my own, made after the crash\n`;
  try {
    write(SUBJECT, mine);
    const recovered = runSelftest('--recover-only');
    check(
      'recovery refuses a file something else has written since the crash',
      read(SUBJECT) === mine,
      read(SUBJECT) === mine ? 'my edit survived' : 'MY EDIT WAS DISCARDED',
    );
    check('and says so on stderr', /NOT restored/i.test(recovered.stderr ?? ''));
    check('and exits non-zero, because a human has to decide', recovered.status !== 0);
    // Reversed deliberately in review of PR 521. This asserted the marker was dropped after a
    // refusal, on the reasoning that keeping it would make every later run repeat a warning about
    // a file nobody would repair from it. That was true about restoring and wrong about keeping:
    // the marker holds the only copy of that file's `original`, and when the run began on a file
    // the developer had edited without committing, it is the only copy anywhere — git has the
    // committed content, not theirs. Repeating the warning is the correct outcome; a refused path
    // needs a human, and the run exits non-zero until one arrives.
    check(
      'keeps the marker for a refused path, so its saved original is not destroyed',
      existsSync(markerAbs),
    );
    const held = readMarker(ROOT);
    check(
      'and that record still holds the original bytes',
      Boolean(held && 'paths' in held && held.paths[SUBJECT]?.original === original),
    );
  } finally {
    write(SUBJECT, original);
  }
}

// ---- the audit explains itself, and does not repair ---------------------------------------------
{
  const { original } = crashMidPerturbation(neutraliseSanitiser, AUDIT_SUBJECT);
  try {
    const audit = runAudit();
    const out = `${audit.stdout ?? ''}${audit.stderr ?? ''}`;
    check(
      'the audit reports a leftover as a finding rather than repairing it',
      audit.status === 1 && read(AUDIT_SUBJECT) !== original,
      `audit exit ${audit.status}, tree left exactly as it was found`,
    );
    check(
      'and names the selftest, the interrupted marker and the one-command recovery',
      out.includes('sanitizer-audit.selftest.mjs') &&
        out.includes('--recover-only') &&
        /INTERRUPTED/i.test(out),
    );
    // Asserted inside the hint's own list, not merely "somewhere in the output": the finding
    // text already contains the path, so `out.includes(path)` passed with the hint disabled —
    // a control that cannot fail for the reason it names.
    check(
      'and lists the perturbed path in the hint itself',
      out.includes(`\n    ${AUDIT_SUBJECT}\n`),
    );
  } finally {
    write(AUDIT_SUBJECT, original);
    runSelftest('--recover-only');
  }
}

// ---- the hint is silent for the selftest's own runs ---------------------------------------------
// Otherwise every control's output would carry an explanation about a perturbation that is the
// point, and the gate echoes the selftest's output on a pass.
{
  const { original } = crashMidPerturbation(neutraliseSanitiser, AUDIT_SUBJECT);
  try {
    const asSelftest = spawnSync('node', ['scripts/beta-harness/sanitizer-audit.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, SANITIZER_SELFTEST_RUNNING: '1' },
    });
    const out = `${asSelftest.stdout ?? ''}${asSelftest.stderr ?? ''}`;
    // Load-bearing pair: the audit must still FAIL (the defect is real), while saying nothing
    // about leftovers. Without the first half this control would pass on an audit that crashed.
    check(
      'the audit still fails on the perturbation when the selftest is the caller',
      asSelftest.status === 1,
      `exit ${asSelftest.status}`,
    );
    check(
      "but the leftover hint is suppressed for the selftest's own runs",
      !out.includes('--recover-only'),
    );
  } finally {
    write(AUDIT_SUBJECT, original);
    runSelftest('--recover-only');
  }
}

// ---- the hint covers a leftover BUDGET change, which names no path ------------------------------
// Asked for in review of PR 521, and it found a real gap: four of the six `[ratchet]` phrasings
// name a category and a number without naming the allowlist, so path matching alone missed the
// most dangerous leftover there is. A perturbed allowlist changes which bypasses count as
// accounted for — the very first reproduction of NXSAT-751 left `"B": 1` as `"B": 0`.
{
  const ALLOWLIST = '.ai/state/sanitizer-allowlist.json';
  const lowerABudget = (text) => {
    const parsed = JSON.parse(text);
    const [cat] = Object.entries(parsed.budgets).find(([, v]) => typeof v === 'number' && v > 0) ?? [];
    if (!cat) throw new Error('no positive budget to lower — update this control');
    parsed.budgets[cat] -= 1;
    return `${JSON.stringify(parsed, null, 2)}\n`;
  };
  const { original } = crashMidPerturbation(lowerABudget, ALLOWLIST);
  try {
    const audit = runAudit();
    const out = `${audit.stdout ?? ''}${audit.stderr ?? ''}`;
    check(
      'a leftover budget change is reported by the audit',
      audit.status === 1 && /\[ratchet\]/.test(out),
      `exit ${audit.status}`,
    );
    check(
      'and the hint names the allowlist even though the finding does not',
      out.includes('--recover-only') && out.includes(`\n    ${ALLOWLIST}\n`),
    );
  } finally {
    write(ALLOWLIST, original);
    runSelftest('--recover-only');
  }
}

// ---- the hint is silent for a finding outside the perturbable set ------------------------------
// AC-5's negative half, and the control that stops the hint from being unconditional. Without it
// every assertion about the hint above would still pass if `isLeftover` simply returned every path
// it was asked about, and the audit would start explaining real defects as possible leftovers.
// Exercised directly, because manufacturing a real finding in an unrelated file would mean
// perturbing one — and perturbing a file outside the registered set is the thing `edit()` refuses.
{
  const realFinding =
    '[1] unregistered bypass  libs/features/search/src/lib/search/search.ts:42\n' +
    "    member 'highlight' calls bypassSecurityTrustHtml with no entry in the allowlist.";
  check(
    'a finding outside PERTURBED_PATHS is not described as a possible leftover',
    isLeftover(realFinding, {}).length === 0,
    `isLeftover returned ${JSON.stringify(isLeftover(realFinding, {}))}`,
  );
  // And the positive half of the same predicate, so the control above cannot pass by the predicate
  // being broken in both directions.
  const leftoverFinding = `[5] unsanitised trusted HTML  ${AUDIT_SUBJECT}:114`;
  check(
    'and one inside it is',
    isLeftover(leftoverFinding, {}).includes(AUDIT_SUBJECT),
    `isLeftover returned ${JSON.stringify(isLeftover(leftoverFinding, {}))}`,
  );
  check(
    'while the selftest flag suppresses even a genuine leftover',
    isLeftover(leftoverFinding, { [SELFTEST_ENV_FLAG]: '1' }) === false,
  );
}

// ---- atomic replacement preserves the file mode ------------------------------------------------
// A rename replaces the inode, so without carrying the mode across, the executable bit of a
// shebang script is silently lost. `sanitizer-audit.mjs` is 755 and is itself in the perturbable
// set, so the first atomic-replacement commit stripped it — caught by `git` reporting a mode
// change, not by any control. Now there is a control (review of PR 521).
{
  const AUDIT_SCRIPT = 'scripts/beta-harness/sanitizer-audit.mjs';
  const before = statSync(join(ROOT, AUDIT_SCRIPT)).mode;
  const original = read(AUDIT_SCRIPT);
  try {
    writeFileAtomic(join(ROOT, AUDIT_SCRIPT), `${original}\n// mode probe\n`);
    check(
      'writeFileAtomic keeps the file mode, so a shebang script stays executable',
      statSync(join(ROOT, AUDIT_SCRIPT)).mode === before,
      `mode ${(statSync(join(ROOT, AUDIT_SCRIPT)).mode & 0o777).toString(8)} was ${(before & 0o777).toString(8)}`,
    );
  } finally {
    writeFileAtomic(join(ROOT, AUDIT_SCRIPT), original);
  }
}

// ---- every perturbed path is registered --------------------------------------------------------
// The first version of this control scanned for `libs/` and `apps/` only, and passed while
// `scripts/beta-harness/sanitizer-audit.mjs` — which one control perturbs to prove a check cannot
// be deleted silently — was missing from the list. A control with the same blind spot as the
// author is worse than no control, so this one is extension-driven rather than prefix-driven, and
// it reports staleness in both directions.
{
  const source = readFileSync(join(ROOT, SELFTEST), 'utf8');
  const named = [
    ...new Set(
      [...source.matchAll(/'([A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)+\.(?:ts|html|scss|json|mjs))'/g)]
        .map((m) => m[1])
        .filter((p) => existsSync(join(ROOT, p))),
    ),
  ];
  const unregistered = named.filter((p) => !PERTURBED_PATHS.includes(p));
  check(
    'every repo path the selftest names is registered in PERTURBED_PATHS',
    unregistered.length === 0,
    unregistered.length === 0
      ? `${named.length} path(s) named, ${PERTURBED_PATHS.length} registered`
      : `unregistered: ${unregistered.join(', ')}`,
  );
  const stale = PERTURBED_PATHS.filter((p) => !named.includes(p));
  check(
    'and PERTURBED_PATHS lists nothing the selftest no longer names',
    stale.length === 0,
    stale.length === 0 ? 'no stale entries' : `stale: ${stale.join(', ')}`,
  );
}

// The guard's behavioural consequence is asserted where it actually bites — the full-run control
// above fails with "not listed in PERTURBED_PATHS" if any control perturbs an unregistered path.
// Deliberately not grepped for here: a control that reads the source for the error string proves
// the string exists, not that the guard fires, which is the proxy-check this repository keeps
// catching. It fired for real during this change, on `scripts/beta-harness/sanitizer-audit.mjs`.

// ---- verdict -----------------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log('');
if (failed.length > 0) {
  console.log(
    `sanitizer-selftest-recovery: FAIL — ${failed.length} of ${results.length} control(s) did not behave as expected.`,
  );
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exit(1);
}
console.log(
  `sanitizer-selftest-recovery: PASS — ${results.length} control(s), each driven by a real SIGKILL.`,
);
