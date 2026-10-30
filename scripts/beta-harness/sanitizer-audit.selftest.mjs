#!/usr/bin/env node
/**
 * Negative controls for `sanitizer-audit.mjs` — proof that each check can actually fail.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* Three gates in
 * this programme were green while the thing they guarded was broken — an evidence check that
 * compared script `src` attributes instead of bundle bytes, a path check that was tautological
 * under the dev base href, and a lockfile gate that matched dependency names but not versions.
 *
 * So rather than capture one red run in a transcript nobody re-reads, this perturbs the tree
 * once per check, asserts the audit goes red *for the expected reason*, and restores. It is
 * repeatable, so it keeps answering the question after the next refactor.
 *
 * Every perturbation is applied in memory and written back from the original bytes in a `finally`,
 * with SIGINT/SIGTERM/SIGHUP and `uncaughtException` handlers covering the paths `finally` does not.
 * **SIGKILL and power loss remain uncatchable**, so the guarantee is "no dirty tree unless the
 * process is killed outright" — not an absolute one. Recovery is `git checkout` on the paths the
 * handler names. It touches real tracked files, so do not run it concurrently with a build.
 *
 * Usage:  node scripts/beta-harness/sanitizer-audit.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MARKER,
  PERTURBED_PATHS,
  SELFTEST_ENV_FLAG,
  recoverPerturbations,
  retainMarker,
  writeFileAtomic,
  writeMarker,
} from './sanitizer-selftest-state.mjs';

/** This script's own path, for the recovery command printed in messages. */
const SELFTEST_SELF = 'scripts/beta-harness/sanitizer-audit.selftest.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const AUDIT = 'scripts/beta-harness/sanitizer-audit.mjs';
const ALLOWLIST = '.ai/state/sanitizer-allowlist.json';
const VIEWER_TS = 'libs/shared/ui/src/lib/document-viewer/document-viewer.component.ts';
const NOTE_EDITOR = 'libs/features/document-detail/src/lib/note-editor/note-editor.ts';
const DOCUMENT_DETAIL = 'libs/features/document-detail/src/lib/document-detail/document-detail.ts';
const TRUST_OBJECT_URL = 'libs/shared/nuxeo-client/src/lib/utils/trust-object-url.ts';
const CHECK1_SITE = TRUST_OBJECT_URL;
const CHECK1_CATEGORY = 'B';

/**
 * The line inside `note-editor.ts`'s `markdownHtml` that injection-style perturbations anchor on.
 *
 * Category D moved this file's inline `bypassSecurityTrustHtml` calls into `renderTrustedHtml`, so
 * the anchor is no longer itself a bypass — the perturbation supplies that, which is what these
 * controls were always really doing. Defined once because the old anchor was duplicated in eighteen
 * places, and every one of them had to be found by running the selftest and reading a stack trace.
 */
const NOTE_EDITOR_ANCHOR =
  "    return renderTrustedHtml(this.sanitizer, raw, { ADD_ATTR: ['target', 'rel'] });";

/**
 * `render-trusted-html.ts` and the one bypass left in it.
 *
 * Mutation-style controls — the ones that change what an EXISTING bypass receives, rather than
 * injecting a new one — have to live where a bypass actually is. After Category D that is the two
 * helpers, so those controls point here.
 */
const HTML_HELPER = 'libs/shared/nuxeo-client/src/lib/utils/render-trusted-html.ts';
const HTML_HELPER_BYPASS = '  return sanitizer.bypassSecurityTrustHtml(clean);';
/** The helper's sanitise call — the other half of the pairing these controls perturb. */
const HTML_HELPER_SANITISE = '  const clean = DOMPurify.sanitize(html, config);';
const KD_CITATION =
  'libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.ts';
const BASE_REF = 'refs/remotes/origin/main';
const KD_REGISTERED_SANITISER_BYPASS =
  "      return renderTrustedHtml(this.sanitizer, this.escapeHtml(text), allowMarkOnly);";

function injectKdRegisteredSanitiserBypass(s) {
  if (!s.includes(KD_REGISTERED_SANITISER_BYPASS)) {
    throw new Error('highlightExcerpt changed shape — update this control');
  }
  return s.replace(
    KD_REGISTERED_SANITISER_BYPASS,
    "      if (text === '__selftest__') {\n" +
      '        return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(text));\n' +
      '      }\n' +
      KD_REGISTERED_SANITISER_BYPASS,
  );
}

/**
 * The base the next audit run should compare against, or `null` for the real one.
 *
 * Passed to the child process rather than written to `refs/remotes/origin/main`. Repointing that ref
 * was the sharpest edge in this file: it mutated shared repository state, a crash between repoint and
 * restore left the user's remote-tracking ref wrong, and the recovery was `git fetch origin` — which is
 * not something a gate run should ever make necessary. An environment variable is scoped to one child
 * process and cannot outlive it.
 */
let baseRefOverride = null;

/** Runs the audit and returns { code, out }. */
function runAudit(extraArgs = []) {
  const env = { ...process.env };
  if (baseRefOverride) env['SANITIZER_AUDIT_BASE_REF'] = baseRefOverride;
  else delete env['SANITIZER_AUDIT_BASE_REF'];
  // Here a perturbation is the point, not an accident, so the audit must not append its
  // "this may be a leftover" explanation to output the controls are about to read.
  env[SELFTEST_ENV_FLAG] = '1';
  const r = spawnSync('node', [AUDIT, ...extraArgs], { cwd: ROOT, encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * `relPath -> { original, written }` for every file a control has perturbed.
 *
 * `written` is kept as well as `original` so restoration can tell "still holds my perturbation" from
 * "someone else has written this since". Blind restoration would silently discard a concurrent edit —
 * an IDE save while a control is running — by putting back bytes captured before it.
 */
const backups = new Map();
function edit(relPath, transform) {
  // Registered-path check, so the marker cannot go stale against the controls. A perturbation of
  // something `PERTURBED_PATHS` does not list would be invisible to recovery and to the audit's
  // leftover hint, and the only way to notice would be the next reader's confusion (NXSAT-751).
  if (!PERTURBED_PATHS.includes(relPath))
    throw new Error(
      `${relPath} is perturbed by a control but not listed in PERTURBED_PATHS ` +
        `(scripts/beta-harness/sanitizer-selftest-state.mjs) — add it, or recovery cannot undo it`,
    );
  const abs = join(ROOT, relPath);
  const current = readFileSync(abs, 'utf8');
  const original = backups.get(relPath)?.original ?? current;
  const next = transform(current);
  if (next === original)
    throw new Error(`perturbation for ${relPath} changed nothing — the selftest would be vacuous`);
  backups.set(relPath, { original, written: next });
  // **Write-ahead**: the record goes down before the file, so there is no window in which a
  // perturbation exists with nothing describing it. The first version wrote the file first, on the
  // reasoning that a record of a perturbation that was never applied would make the next run
  // "restore" a file nobody touched — which was wrong, because the marker names both states and
  // recovery recognises an unapplied write as already-clean (review of PR 521).
  writeMarker(ROOT, backups);
  // Atomic, like the marker: `writeFileSync` truncates in place, so a kill mid-write would leave
  // bytes matching neither recorded state — the one outcome recovery can only refuse (review of
  // PR 521).
  writeFileAtomic(abs, next);
}
function restoreAll() {
  const clobbered = [];
  for (const [relPath, { original, written }] of backups) {
    const abs = join(ROOT, relPath);
    // Only restore what still holds this run's perturbation. If the bytes differ, something outside
    // this process wrote the file, and overwriting it with a snapshot taken before that write would
    // destroy work this script has no business touching. Reported instead, loudly, because a
    // perturbed file left in place is also not something to be quiet about.
    let onDisk;
    try {
      onDisk = readFileSync(abs, 'utf8');
    } catch {
      onDisk = null;
    }
    if (onDisk !== null && onDisk !== written) {
      clobbered.push(relPath);
      continue;
    }
    writeFileAtomic(abs, original);
  }
  // **The records for refused paths are kept.** This is the in-process twin of the rule
  // `recoverPerturbations` follows, and it was missed here when that one was fixed: a path under
  // `clobbered` is one an IDE save or a concurrent edit has rewritten, and the marker holds the
  // only copy of what was in it *before* this run — including an uncommitted edit that predates
  // the run entirely. Deleting the marker on the way past therefore destroyed exactly what
  // refusing to overwrite was protecting (review of PR 521).
  const retained = new Map([...backups].filter(([relPath]) => clobbered.includes(relPath)));
  backups.clear();
  retainMarker(ROOT, retained);
  baseRefOverride = null;
  if (clobbered.length > 0) {
    console.error(
      `\nselftest: NOT restoring ${clobbered.join(', ')} — changed by something else mid-run.\n` +
        `  Those files may still hold a perturbation, and the marker has been kept so their\n` +
        `  pre-run contents are not lost. Inspect with 'git diff', then either resolve them or\n` +
        `  run 'node ${SELFTEST_SELF} --recover-only'.\n` +
        `  Stopping here: a later control's cleanup would clear those records.`,
    );
    // Stopping is the point. Continuing would let the next control's `restoreAll()` narrow the
    // marker again and drop the entries this one just preserved.
    process.exit(1);
  }
}

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** Set by `repointBaseTo`, run by `restoreAll` — so the signal handlers below cover it too. */

/**
 * Points `refs/remotes/origin/main` at `commitish` until the next `restoreAll()`.
 *
 * The two merge-base ratchet invariants — a budget above the base's, and a member declaring more
 * calls than the base declared — cannot be reached by perturbing the working tree, because the
 * whole point of reading the ceiling from the merge base is that a contributor cannot edit it.
 * That is also why they were the two invariants no control had ever observed red: with **both**
 * comparisons stubbed out, the selftest still reported `PASS — 51 negative control(s)`.
 *
 * Worse, they are inert on this branch rather than merely untested. The allowlist was *added* by
 * this branch, so it does not exist at the merge base with `origin/main`, `allowlistAtBase()`
 * returns `null`, and every run prints `could not read budgets at the merge base`. The ceiling that
 * the plan describes as uneditable is currently not consulted at all.
 *
 * So the base is moved instead of the tree. Repointing the remote-tracking ref at `HEAD` makes the
 * "merge base" the committed allowlist, and a working-tree perturbation is then measured against
 * it exactly as a real second PR would be. Nothing in `sanitizer-audit.mjs` changes, and no
 * override is added to it — an env var or flag that relocated the ceiling would be a way to switch
 * the ratchet off in CI, which is the opposite of the point.
 *
 * The ref is restored through `restoreAll`, so `finally`, the signal handlers and
 * `uncaughtException` all cover it. `git fetch origin` is the recovery if the process is killed
 * outright: a stale remote-tracking ref would silently change what every later audit compares
 * against, which is worth being loud about.
 */
function repointBaseTo(commitish) {
  if (baseRefOverride) throw new Error('base already overridden — nesting is not supported');
  const resolved = git('rev-parse', '--verify', `${commitish}^{commit}`);
  if (resolved.status !== 0) throw new Error(`selftest: cannot resolve ${commitish}`);
  baseRefOverride = resolved.stdout.trim();
}

// `finally` covers a thrown error but not a signal, and this perturbs real tracked files. Without
// these handlers a Ctrl-C mid-control leaves the tree dirty, and the next reader finds a bypass in
// their working copy that they did not write. SIGKILL and a hard power loss remain uncatchable by
// construction: `git checkout` on the paths named in the failure output is the recovery.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    const touched = [...backups.keys()];
    restoreAll();
    if (touched.length) {
      console.error(`\nselftest: interrupted by ${signal} — restored ${touched.join(', ')}`);
    }
    process.exit(130);
  });
}
// A throw outside a control's `finally` (e.g. in a perturbation itself) would also skip restoration.
process.on('uncaughtException', (err) => {
  const touched = [...backups.keys()];
  restoreAll();
  if (touched.length) console.error(`selftest: crashed — restored ${touched.join(', ')}`);
  console.error(err);
  process.exit(1);
});

/**
 * Undo anything a previous run was killed in the middle of, before the baseline looks at the tree.
 *
 * Ordering matters twice. Before the baseline, because a leftover perturbation makes every check
 * red there and the message would blame the audit rather than the interrupted run. And before the
 * controls, because `edit()` captures `original` from the working tree — perturbing an
 * already-perturbed file would bake the leftover into the "original" it restores to, turning a
 * recoverable mess into a committed one.
 *
 * Prints nothing when there is nothing to do, so a normal run is unchanged (NXSAT-751).
 */
function recoverInterruptedRun() {
  const { found, restored, refused, alreadyClean, startedAt, unreadable } =
    recoverPerturbations(ROOT);
  if (!found) return [];
  if (unreadable) {
    // Not treated as a clean start: an unreadable marker is the signature of a kill during the
    // marker write, which is exactly when something is most likely still perturbed.
    console.error(
      `selftest: the interruption marker ${MARKER} ${unreadable}.\n` +
        `  It has been left in place as evidence. Check these paths by hand before trusting a run:\n` +
        PERTURBED_PATHS.map((p) => `    ${p}\n`).join(''),
    );
    return ['<unreadable marker>'];
  }
  console.log(
    `selftest: a previous run was interrupted${startedAt ? ` (started ${startedAt})` : ''} ` +
      `and left perturbations behind — SIGKILL cannot be caught, so its handlers never ran.`,
  );
  if (restored.length > 0) console.log(`  restored: ${restored.join(', ')}`);
  if (alreadyClean.length > 0) {
    console.log(
      `  already clean: ${alreadyClean.join(', ')} — recorded before the write landed, nothing to undo`,
    );
  }
  if (refused.length > 0) {
    console.error(
      `  NOT restored: ${refused.join(', ')}\n` +
        `    Those no longer hold that run's bytes, so something else has written them since and\n` +
        `    restoring would discard it. Inspect with 'git diff' and decide by hand.`,
    );
  }
  return refused;
}

// `--recover-only` exists so the audit's own hint can name one command. Repairing the tree should
// not require sitting through every control, and after a killed `beta:gate` the run that fails is
// `sanitizer-audit` — which is registered *before* this selftest, so the gate stops and this file
// never gets the chance to recover on its own.
if (process.argv.includes('--recover-only')) {
  // Non-zero only when a path was left for a human: "nothing to recover" is a success, or the
  // hint the audit prints would send the reader round the same loop a second time.
  const refused = recoverInterruptedRun();
  if (refused.length > 0) process.exit(1);
  console.log('selftest: nothing left to recover.');
  process.exit(0);
}

// A normal run stops here when recovery could not finish the job. The first version discarded this
// result on the normal path, so a post-crash edit that the audit does not flag — an added comment,
// say — was reported as NOT restored and the suite then ran to a green PASS with the perturbation
// still in the tree. A gate cannot report success while recovery is waiting on a human, and
// `edit()` would go on to capture the foreign content as the `original` it restores to (review of
// PR 521).
{
  const refused = recoverInterruptedRun();
  if (refused.length > 0) {
    console.error(
      `\nselftest: refusing to run — recovery left ${refused.length} path(s) for a human.\n` +
        `  Resolve them, then re-run. 'git diff' shows what is there; 'git checkout --' discards it.`,
    );
    process.exit(1);
  }
}

const results = [];

/**
 * @param {string} name
 * @param {number|null} check  --only value, or null for the whole audit
 * @param {() => void} perturb
 * @param {string} expect  substring the red output must contain
 */
function control(name, check, perturb, expect) {
  try {
    perturb();
    const { code, out } = runAudit(check === null ? [] : ['--only', String(check)]);
    const red = code !== 0;
    const matched = out.includes(expect);
    results.push({ name, pass: red && matched, red, matched, expect, out, kind: 'negative' });
  } finally {
    restoreAll();
  }
}

// ---- baseline -----------------------------------------------------------------------------------
// Every check must be green on an unperturbed tree, or a "red" below could be pre-existing noise
// rather than the perturbation talking.
//
// Check 4 was red here when this file was written: it reported exactly the five NONE-context sites
// section 2 of the plan predicted in advance, plus the dormant `video[poster]`. Those are now
// fixed, so its baseline is green and the positive control below is what keeps it honest.
{
  const green = [1, 2, 3, 4, 5];
  for (const c of green) {
    const { code, out } = runAudit(['--only', String(c)]);
    results.push({
      name: `baseline: check ${c} is green before perturbation`,
      pass: code === 0,
      red: code !== 0,
      matched: true,
      expect: '(exit 0)',
      out,
      kind: 'baseline',
    });
  }
}

// ---- check 1: an unregistered bypass -------------------------------------------------------------
control(
  'check 1 catches a bypass with no allowlist entry',
  1,
  () =>
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      delete j.sites[CHECK1_SITE];
      j.budgets[CHECK1_CATEGORY] -= 1; // keep the ratchet quiet so only check 1 is under test
      return JSON.stringify(j, null, 2);
    }),
  `unregistered bypass  ${CHECK1_SITE}`,
);

// ---- check 1: an extra bypass inside an ALREADY-REGISTERED member ---------------------------------
// The hole this closes was real. Keying the allowlist by `file::member` alone meant a bare
// `entries.has(key)` waved through any number of calls in a member that was already listed.
// `highlightExcerpt` holds three, so a fourth grew genuine debt 31 -> 32 while every number the
// ratchet watches stayed put — the pre-fix gate printed "PASS — 32 bypass call(s), all accounted
// for". Verified by running the old script against this exact perturbation.
control(
  'check 1 catches an extra bypass added to an already-registered member',
  1,
  () =>
    edit('libs/shared/nuxeo-client/src/lib/utils/render-trusted-html.ts', (s) => {
      // Retargeted at `renderTrustedHtml`, and the reason is the whole point of this control.
      //
      // It needs a member that IS registered, so a second call trips the per-member `calls`
      // invariant. It used to inject into `highlightExcerpt` — but Category D consolidated that
      // member's three bypasses into `renderTrustedHtml`, leaving `highlightExcerpt` with no entry.
      // The audit then correctly reported "unregistered bypass" instead, so the control went red for
      // the right reason about the wrong thing and stopped exercising the count invariant at all.
      //
      // That is the failure mode this whole file exists to prevent, one level up: a negative control
      // that still fails, and so still looks like it is working, while no longer testing what it
      // claims. Retarget rather than relax the expectation.
      const anchor = `  const clean = DOMPurify.sanitize(html, config);\n`;
      if (!s.includes(anchor)) {
        throw new Error('renderTrustedHtml body changed — update this control');
      }
      return s.replace(
        anchor,
        anchor +
          `  if (html === '__selftest__') {\n` +
          `    return sanitizer.bypassSecurityTrustHtml(clean);\n` +
          `  }\n`,
      );
    }),
  'bypass count mismatch',
);

// ---- check 1: a bypass reached through element access rather than property access -----------------
// `sanitizer['bypassSecurityTrustHtml'](x)` is an `ElementAccessExpression`. Every place that looked
// for a bypass tested `ts.isPropertyAccessExpression` only, so the bracketed spelling — ordinary
// TypeScript compiling to the same property read — was invisible to registration, to the declared
// call count, to the category budget and to checks 3 and 5. Verified against the pre-fix script
// against this exact perturbation: it printed "PASS — 31 bypass call(s), all accounted for".
control(
  'check 1 catches a bypass written with element access instead of property access',
  1,
  () =>
    edit(
      'libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.ts',
      (s) => {
        const anchor = `  private highlightExcerpt(text: string, excerpt?: string): SafeHtml {\n`;
        if (!s.includes(anchor)) {
          throw new Error('highlightExcerpt signature changed — update this control');
        }
        return s.replace(
          anchor,
          anchor +
            `    if (text === '__selftest__') {\n` +
            `      return this.sanitizer['bypassSecurityTrustHtml'](text);\n` +
            `    }\n`,
        );
      },
    ),
  'unregistered bypass  libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.ts',
);

// ---- check 1 and 5: destructuring by ASSIGNMENT rather than declaration --------------------------
// `const { bypassSecurityTrustHtml: trust } = sanitizer` is a declaration and its left side is a
// binding pattern. `({ bypassSecurityTrustHtml: trust } = sanitizer)` is an assignment, and
// TypeScript parses that left side as an object *literal* — a `PropertyAssignment`, not a
// `BindingElement`. So the collector saw no binding element, no property access and no element
// access on the sanitizer, and the `trust(raw)` afterwards is an ordinary identifier call.
//
// Verified against 5fe82d4: an unsanitised HTML bypass written this way left the audit at
// "PASS — 31 bypass call(s), all accounted for" — outside checks 1 and 5 and outside the budget.
control(
  'check 1 catches a bypass destructured by assignment rather than declaration',
  1,
  () =>
    edit(NOTE_EDITOR, (s) => {
      // Anchored on the `renderTrustedHtml` call, not the raw bypass it replaced: Category D moved
      // every inline `bypassSecurityTrustHtml` in this file into that helper. The perturbation still
      // has to introduce a *bypass* to be a valid control for checks 1 and 5, so it injects one here
      // rather than rewriting an existing one.
      const anchor =
        "    return renderTrustedHtml(this.sanitizer, raw, { ADD_ATTR: ['target', 'rel'] });";
      if (!s.includes(anchor))
        throw new Error('note-editor.ts markdownHtml changed — update this control');
      return s.replace(
        anchor,
        `    let trust!: (v: string) => SafeHtml;\n` +
          `    ({ bypassSecurityTrustHtml: trust } = this.sanitizer);\n` +
          `    if (raw === '__selftest__') {\n` +
          `      return trust(raw);\n` +
          `    }\n` +
          anchor,
      );
    }),
  'unregistered bypass  libs/features/document-detail/src/lib/note-editor/note-editor.ts',
);

control(
  'check 5 reports a bypass destructured by assignment as indirect, so it is checked and not merely counted',
  5,
  // Being counted is not being checked. Once the function is in a local there is no argument at the
  // read site for the provenance walk to follow, which is what check 5's indirect finding is for —
  // and it only fires because the assignment form is now recorded as a bypass at all.
  () =>
    edit(NOTE_EDITOR, (s) => {
      // Same re-anchoring as the control above: this file's inline bypasses moved into
      // `renderTrustedHtml` with Category D.
      const anchor =
        "    return renderTrustedHtml(this.sanitizer, raw, { ADD_ATTR: ['target', 'rel'] });";
      if (!s.includes(anchor))
        throw new Error('note-editor.ts markdownHtml changed — update this control');
      return s.replace(
        anchor,
        `    let trust!: (v: string) => SafeHtml;\n` +
          `    ({ bypassSecurityTrustHtml: trust } = this.sanitizer);\n` +
          `    if (raw === '__selftest__') {\n` +
          `      return trust(raw);\n` +
          `    }\n` +
          anchor,
      );
    }),
  'indirect trusted HTML',
);

// Specificity for the two controls above, and the reason the collector asks for the assignment's
// right-hand side rather than merely recognising the property name.
//
// An `ObjectLiteralExpression` is a destructuring pattern only when it is the target of an
// assignment. In an ordinary expression position it is a value, and
// `{ bypassSecurityTrustHtml: (v) => v }` there names no bypass at all — treating it as one would
// invent a phantom call, push the member past its declared `calls`, and make the count wrong in the
// direction that produces false failures rather than silent passes. Both directions matter: a gate
// that cries wolf gets switched off, which is how the silent passes come back.
{
  try {
    edit(NOTE_EDITOR, (s) => {
      // Re-anchored for Category D, as above.
      const anchor =
        "    return renderTrustedHtml(this.sanitizer, raw, { ADD_ATTR: ['target', 'rel'] });";
      if (!s.includes(anchor))
        throw new Error('note-editor.ts markdownHtml changed — update this control');
      return s.replace(
        anchor,
        '    const notAPattern = { bypassSecurityTrustHtml: (v: string) => v };\n' +
          '    void notAPattern;\n' +
          anchor,
      );
    });
    const { code, out } = runAudit(['--only', '1']);
    const quiet = code === 0;
    results.push({
      name: 'check 1 stays silent for an object literal used as a value rather than as a pattern',
      pass: quiet,
      red: !quiet,
      matched: true,
      expect: 'no finding for a non-pattern object literal that names the member',
      out,
      kind: 'specificity',
    });
  } finally {
    restoreAll();
  }
}

// ---- check 1: two bypasses sharing one source line -----------------------------------------------
// The collector deduplicated by `${line}:${name}`, so two calls to the same member written on one
// line counted as one. That is not cosmetic: the count is compared against the entry's declared
// `calls`, summed into the category budget, and ratcheted per member against the merge base, so a
// bypass hidden on an existing line evaded all three at once.
//
// This adds a FOURTH `bypassSecurityTrustHtml` to `highlightExcerpt`, whose entry declares 3, on the
// line that already holds one. Verified against 2f860a1: `--only 1` printed
// "PASS — 31 bypass call(s), all accounted for" — the total unchanged with four bypasses in a member
// declared to hold three. Deduplication is by AST node position now, so formatting cannot merge two.
control(
  'check 1 counts two bypasses written on the same source line as two',
  1,
  () =>
    edit(
      'libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.ts',
      (s) => {
        // Re-anchored for Category D: highlightExcerpt's three inline bypasses now go through
        // `renderTrustedHtml`. The control still needs two bypasses on ONE source line, so it
        // injects them rather than duplicating an existing call.
        const anchor =
          '      return renderTrustedHtml(this.sanitizer, this.escapeHtml(text), allowMarkOnly);\n    }\n\n    const matchIndex';
        if (!s.includes(anchor))
          throw new Error('highlightExcerpt changed shape — update this control');
        return s.replace(
          anchor,
          '      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(text)) ?? this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(text));\n    }\n\n    const matchIndex',
        );
      },
    ),
  'sanitizer-audit: FAIL — 2 finding(s)',
);

// ---- check 1: element access whose index is a constant rather than a literal ---------------------
// The control above covers the literal spelling. `accessedMemberName` deliberately stopped there,
// on the stated grounds that resolving a computed index "would be the syntactic guessing this file
// has been burned by" and that nothing was silently admitted because "check 5's indirect-reference
// finding still fires on the reference that produced `name`".
//
// The first is backwards — asking `getTypeAtLocation` for a string-literal type is the compiler
// answering, which is what closed the alias class in check 4 — and the second is simply not true:
// `M` is a string, not a reference to the member, so there is no indirect read for check 5 to see.
// Verified against the pre-fix script with raw markdown handed to it: checks 1, 3 and 5 each
// printed "PASS — 31 bypass call(s), all accounted for".
control(
  'check 1 catches a bypass whose element-access index is a string constant',
  1,
  () =>
    edit(NOTE_EDITOR, (s) => {
      const anchor = NOTE_EDITOR_ANCHOR;
      if (!s.includes(anchor))
        throw new Error('note-editor.ts markdownHtml changed — update this control');
      return s.replace(
        anchor,
        `    const BYPASS_KEY = 'bypassSecurityTrustHtml';\n` +
          `    if (raw === '__selftest__') {\n` +
          `      return this.sanitizer[BYPASS_KEY](raw);\n` +
          `    }\n` +
          anchor,
      );
    }),
  'unregistered bypass  libs/features/document-detail/src/lib/note-editor/note-editor.ts',
);

control(
  'check 5 checks the pairing of a bypass whose index is a string constant',
  5,
  // Being counted is not being checked, and this is the half that matters: the argument is `raw`,
  // the user-authored markdown, not the DOMPurify output. A bypass check 5 cannot see is stored XSS
  // with the gate green.
  () =>
    edit(NOTE_EDITOR, (s) =>
      s.replace(
        NOTE_EDITOR_ANCHOR,
        `    const BYPASS_KEY = 'bypassSecurityTrustHtml';\n` +
          `    if (raw === '__selftest__') {\n` +
          `      return this.sanitizer[BYPASS_KEY](raw);\n` +
          `    }\n` +
          NOTE_EDITOR_ANCHOR,
      ),
    ),
  'unsanitised trusted HTML',
);

// ---- check 1: element access whose member cannot be named at all ---------------------------------
// Resolving a constant index covers `as const` and an explicit literal type, but `let` widens to
// `string`, so there is no literal type for the checker to return — and no separate property read
// for check 5's indirect finding to see either. "It would not compile" is not a defence available
// here: `createTypeProgram` loads `tsconfig.base.json`, which sets neither `strict` nor
// `noImplicitAny` (the libraries turn `strict` on in their own tsconfigs), so indexing
// `DomSanitizer` with a `string` is an error to `nx build` and not an error to this audit's checker.
//
// So the object's type is the backstop: an element access on a `DomSanitizer` whose member does not
// resolve is reported, because a member this cannot name cannot be registered, categorised,
// budgeted or paired.
control(
  'check 1 reports a DomSanitizer element access whose member it cannot name',
  1,
  () =>
    edit(NOTE_EDITOR, (s) => {
      const anchor = NOTE_EDITOR_ANCHOR;
      if (!s.includes(anchor))
        throw new Error('note-editor.ts markdownHtml changed — update this control');
      return s.replace(
        anchor,
        `    let key = 'bypassSecurityTrustHtml';\n` +
          `    if (raw === '__selftest__') {\n` +
          `      return this.sanitizer[key](raw);\n` +
          `    }\n` +
          anchor,
      );
    }),
  'unnameable DomSanitizer member',
);

// ---- check 1: computed destructuring, the same evasion one syntax along -------------------------
// Element access and destructuring each had their own copy of the key-naming logic, and only the
// element-access one was taught to resolve a constant. So closing `sanitizer[key](raw)` left
// `const key = 'bypassSecurityTrustHtml' as const; const { [key]: trust } = sanitizer; trust(raw)`
// wide open — verified: checks 1 and 5 both printed "PASS — 31 bypass call(s), all accounted for".
// One shared `keyExpressionName` now answers for both, so the next spelling cannot be closed in one
// place and left open in the other.
control(
  'check 1 counts a bypass destructured under a computed constant key',
  1,
  () =>
    edit(NOTE_EDITOR, (s) => {
      const anchor = NOTE_EDITOR_ANCHOR;
      if (!s.includes(anchor))
        throw new Error('note-editor.ts markdownHtml changed — update this control');
      return s.replace(
        anchor,
        `    const key = 'bypassSecurityTrustHtml' as const;\n` +
          `    const { [key]: trust } = this.sanitizer;\n` +
          `    if (raw === '__selftest__') {\n` +
          `      return trust(raw);\n` +
          `    }\n` +
          anchor,
      );
    }),
  'unregistered bypass  libs/features/document-detail/src/lib/note-editor/note-editor.ts',
);

control(
  'check 1 reports a DomSanitizer destructuring whose computed key it cannot name',
  1,
  // `let` widens to `string`, so there is no literal type to resolve and no member name to record.
  // The local it binds could be any member of the sanitizer, so it reports rather than assuming.
  () =>
    edit(NOTE_EDITOR, (s) =>
      s.replace(
        NOTE_EDITOR_ANCHOR,
        `    let key = 'bypassSecurityTrustHtml';\n` +
          `    const { [key]: trust } = this.sanitizer;\n` +
          `    if (raw === '__selftest__') {\n` +
          `      return trust(raw);\n` +
          `    }\n` +
          NOTE_EDITOR_ANCHOR,
      ),
    ),
  'unnameable DomSanitizer member',
);

// ---- check 4: a same-named member on another class in the file ----------------------------------
// Check 4 used to resolve a template expression against "whichever class in the file resolves the
// path first". One valid file defeats that: declare a class ahead of the component with a same-named
// member of a plain type, and the component's own `SafeResourceUrl` member is never consulted.
// Verified red before the fix — the audit printed PASS on a live defect.
control(
  'check 4 resolves against the component that owns the template, not another class in the file',
  4,
  () => {
    edit(VIEWER_TS, (s) => {
      const next = s.replace(
        'readonly posterUrl = input<string | null>(null);',
        'readonly posterUrl = input<SafeResourceUrl | null>(null);',
      );
      if (next === s) throw new Error('document-viewer posterUrl changed — update this control');
      // Declared BEFORE the component, so a first-match-wins resolver reaches it first.
      return next.replace(
        'export interface VideoSource {',
        'export class PosterDecoy {\n  readonly posterUrl = (): string | null => null;\n}\n\nexport interface VideoSource {',
      );
    });
  },
  'Safe* value in a NONE context',
);

// ---- check 1: destructuring under a quoted property name ----------------------------------------
// `{ bypassSecurityTrustHtml }` carries no `propertyName`, so matching the bound name was right for
// it. `{ 'bypassSecurityTrustHtml': trust }` does carry one, and the identifier-only test fell
// through to the bound name — reading the local alias `trust`, which matches nothing. Verified
// against the pre-fix script: "PASS — 31 bypass call(s), all accounted for".
control(
  'check 1 catches a bypass destructured under a quoted property name',
  1,
  () =>
    edit(NOTE_EDITOR, (s) =>
      s.replace(
        NOTE_EDITOR_ANCHOR,
        `    const { 'bypassSecurityTrustHtml': trust } = this.sanitizer;\n` +
          '    void trust;\n' +
          NOTE_EDITOR_ANCHOR,
      ),
    ),
  'unregistered bypass  libs/features/document-detail/src/lib/note-editor/note-editor.ts',
);

// ---- check 1: an entry with no written justification ---------------------------------------------
// The gate's premise is "registered *with a justification*". Keying on `file::member` alone made
// `{ "member": "loadPreview" }` sufficient, so the gate enforced bookkeeping rather than review.
control(
  'check 1 rejects an allowlist entry whose justification is blank',
  1,
  () =>
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      j.sites[CHECK1_SITE][0].justification = '';
      return JSON.stringify(j, null, 2);
    }),
  'no "justification"',
);

// ---- check 1: a justification too short to be one ------------------------------------------------
// A blank check alone is trivially defeated by typing "safe", so there is a length floor.
control(
  'check 1 rejects a placeholder justification below the length floor',
  1,
  () =>
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      j.sites[CHECK1_SITE][0].justification = 'safe';
      return JSON.stringify(j, null, 2);
    }),
  'under the 40 minimum',
);

// ---- check 1: an approved helper is not exempt from registration ---------------------------------
// Being the sanctioned place to hold a bypass is a reason to register it, not to skip registration.
// The exemption previously also skipped call counting and the budget, so a second bypass inside a
// helper would have passed silently. Simulated by pointing APPROVED_HELPERS at a real registered
// member and removing its entry: if the exemption were still in force, check 1 would stay green.
control(
  'check 1 still requires registration for an approved helper member',
  1,
  () => {
    edit(AUDIT, (s) => {
      const marker = `const APPROVED_HELPERS = new Map([`;
      if (!s.includes(marker))
        throw new Error('APPROVED_HELPERS shape changed — update this control');
      return s.replace(
        marker,
        marker + `\n  ['${DOCUMENT_DETAIL}', 'loadPreviewFallback'],`,
      );
    });
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      delete j.sites[DOCUMENT_DETAIL];
      j.budgets.C -= 2; // keep the ratchet quiet so only check 1 is under test
      return JSON.stringify(j, null, 2);
    });
  },
  'This is an approved helper, which is exactly why it needs an entry',
);

// ---- check 2: a stale allowlist entry ------------------------------------------------------------
control(
  'check 2 catches an allowlist entry whose member has no bypass',
  2,
  () =>
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      j.sites[CHECK1_SITE].push({
        member: 'aMemberThatDoesNotExist',
        category: CHECK1_CATEGORY,
        sonarKey: 'selftest',
        justification: 'selftest perturbation',
      });
      j.budgets[CHECK1_CATEGORY] += 1;
      return JSON.stringify(j, null, 2);
    }),
  `stale allowlist entry  ${CHECK1_SITE}::aMemberThatDoesNotExist`,
);

// ---- check 3: a redundant bypass on a locally-minted object URL ----------------------------------
// Category A bypasses have been deleted from the tree, so this control injects one and asserts
// check 3 still rejects it.
control(
  'check 3 catches an unrecorded bypass on a URL.createObjectURL result',
  3,
  () =>
    edit(DOCUMENT_DETAIL, (s) => {
      const anchor = '    const rawUrl = URL.createObjectURL(blob);\n';
      if (!s.includes(anchor)) {
        throw new Error('document-detail object URL anchor changed — update this control');
      }
      return s.replace(anchor, `${anchor}    this.sanitizer.bypassSecurityTrustUrl(rawUrl);\n`);
    }),
  'redundant bypass',
);

// ---- check 4: a Safe* value in a NONE context ----------------------------------------------------
// Reintroduce the historical defect: `VideoSource.url` back to `SafeResourceUrl`, which is what
// broke the transcoded-video source list. The binding is `<source [src]="src.url">` where `src` is
// a `@for` loop variable over `videoSources()`, so catching this requires resolving the loop
// variable to the iterated member, the member to `VideoSource[]`, the element type to
// `VideoSource`, and finally the `url` property — the deepest path the resolver walks. If a
// regex over the expression text were enough, this control would be unnecessary.
control(
  'check 4 catches a Safe* type reached through an interface and a @for loop variable',
  4,
  () =>
    edit('libs/shared/ui/src/lib/document-viewer/document-viewer.component.ts', (s) =>
      s.replace(/^(\s*)url: string;$/m, '$1url: SafeResourceUrl;'),
    ),
  // The specific finding, not just the file name. `[4] unresolvable type in a NONE context`
  // names the file too, so a file-name expectation is satisfied whether check 4 *resolved* the
  // type or *gave up* on it — and this control claims the former. Review caught one sibling
  // control passing through the fail-closed path for exactly that reason; the weakness was in all
  // of them, so all of them now name the finding they mean.
  'Safe* value in a NONE context',
);

// Specificity: check 4 must stay silent while doing all of its work.
//
// This used to re-run `--only 4` on the unperturbed tree and assert `document-viewer.component.html`
// was absent — which the green baseline above already implies, since exit 0 means no findings at all.
// It could not fail unless the baseline had, so it asserted nothing and inflated the tally.
//
// It now perturbs the tree so the resolver walks its longest path — `@for` loop variable, to the
// iterated member, to `VideoSource[]`, to the element type, to the `url` property, then through an
// alias — and lands on a type that is NOT `Safe*`. A check that fired here would be keying on
// "resolved a type reference" rather than on what the type resolves to, and the alias expansion added
// for the evasions above is exactly the machinery that could get that wrong.
{
  try {
    edit(VIEWER_TS, (s) =>
      s
        .replace(
          'export interface VideoSource {',
          'type PlainMediaUrl = string;\n\nexport interface VideoSource {',
        )
        .replace(/^(\s*)url: string;$/m, '$1url: PlainMediaUrl;'),
    );
    const { code, out } = runAudit(['--only', '4']);
    const quiet = code === 0 && !out.includes('document-viewer.component.html');
    results.push({
      name: 'check 4 stays silent when the alias it expands resolves to a plain string',
      pass: quiet,
      red: !quiet,
      matched: true,
      expect: 'no document-viewer finding while VideoSource.url aliases string',
      out,
      kind: 'specificity',
    });
  } finally {
    restoreAll();
  }
}

// ---- check 5: unpaired trusted HTML --------------------------------------------------------------
control(
  'check 5 catches bypassSecurityTrustHtml with no sanitiser beside it',
  5,
  () =>
    edit(HTML_HELPER, (s) => {
      // Neutralise the sanitiser call while leaving the bypass in place.
      const out = s.replace(/DOMPurify\.sanitize\(/g, 'passThroughForSelftest(');
      if (out === s)
        throw new Error('render-trusted-html.ts no longer calls DOMPurify.sanitize — update this control');
      return out;
    }),
  // Finding renamed from "unpaired" to "unsanitised" when check 5 stopped asking whether a sanitiser
  // was *nearby* and started asking whether its result actually reaches the bypass.
  'unsanitised trusted HTML  libs/shared/nuxeo-client/src/lib/utils/render-trusted-html.ts',
);

// ---- check 4: the evasions review found, each of which used to pass silently ---------------------
//
// The control above proves the resolver can walk a `@for` variable into a same-file interface. It
// cannot prove the resolver understands *types*, and it did not: review demonstrated that
// `type MediaUrl = SafeResourceUrl` reduced to the text `MediaUrl`, which `mentionsSafe` does not
// match. Each control here is one of those evasions, and each was verified red before the fix.

control(
  'check 4 sees through a local type alias',
  4,
  () =>
    edit(VIEWER_TS, (s) =>
      s
        .replace(
          'export interface VideoSource {',
          'type MediaUrl = SafeResourceUrl;\n\nexport interface VideoSource {',
        )
        .replace(
          'readonly posterUrl = input<string | null>(null);',
          'readonly posterUrl = input<MediaUrl | null>(null);',
        ),
    ),
  // The specific finding, not just the file name. `[4] unresolvable type in a NONE context`
  // names the file too, so a file-name expectation is satisfied whether check 4 *resolved* the
  // type or *gave up* on it — and this control claims the former. Review caught one sibling
  // control passing through the fail-closed path for exactly that reason; the weakness was in all
  // of them, so all of them now name the finding they mean.
  'Safe* value in a NONE context',
);

control(
  'check 4 sees through an alias imported from another file',
  4,
  () => {
    // A type declared where the component is not, reached by a real import — which is what ordinary
    // refactoring produces when a type moves into a shared models file. This is resolved through the
    // checker now, so the import has to be genuine; a bare name that does not resolve is a different
    // case, covered below.
    //
    // The alias must also be RE-EXPORTED from the package barrel. Without that step this control was
    // passing for the wrong reason: `@nuxeo/satori-platform/nuxeo-client` maps to `src/index.ts`,
    // whose export list is explicit, so the import resolved to the error type, check 4 fell back to
    // its `unresolvable type in a NONE context` finding, and that finding names the same file — which
    // satisfied a bare `document-viewer.component.html` expectation. The control therefore proved the
    // fail-closed default (already covered by its own control) and said nothing about alias
    // resolution, which is the thing it exists to assert.
    edit(
      'libs/shared/nuxeo-client/src/lib/utils/navigable-url.ts',
      (s) =>
        `${s}\nexport type CrossFileMediaUrl = import('@angular/platform-browser').SafeResourceUrl;\n`,
    );
    edit('libs/shared/nuxeo-client/src/index.ts', (s) => {
      const anchor = "} from './lib/utils/navigable-url';";
      if (!s.includes(anchor))
        throw new Error('navigable-url barrel export changed — update this control');
      return s.replace(anchor, `  type CrossFileMediaUrl,\n${anchor}`);
    });
    // Both anchors are checked: a `replace` that matches nothing leaves the alias unimported, and
    // the control then went red for the unresolvable-type reason described above.
    edit(VIEWER_TS, (s) => {
      const importAnchor = "import { TranslatePipe } from '@ngx-translate/core';";
      const inputAnchor = 'readonly posterUrl = input<string | null>(null);';
      if (!s.includes(importAnchor) || !s.includes(inputAnchor))
        throw new Error('document-viewer imports or posterUrl input changed — update this control');
      return s
        .replace(
          importAnchor,
          `${importAnchor}\nimport type { CrossFileMediaUrl } from '@nuxeo/satori-platform/nuxeo-client';`,
        )
        .replace(inputAnchor, 'readonly posterUrl = input<CrossFileMediaUrl | null>(null);');
    });
  },
  // The SPECIFIC finding, not merely the file name. `unresolvable type` would also name this file,
  // and accepting that is exactly how the control came to assert nothing.
  '[4] Safe* value in a NONE context  libs/shared/ui/src/lib/document-viewer/document-viewer.component.html',
);

control(
  'check 4 sees a NONE-context binding written with Angular bind- syntax',
  4,
  () =>
    // `bind-src="…"` is the canonical form `[src]="…"` desugars to, so it reaches the identical
    // `SecurityContext.NONE` property — but the scanner was a regex asking for the bracket spelling
    // and did not match it. `<audio bind-src="blobUrl()">` therefore bound a `SafeResourceUrl` into
    // a NONE context while check 4 stayed green; verified against the pre-fix script, which reported
    // no finding for this file. The scanner now uses Angular's own `parseTemplate`, so the two
    // spellings are indistinguishable to it by construction rather than by a wider alternation.
    edit('libs/shared/ui/src/lib/document-viewer/document-viewer.component.html', (s) => {
      const out = s.replace(
        '<audio [src]="rawBlobUrl()" controls class="viewer-audio"></audio>',
        '<audio bind-src="blobUrl()" controls class="viewer-audio"></audio>',
      );
      if (out === s) throw new Error('the audio binding changed shape — update this control');
      return out;
    }),
  'Safe* value in a NONE context',
);

// ---- check 4: template discovery must not depend on how the decorator is spelled ---------------
//
// Template discovery tested `decoratorExpr.expression.getText(sf) !== 'Component'`, so it was
// fail-open on every spelling but one. `import { Component as NgComponent } from '@angular/core';
// @NgComponent({ … })` is ordinary TypeScript and produced no template entry at all — check 4 had
// nothing to report on, and returned `PASS` on a `SafeResourceUrl` bound to `video[poster]`.
// `@ngCore.Component({ … })` was invisible the same way.
//
// Resolving the identifier to Angular's own `Component` through the checker closes those two and
// leaves the same shape of hole one step out, which the third control here is for: a decorator that
// merely *refers* to `Component` resolves to the referrer, not to Angular. So discovery does not
// establish the decorator's identity at all — `template`/`templateUrl` inside a decorator argument
// is the evidence, and any decorator qualifies. There is then no import to rename to switch the
// check off.
//
// Each control retypes `posterUrl` to `SafeResourceUrl` — a real defect, as the plain `[poster]`
// control already establishes — and changes only how the decorator is written.
const decoratorSpelling = (rewrite) => {
  edit(VIEWER_TS, (s) => {
    const retyped = s.replace(
      'readonly posterUrl = input<string | null>(null);',
      'readonly posterUrl = input<SafeResourceUrl | null>(null);',
    );
    if (retyped === s) throw new Error('document-viewer posterUrl changed — update these controls');
    const out = rewrite(retyped);
    if (out === retyped)
      throw new Error('decorator rewrite matched nothing — update these controls');
    return out;
  });
};

/** Renames the `Component` import to `NgComponent`, leaving the decorator site to the caller. */
const aliasCoreComponentImport = (s) =>
  s.replace(/import \{([^}]*)\} from '@angular\/core';/, (whole, names) =>
    whole.replace(names, names.replace('Component,', 'Component as NgComponent,')),
  );

control(
  'check 4 finds a template behind an aliased Component decorator',
  4,
  () =>
    decoratorSpelling((s) => aliasCoreComponentImport(s).replace('@Component({', '@NgComponent({')),
  'Safe* value in a NONE context',
);

control(
  'check 4 finds a template behind a namespaced Component decorator',
  4,
  () =>
    decoratorSpelling((s) =>
      s
        .replace(
          'import {\n  Component,',
          "import * as ngCore from '@angular/core';\nimport {\n  Component,",
        )
        .replace('@Component({', '@ngCore.Component({'),
    ),
  'Safe* value in a NONE context',
);

control(
  'check 4 finds a template behind a decorator that only refers to Component',
  4,
  // The case symbol resolution does not reach: `Wrapped` resolves to the local `const`, not to
  // Angular, so an identity check would skip the template. Discovery does not ask.
  () =>
    decoratorSpelling((s) =>
      aliasCoreComponentImport(s).replace(
        '@Component({',
        'const Wrapped = NgComponent;\n\n@Wrapped({',
      ),
    ),
  'Safe* value in a NONE context',
);

control(
  'check 4 reports a template Angular itself cannot parse',
  4,
  () =>
    // A template that will not parse yields no bindings, which is indistinguishable from a template
    // with none. Reported rather than skipped, for the same reason an unresolvable type is: the check
    // must not be silent precisely where it can see least.
    edit('libs/shared/ui/src/lib/document-viewer/document-viewer.component.html', (s) =>
      s.replace('<audio [src]="rawBlobUrl()"', '@if (true) {\n<audio [src]="rawBlobUrl()"'),
    ),
  'unparsable template',
);

control(
  'check 4 reports a NONE-context binding whose type it cannot resolve',
  4,
  () =>
    // `any` is the checker declining to answer, not an answer. Treating it as a resolution would
    // reinstate the silent pass: `any` is not `Safe*`, so the binding would sail through. An
    // unresolvable alias produces the error type and lands here too.
    edit(VIEWER_TS, (s) =>
      s.replace(
        'readonly posterUrl = input<string | null>(null);',
        'readonly posterUrl = input<any>(null);',
      ),
    ),
  'unresolvable type in a NONE context',
);

// ---- check 5: a decoy sanitiser must not satisfy the pairing -------------------------------------
control(
  'check 5 rejects a sanitiser whose result never reaches the bypass',
  5,
  () =>
    edit(HTML_HELPER, (s) => {
      // The DOMPurify call stays — it is the decoy. What changes is that the bypass now receives
      // raw content instead of the sanitised result. The previous check only asked whether the text
      // `DOMPurify.sanitize(` appeared in the member, so it passed on exactly this.
      const out = s.replace(
        HTML_HELPER_BYPASS,
        'return this.sanitizer.bypassSecurityTrustHtml(this.content() ?? "");',
      );
      if (out === s) {
        throw new Error('note-editor.ts no longer matches the decoy control — update it');
      }
      return out;
    }),
  'unsanitised trusted HTML',
);

// ---- check 5: the ways review showed the provenance walk could still be fooled ------------------

control(
  'check 5 rejects a function that is merely NAMED like a sanitiser',
  5,
  () =>
    // Matching the final callee name accepted any `sanitize()`. An identity function of that name
    // satisfied the guard while doing nothing — the decoy problem one level down.
    edit(HTML_HELPER, (s) =>
      s.replace(
        HTML_HELPER_BYPASS,
        'const sanitize = (v: string) => v;\n    return sanitizer.bypassSecurityTrustHtml(sanitize(html));',
      ),
    ),
  'unsanitised trusted HTML',
);

control(
  'check 5 rejects raw text spliced into a sanitised string by a transform argument',
  5,
  () =>
    // `escaped.replace(/x/, raw)` was accepted purely because the receiver was sanitised, even though
    // the replacement is attacker-controlled.
    edit(HTML_HELPER, (s) =>
      s.replace(
        HTML_HELPER_BYPASS,
        'return sanitizer.bypassSecurityTrustHtml(clean.replace("x", html));',
      ),
    ),
  'unsanitised trusted HTML',
);

control(
  'check 5 rejects an HTML bypass taken by reference rather than called',
  5,
  () =>
    // Indirect bypasses became visible to check 1, so they are registered and budgeted — but the
    // provenance walk has no argument to follow at a reference site, so being counted is not being
    // checked.
    edit(HTML_HELPER, (s) =>
      s.replace(
        HTML_HELPER_BYPASS,
        'const trust = sanitizer.bypassSecurityTrustHtml.bind(this.sanitizer);\n    return trust(clean);',
      ),
    ),
  'indirect trusted HTML',
);

control(
  'check 4 sees through a LOWERCASE type alias',
  4,
  () =>
    // Alias expansion scanned only capitalised identifiers. TypeScript permits a lowercase type name,
    // so this evaded the whole mechanism added for the capitalised case.
    edit(VIEWER_TS, (s) =>
      s
        .replace(
          'export interface VideoSource {',
          'type mediaUrl = SafeResourceUrl;\n\nexport interface VideoSource {',
        )
        .replace(
          'readonly posterUrl = input<string | null>(null);',
          'readonly posterUrl = input<mediaUrl | null>(null);',
        ),
    ),
  // The specific finding, not just the file name. `[4] unresolvable type in a NONE context`
  // names the file too, so a file-name expectation is satisfied whether check 4 *resolved* the
  // type or *gave up* on it — and this control claims the former. Review caught one sibling
  // control passing through the fail-closed path for exactly that reason; the weakness was in all
  // of them, so all of them now name the finding they mean.
  'Safe* value in a NONE context',
);

control(
  'check 5 lapses a registered sanitiser once its body is edited',
  5,
  () => {
    // The one hole a reviewed-registry design leaves: identity alone would keep accepting a helper
    // that has since been edited into a no-op. Category D moved the live bypass out of this file, so
    // the control first reintroduces a bypass whose argument flows through the *registered* sanitiser,
    // then edits that sanitiser's body to lapse the pinned review.
    edit(KD_CITATION, injectKdRegisteredSanitiserBypass);
    edit(KD_CITATION, (s) => {
      const out = s.replace(
        /private escapeHtml\(value: string\): string \{/,
        'private escapeHtml(value: string): string {\n    if (value === "") return value;',
      );
      if (out === s)
        throw new Error('kd-citation-dialog escapeHtml signature changed — update control');
      return out;
    });
  },
  'unsanitised trusted HTML  libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.ts',
);

control(
  'check 5 rejects a locally-declared renderTrustedHtml that is not the real one',
  5,
  () =>
    // Identity by callee text accepted anything named right. The real helper arrives by import; a
    // local function of the same name is by construction not it.
    edit(HTML_HELPER, (s) =>
      s.replace(
        HTML_HELPER_BYPASS,
        'const renderTrustedHtml = (v: string) => v;\n    return sanitizer.bypassSecurityTrustHtml(renderTrustedHtml(html));',
      ),
    ),
  'unsanitised trusted HTML',
);

// ---- check 5: the two fail-open paths in the provenance walk ------------------------------------
//
// Both were silent on this repository before the fix, and both hand attacker-authored markdown to
// `bypassSecurityTrustHtml` with the gate printing "PASS — 31 bypass call(s), all accounted for".
control(
  'check 5 rejects raw text appended by a compound assignment',
  5,
  // `sanitizerReaches` collected only `EqualsToken` assignments as sources of a variable, so
  // `clean += raw` was not a source at all: the walk saw the sanitised initialiser, never the
  // appended value. Every assignment operator is recorded now, and `+=` puts its right-hand side in
  // the independent set, which is the same treatment `clean = clean + raw` already received.
  () =>
    edit(HTML_HELPER, (s) => {
      // Re-pointed for Category D: the sanitise-then-bypass pairing this control perturbs now lives
      // in `renderTrustedHtml` rather than in each caller.
      const before = HTML_HELPER_SANITISE + '\n' + HTML_HELPER_BYPASS;
      if (!s.includes(before))
        throw new Error('renderTrustedHtml changed shape — update this control');
      return s.replace(
        before,
        '  let clean = DOMPurify.sanitize(html, config);\n' +
          '  clean += html;\n' +
          HTML_HELPER_BYPASS,
      );
    }),
  'unsanitised trusted HTML',
);

control(
  'check 5 does not let a same-named shadow vouch for an unsanitised parameter',
  5,
  // Sources were gathered by identifier **text** across the whole member, so any same-named
  // declaration counted. A parameter contributes no source at all, so for `trustShadowed(clean)` the
  // inner `const clean = DOMPurify.sanitize(...)` — in a branch that never runs, and whose value
  // never reaches the bypass — was the *only* source collected, and "every source is sanitised" was
  // satisfied by a value that is not the one being trusted. Sources are matched by checker symbol
  // now, so the two `clean`s are different bindings and the parameter has no source: nothing to
  // trace, nothing proven, reported.
  () =>
    edit(HTML_HELPER, (s) => {
      // Re-pointed for Category D. The shape this control needs is a member that sanitises into a
      // local and then bypasses it, which is now `renderTrustedHtml` itself. The perturbation moves
      // the bypass into a helper whose PARAMETER shadows the sanitised local's name, so a
      // text-matched source lookup would find the wrong binding.
      const before = HTML_HELPER_SANITISE + '\n' + HTML_HELPER_BYPASS;
      if (!s.includes(before))
        throw new Error('renderTrustedHtml changed shape — update this control');
      return s.replace(
        before,
        '  return trustShadowed(sanitizer, html);\n' +
          '}\n' +
          '\n' +
          'function trustShadowed(sanitizer: DomSanitizer, clean: string): SafeHtml {\n' +
          "  if (clean === '__never__') {\n" +
          "    const clean = DOMPurify.sanitize('x');\n" +
          '    void clean;\n' +
          '  }\n' +
          HTML_HELPER_BYPASS,
      );
    }),
  'unsanitised trusted HTML',
);

// ---- check 1: the reviewed-sanitiser registry must carry its own review ------------------------
//
// The `sanitisers` list is the entire basis on which check 5 admits anything, and the written
// rationale is the control — five rounds established that "this function escapes HTML" cannot be
// proven from syntax. Bypass entries have enforced a trimmed 40-character floor since the gate was
// written. This list only tested `typeof justification === 'string'`, so `""` satisfied it, while the
// comment at the call site asserted that unexplained entries were dropped.
//
// Verified before the fix on the working tree: blanking `kd-citation-dialog::escapeHtml`'s
// justification, and separately reducing it to `"safe"`, left checks 1 *and* 5 green with the helper
// still admitted as a sanitiser.
const sanitiserEntry = (mutate) =>
  edit(ALLOWLIST, (s) => {
    const j = JSON.parse(s);
    if (!Array.isArray(j.sanitisers) || j.sanitisers.length === 0) {
      throw new Error('the sanitisers registry is empty — update these controls');
    }
    mutate(j.sanitisers[0]);
    return JSON.stringify(j, null, 2);
  });

control(
  'check 1 rejects a sanitiser registry entry whose justification is blank',
  1,
  () =>
    sanitiserEntry((entry) => {
      entry.justification = '';
    }),
  'no "justification"',
);

control(
  'check 1 rejects a sanitiser registry justification below the length floor',
  1,
  // A blank check alone is defeated by typing "safe", which is the same floor bypass entries have.
  () =>
    sanitiserEntry((entry) => {
      entry.justification = 'safe';
    }),
  'under the 40 minimum',
);

control(
  'check 1 rejects a sanitiser registry entry with no pinned sha',
  1,
  // Without the hash, registration could not lapse when the helper is edited into a no-op — which is
  // the one hole a reviewed-list design otherwise leaves, and the reason the pin exists at all.
  () =>
    sanitiserEntry((entry) => {
      delete entry.sha;
    }),
  'no "sha"',
);

control(
  'check 5 stops admitting a helper whose registry entry is unusable',
  5,
  // Reporting at the registry is not enough on its own: the entry must also be *dropped*, or the
  // helper would keep vouching for the bypass while check 1 complained about the paperwork.
  () => {
    edit(KD_CITATION, injectKdRegisteredSanitiserBypass);
    sanitiserEntry((entry) => {
      entry.justification = '';
    });
  },
  'unsanitised trusted HTML  libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.ts',
);

// ---- check 4: the template value, not just the template syntax ---------------------------------
//
// `templatesFor` accepted only a literal `template`/`templateUrl`. Angular's compiler statically
// evaluates more than that, so an ordinary refactor removed a component from the audit entirely:
// moving the template to a module constant returned check 4 to `PASS` on a `SafeResourceUrl` bound
// to `video[poster]` — the gate silent on a live defect because of *where the string was written*.
//
// The value is resolved through the checker as a string-literal type, which covers a `const`, an
// `as const`, and an imported or re-exported constant. What it cannot resolve is reported, so a
// template it could not read is never mistaken for a component that has none.
const constantTemplate = (declaration) =>
  edit(VIEWER_TS, (s) => {
    const retyped = s.replace(
      'readonly posterUrl = input<string | null>(null);',
      'readonly posterUrl = input<SafeResourceUrl | null>(null);',
    );
    if (retyped === s) throw new Error('document-viewer posterUrl changed — update these controls');
    const withConst = retyped.replace('@Component({', `${declaration}\n\n@Component({`);
    const referenced = withConst.replace(
      "templateUrl: './document-viewer.component.html',",
      'template: VIEWER_TEMPLATE,',
    );
    if (referenced === withConst) {
      throw new Error('document-viewer templateUrl changed — update these controls');
    }
    return referenced;
  });

const POSTER_TEMPLATE = `'<video [poster]="posterUrl()"></video>'`;

control(
  'check 4 reads a template referenced through a constant',
  4,
  () => constantTemplate(`const VIEWER_TEMPLATE = ${POSTER_TEMPLATE};`),
  'Safe* value in a NONE context',
);

control(
  'check 4 reads a template referenced through an as-const constant',
  4,
  () => constantTemplate(`const VIEWER_TEMPLATE = ${POSTER_TEMPLATE} as const;`),
  'Safe* value in a NONE context',
);

control(
  'check 4 reports a template value it cannot resolve to a string',
  4,
  // `let` widens to `string`, so there is no literal type to read. Reported, not skipped — the same
  // fail-closed stance as an unresolvable binding type or an unparsable template.
  () => constantTemplate(`let VIEWER_TEMPLATE = ${POSTER_TEMPLATE};`),
  'unreadable template value',
);

// ---- check 4: the metadata key, not just the metadata value -------------------------------------
//
// `templatesFor` read the key with `n.name.getText(sf)`, which returns `'templateUrl'` **with the
// quotes** for a quoted key — so `@Component({ 'templateUrl': './viewer.html' })` compared unequal
// and the component was skipped entirely. Verified: with `posterUrl` retyped to `SafeResourceUrl`,
// quoting the key returned check 4 to `PASS`.
//
// The fourth fail-open spelling in this one discovery path, after the binding syntax, the decorator
// and the template value. It is fixed by reusing `assignmentPropertyName` — the resolver the bypass
// collector already uses for this exact question — rather than by normalising quotes, so a computed
// and a constant key resolve too.
const metadataKey = (spelling, prelude = '') =>
  edit(VIEWER_TS, (s) => {
    const retyped = s.replace(
      'readonly posterUrl = input<string | null>(null);',
      'readonly posterUrl = input<SafeResourceUrl | null>(null);',
    );
    if (retyped === s) throw new Error('document-viewer posterUrl changed — update these controls');
    const withPrelude = prelude
      ? retyped.replace('@Component({', `${prelude}\n\n@Component({`)
      : retyped;
    const out = withPrelude.replace(
      "templateUrl: './document-viewer.component.html',",
      `${spelling}: './document-viewer.component.html',`,
    );
    if (out === withPrelude) {
      throw new Error('document-viewer templateUrl changed — update these controls');
    }
    return out;
  });

control(
  'check 4 finds a template behind a quoted metadata key',
  4,
  () => metadataKey("'templateUrl'"),
  'Safe* value in a NONE context',
);

control(
  'check 4 finds a template behind a computed metadata key',
  4,
  () => metadataKey("['templateUrl']"),
  'Safe* value in a NONE context',
);

control(
  'check 4 finds a template behind a metadata key held in a constant',
  4,
  () => metadataKey('[TPL_KEY]', "const TPL_KEY = 'templateUrl' as const;"),
  'Safe* value in a NONE context',
);

// ---- check 4: SHORTHAND metadata ----------------------------------------------------------------
//
// `@Component({ templateUrl })` with `const templateUrl = './viewer.html'` is a
// `ShorthandPropertyAssignment`, not a `PropertyAssignment`. `templatesFor`'s predicate tested only the
// latter, so the component was skipped with no template recorded AND no unreadable-template finding —
// it read as a component that has none. Angular statically evaluates this form perfectly well.
//
// The fifth fail-open spelling in this one discovery path, after the binding syntax, the decorator, the
// template value and the quoted key. Found in review, not by this file, which is the point of adding it
// here: the four controls above cover the spellings someone thought of.
control(
  'check 4 finds a template behind a shorthand metadata property',
  4,
  () =>
    edit(VIEWER_TS, (s) => {
      const retyped = s.replace(
        'readonly posterUrl = input<string | null>(null);',
        'readonly posterUrl = input<SafeResourceUrl | null>(null);',
      );
      if (retyped === s) throw new Error('document-viewer posterUrl changed — update this control');
      const out = retyped
        .replace(
          '@Component({',
          "const templateUrl = './document-viewer.component.html';\n\n@Component({",
        )
        .replace("templateUrl: './document-viewer.component.html',", 'templateUrl,');
      if (out === retyped || !out.includes('  templateUrl,')) {
        throw new Error('document-viewer templateUrl changed — update this control');
      }
      return out;
    }),
  'Safe* value in a NONE context',
);

// ---- check 4: a Safe* type reached through INHERITANCE -------------------------------------------
//
// `typeIsSafe` resolved an alias, an import, a re-export, a generic instantiation and an array — every
// way of holding a `Safe*` value except extending one. `interface MediaUrl extends SafeResourceUrl {}`
// has its own symbol named `MediaUrl`, so the name test read it as an ordinary type and the NONE-context
// binding was never flagged, while the value still carries Angular's wrapper and still stringifies.
//
// The sixth fail-open spelling in this discovery path. Like the fifth, it came from review rather than
// from this file.
control(
  'check 4 sees a Safe* type reached through interface inheritance',
  4,
  () =>
    edit(VIEWER_TS, (s) => {
      const out = s
        .replace(
          '@Component({',
          'interface MediaUrl extends SafeResourceUrl {}\n\n@Component({',
        )
        .replace(
          'readonly posterUrl = input<string | null>(null);',
          'readonly posterUrl = input<MediaUrl | null>(null);',
        );
      if (!out.includes('interface MediaUrl') || !out.includes('input<MediaUrl | null>')) {
        throw new Error('document-viewer posterUrl changed — update this control');
      }
      return out;
    }),
  'Safe* value in a NONE context',
);

// ---- check 4: a Safe* type reached through a DEEP hierarchy ---------------------------------------
//
// The base-type walk had a depth cap that returned "not a Safe* type" on exhaustion, so a chain long
// enough to exceed it was fail-open — and the cap was documented as a deliberate exception in a file
// whose whole stance is that what it cannot determine, it reports. Cycles are now prevented by type
// identity instead, and exhausting the (much larger) cap reports as indeterminate.
//
// Seven links, which is more than the old cap of six and well within what TypeScript accepts.
control(
  'check 4 sees a Safe* type reached through a deep interface chain',
  4,
  () =>
    edit(VIEWER_TS, (s) => {
      const chain = [
        'interface MediaUrl1 extends SafeResourceUrl {}',
        'interface MediaUrl2 extends MediaUrl1 {}',
        'interface MediaUrl3 extends MediaUrl2 {}',
        'interface MediaUrl4 extends MediaUrl3 {}',
        'interface MediaUrl5 extends MediaUrl4 {}',
        'interface MediaUrl6 extends MediaUrl5 {}',
        'interface MediaUrl7 extends MediaUrl6 {}',
      ].join('\n');
      const out = s
        .replace('@Component({', `${chain}\n\n@Component({`)
        .replace(
          'readonly posterUrl = input<string | null>(null);',
          'readonly posterUrl = input<MediaUrl7 | null>(null);',
        );
      if (!out.includes('interface MediaUrl7') || !out.includes('input<MediaUrl7 | null>')) {
        throw new Error('document-viewer posterUrl changed — update this control');
      }
      return out;
    }),
  'Safe* value in a NONE context',
);

// ---- the ratchet ---------------------------------------------------------------------------------
control(
  'the ratchet rejects headroom left behind by a removal',
  null,
  () =>
    // Under-budget used to be a note. That left the slack for a later change to reintroduce a bypass
    // into without raising any budget — the ratchet slipping rather than holding.
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      j.budgets.A += 1;
      return JSON.stringify(j, null, 2);
    }),
  'but its budget is still',
);

/** The allowlist as committed, for expectations that must not be pinned to today's numbers. */
const allowlistNow = () => JSON.parse(readFileSync(join(ROOT, ALLOWLIST), 'utf8'));
const declaredCalls = (j, cat) =>
  Object.values(j.sites)
    .flat()
    .filter((e) => e.category === cat)
    .reduce((n, e) => n + (e.calls ?? 1), 0);

control(
  'the ratchet catches a category growing past its budget',
  null,
  () =>
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      j.budgets.A -= 1;
      return JSON.stringify(j, null, 2);
    }),
  // Derived, not written down. This expected `budget is 13`, which is category A's budget minus one
  // *today*; the remediation this document plans lowers that budget, so the control would have
  // started failing while the ratchet worked perfectly. Reading both numbers from the allowlist
  // asserts the whole diagnostic — more specific than the old substring, and it cannot go stale.
  (() => {
    const j = allowlistNow();
    return `category A has ${declaredCalls(j, 'A')} bypass call(s), budget is ${j.budgets.A - 1}`;
  })(),
);

// ---- the ratchet: the half that reads the merge base --------------------------------------------
//
// The four controls around this comment all perturb the *current* tree, and the ratchet's two
// merge-base comparisons were therefore never exercised: raising a budget goes red because it
// leaves headroom, and lowering one goes red because the count exceeds it — both current-tree
// invariants. Verified by stubbing out both merge-base comparisons: the selftest still reported
// `PASS — 51 negative control(s)`, so "a budget rose from the base" and "a member absorbed more
// calls than the base declared" had no control behind them at all.
//
// See `repointBaseTo` for why the base is moved rather than the tree, and for the more serious
// finding underneath: on this branch those two comparisons are not merely untested but **inert**,
// because the allowlist does not exist at the merge base for this PR.
//
// Each control below asserts the merge-base diagnostic specifically. Other findings do fire
// alongside — the ratchet is deliberately hard to violate in only one dimension, since growing a
// declared count also breaks the count-matches-code check — so the specific substring is what makes
// these controls mean anything rather than the exit code.
//
// VERIFIED, and this is what the run showed. Each merge-base comparison was stubbed out
// independently in `sanitizer-audit.mjs` and the selftest re-run:
//
//   stub the per-member comparison  ->  'the ratchet catches a member absorbing more calls…'
//                                       went red: true   matched: false
//   stub the budget comparison      ->  'the ratchet catches a budget raised above the merge base'
//                                       went red: true   matched: false
//
// `went red: true` with `matched: false` is exactly the signal that was missing. Both controls still
// exit non-zero when their own comparison is gone — a co-firing finding does that — but neither
// produces its own diagnostic, which is what proves the assertion is carried by the merge-base check
// rather than by the noise beside it. That is why these two assert a substring instead of an exit code.
//
// The caveat this replaces said their specificity was "argued, not observed". It was accurate when
// written, and review was right that leaving it while the PR described the harness as fully verified
// made the description overstate the evidence. The mutation is cheap; the honest note was not a
// substitute for running it.

control(
  'the ratchet catches a budget raised above the merge base',
  null,
  () => {
    repointBaseTo('HEAD');
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      j.budgets.A += 1;
      return JSON.stringify(j, null, 2);
    });
  },
  "category A's budget rose from",
);

control(
  'the ratchet catches a member absorbing more calls than the merge base declared',
  null,
  () => {
    repointBaseTo('HEAD');
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      // Category D consolidated `highlightExcerpt`'s three bypasses into `renderTrustedHtml`, so no
      // entry declares more than one call any more. The invariant is unchanged — a member must not
      // absorb more calls than the merge base declared — and 1 -> 2 exercises it exactly as 3 -> 4
      // did. Anchored on the helper because that is where the remaining HTML bypass lives.
      const entry = (j.sites[HTML_HELPER] ?? []).find((e) => e.member === 'renderTrustedHtml');
      const declared = entry?.calls ?? 1;
      if (!entry || declared !== 1) {
        throw new Error('renderTrustedHtml no longer declares 1 call — update this control');
      }
      entry.calls = 2;
      return JSON.stringify(j, null, 2);
    });
  },
  'declared 1 bypass call(s) at the merge base and now declares 2',
);

// The two controls above would also pass if the base were unreadable and some *other* finding
// happened to carry their text, so this asserts the plumbing they depend on: with a base that
// carries an allowlist, the audit stops saying it could not read one. That note is the tell that
// the ceiling is not being consulted, and it is printed on every run of this branch today.
{
  try {
    repointBaseTo('HEAD');
    const { out } = runAudit();
    const read = !out.includes('could not read budgets at the merge base');
    results.push({
      name: 'the merge-base ceiling is read when the base carries an allowlist',
      pass: read,
      red: !read,
      matched: true,
      expect: 'no "could not read budgets at the merge base" note',
      out,
      kind: 'specificity',
    });
  } finally {
    restoreAll();
  }
}

control(
  'the ratchet cannot be removed by deleting the budgets object',
  null,
  () =>
    // `Object.entries(raw.budgets ?? {})` iterated nothing, so deleting the key turned the ceiling
    // off and the gate stayed green. Removing a ratchet must be louder than lowering it.
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      delete j.budgets;
      return JSON.stringify(j, null, 2);
    }),
  "has no 'budgets' object",
);

control(
  'the ratchet rejects a category with no numeric budget',
  null,
  () =>
    edit(ALLOWLIST, (s) => {
      const j = JSON.parse(s);
      delete j.budgets.D;
      return JSON.stringify(j, null, 2);
    }),
  'category D has no numeric budget',
);

// ---- report -------------------------------------------------------------------------------------
// The row kinds are reported separately on purpose. Only `negative` rows are negative controls —
// they perturb the tree and assert the audit goes red for a named reason. `baseline` rows assert
// GREEN, and `specificity` asserts silence; both are necessary context but neither is evidence that
// a check can fail. Collapsing all three into one total reads as "N checks proven able to fail",
// which is the "evidence must assert the claim, not the pulse" failure `CLAUDE.md` warns about —
// and this summary previously did exactly that, reporting 13 as though all 13 were red-on-purpose.
const KIND_LABEL = {
  negative: 'RED-ON-PURPOSE',
  baseline: 'baseline (green)',
  specificity: 'silence',
};
console.log('\nsanitizer-audit selftest\n');
let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  [${KIND_LABEL[r.kind]}]  ${r.name}`);
  if (!r.pass) {
    failed += 1;
    console.log(`        expected: ${r.expect}`);
    console.log(`        went red: ${r.red}   matched: ${r.matched}`);
    console.log(
      r.out
        .split('\n')
        .map((l) => `        | ${l}`)
        .join('\n'),
    );
  }
}
const tally = (k) => results.filter((r) => r.kind === k).length;
const negatives = tally('negative');

console.log('');
if (failed > 0) {
  console.log(
    `selftest: FAIL — ${failed} of ${results.length} assertions did not behave as expected.`,
  );
  console.log('A check that cannot be made to fail is decoration. Fix the check, not the control.');
  process.exit(1);
}
console.log(
  `selftest: PASS — ${negatives} negative control(s) observed red on purpose; ` +
    `${tally('baseline')} green baseline(s) and ${tally('specificity')} silence assertion(s) as context. ` +
    `${results.length} assertions total.`,
);
console.log(
  '  Only the negative controls prove a check can fail. The baselines assert green and are not evidence of that.',
);
