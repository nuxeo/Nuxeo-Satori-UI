#!/usr/bin/env node
/**
 * Beta phase evidence runner.
 *
 * Runs the steps file for one Beta phase against a live dev server, capturing
 * a screenshot and a pass/fail record for every step, then writes a machine
 * readable manifest and a human readable index with the images embedded.
 *
 * Usage:
 *   node scripts/beta-harness/phase-runner.mjs <phase-id> [steps-file]
 *
 * Examples:
 *   node scripts/beta-harness/phase-runner.mjs phase-0-baseline
 *   node scripts/beta-harness/phase-runner.mjs phase-3-document-list custom/steps.mjs
 *
 * Output: $EVIDENCE_ROOT/beta/<phase-id>/<timestamp>/
 *   NN-*.png      screenshots, numbered by step
 *   *.webm        video of the whole run
 *   manifest.json steps, checks, environment, screenshot audit, verdict
 *   INDEX.md      narrative report with the images inlined
 *
 * Exit code is 1 when any check failed, so the iteration loop in the
 * `beta-phase` skill can treat a phase as incomplete and retry.
 *
 * Environment:
 *   NUXEO_USER / NUXEO_PASS        required, with no default, by every steps file
 *                                  that does not export `skipHttpCredentials = true`.
 *                                  Missing, the run stops before launching a browser
 *                                  and exits 2 (precondition not met).
 *   EVIDENCE_STRICT_SCREENSHOTS=1  fail the run if any two screenshots are
 *                                  byte-identical, not just if they all are
 *   EVIDENCE_ENSURE_BACKEND=1      bring the Nuxeo Docker stack up first and wait
 *                                  for the REST API, instead of capturing into a
 *                                  dead backend. Opt-in, because starting
 *                                  containers is a side effect a capture should
 *                                  not have by surprise — and because
 *                                  `phase-0-no-backend` needs the opposite.
 */

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';
import { createHelpers } from './helpers.mjs';
import { missingNuxeoCredentialsMessage, readNuxeoCredentials } from './nuxeo-credentials.mjs';

/**
 * Exit codes, because the three outcomes need three different responses:
 *   0  pass — done
 *   1  fail or error — iterate, this is a defect
 *   2  precondition not met — do NOT iterate; fix the environment or run a
 *      different steps file. Iterating here changes working code to satisfy a
 *      steps file that was never applicable.
 */
const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_PRECONDITION = 2;

const [, , phaseId, stepsArg] = process.argv;

if (!phaseId) {
  console.error('Usage: node scripts/beta-harness/phase-runner.mjs <phase-id> [steps-file]');
  process.exit(1);
}

const stepsFile = stepsArg
  ? isAbsolute(stepsArg)
    ? stepsArg
    : resolve(process.cwd(), stepsArg)
  : resolve(import.meta.dirname, 'steps', `${phaseId}.mjs`);

/**
 * The steps module is loaded before anything is launched, so the runner can read what it
 * declares about credentials. A failed import is held, not thrown: it is re-raised inside the
 * run below, so it reaches the same verdict path as before — `precondition-not-met` for a
 * `PreconditionError`, `error` for anything else — with a manifest.
 *
 * It is also said straight away. Whatever this run reports next — a missing Playwright, the
 * backend preflight — the reader already knows the steps never loaded, and a mistyped phase id
 * reads as one.
 */
let stepsModule = null;
let stepsImportError = null;
try {
  stepsModule = await import(pathToFileURL(stepsFile).href);
} catch (err) {
  stepsImportError = err;
  const label = err instanceof Error && err.name === 'PreconditionError' ? 'precondition' : 'error';
  console.error(
    `\n[${label}] the steps file did not load: ${err instanceof Error ? err.message : String(err)}\n` +
      `  ${stepsFile}`,
  );
}

/**
 * Nuxeo credentials, from the environment with **no** default (NXSAT-649).
 *
 * This read `process.env['NUXEO_USER'] ?? 'Administrator'` for both halves, which
 * `.cursor/rules/security.mdc` forbids: a working Basic pair in the repository, and a run that
 * silently captured as an administrator whenever the variables were unset.
 *
 * Not every steps file needs a backend. `phase-0-no-backend` asserts there is none and
 * `phase-4-platform` runs against a static build; neither should be refused for lacking a pair
 * it never sends. A steps file says so with `export const skipHttpCredentials = true` — the
 * opt-out `scripts/collect-evidence/story-runner.mjs` already reads — and then runs with no
 * `httpCredentials` at all, set or not, so its result does not depend on the shell. Everything
 * else requires the pair and is refused here, before a browser is launched or an evidence
 * folder created, rather than partway through the run at the first `h.login()`.
 *
 * A steps file that did not load is not refused here. Its steps will never run, so it sends
 * nothing and goes on to its held error's own verdict. Refusing it reported a mistyped phase id
 * as `[precondition] NUXEO_USER and NUXEO_PASS must both be set` — exit 2, "not something to
 * iterate on" — with no word that the file did not exist, which is what review found it doing.
 */
const stepsLoaded = stepsImportError === null;
const skipHttpCredentials = stepsModule?.skipHttpCredentials === true;
const needsCredentials = stepsLoaded && !skipHttpCredentials;
const credentials = needsCredentials ? readNuxeoCredentials() : null;
if (needsCredentials && !credentials) {
  console.error(
    `\n[precondition] ${missingNuxeoCredentialsMessage(`run the ${phaseId} evidence steps`)}\n\n` +
      '  This is NOT a defect and NOT something to iterate on. A steps file that needs no\n' +
      '  backend may export `skipHttpCredentials = true` and run without them.\n',
  );
  process.exit(EXIT_PRECONDITION);
}

// After the credentials, not before: both are environment checks, and that one needs no
// dependency, so it is reached — and reported as exit 2 — on a machine without Playwright too.
let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error(
    '\nPlaywright is required to capture evidence but is not installed.\n' +
      'It is intentionally not a tracked dependency, so CI installs stay unaffected.\n\n' +
      '  npm install --no-save @playwright/test\n' +
      '  npx playwright install chromium\n',
  );
  process.exit(1);
}

const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(EVIDENCE_ROOT, 'beta', phaseId, stamp);
await mkdir(outDir, { recursive: true });

// Not for a steps file that did not load: there are no steps to bring a backend up for, and the
// preflight refusing for credentials would bury the load error under an exit 2.
if (process.env['EVIDENCE_ENSURE_BACKEND'] === '1' && stepsLoaded) {
  const { spawnSync } = await import('node:child_process');
  console.log('\nEnsuring the Nuxeo backend is up before capturing…');
  const pf = spawnSync('node', [resolve(import.meta.dirname, 'backend-preflight.mjs')], { stdio: 'inherit' });
  if (pf.status !== 0) {
    console.error(
      '\nAborting before the capture. A run against a dead backend produces a page of\n' +
        'selector failures that look like component defects; that is worse than no evidence.',
    );
    // The preflight's own exit 2 is a missing NUXEO_USER/NUXEO_PASS — reachable here only for a
    // `skipHttpCredentials` steps file, since every other loaded one was refused above. Passed
    // through as a precondition rather than flattened into 1, which would read as a defect.
    process.exit(pf.status === EXIT_PRECONDITION ? EXIT_PRECONDITION : EXIT_FAIL);
  }
}

const baseUrl = process.env['APP_URL'] ?? 'http://localhost:4200';
console.log(`\nBeta phase evidence: ${phaseId}`);
console.log(`  steps  ${stepsFile}`);
console.log(`  app    ${baseUrl}`);
console.log(`  out    ${outDir}`);

/** @type {{ steps: import('./helpers.mjs').StepRecord[], consoleErrors: string[] }} */
const recorder = { steps: [], consoleErrors: [] };

const browser = await chromium.launch({
  headless: process.env['EVIDENCE_HEADLESS'] === '1',
  slowMo: Number(process.env['EVIDENCE_SLOWMO'] ?? 300),
});

// `httpCredentials` guarantees Basic auth on every request to the app origin.
// Injecting a session into sessionStorage (see helpers.login) satisfies the route
// guard so pages render, but does not reliably authenticate XHRs — that surfaces as
// intermittent 403s on /nuxeo/api paths and screenshots of empty or error states.
// Omitted only for a `skipHttpCredentials` steps file; see the credentials block above.
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
  ...(credentials
    ? {
        httpCredentials: {
          username: credentials.username,
          password: credentials.password,
          origin: baseUrl,
        },
      }
    : {}),
});

const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // The browser's own "Failed to load resource" message carries no URL, so it is
  // useless for deciding whether a failure matters. The response listener below
  // records the same failures with their path, so drop the duplicate.
  if (text.startsWith('Failed to load resource')) return;
  recorder.consoleErrors.push(text.slice(0, 300));
});
page.on('pageerror', (err) => {
  recorder.consoleErrors.push(`uncaught: ${String(err.message).slice(0, 300)}`);
});
page.on('response', (res) => {
  if (res.status() < 400) return;
  let path = res.url();
  try {
    path = new URL(path).pathname;
  } catch {
    /* keep the raw url */
  }
  recorder.consoleErrors.push(`HTTP ${res.status()} ${path}`);
});

const helpers = createHelpers(page, outDir, recorder);

let runError = null;
let preconditionFailure = null;
try {
  if (stepsImportError) throw stepsImportError;
  const runSteps = stepsModule?.default;
  if (typeof runSteps !== 'function') {
    throw new Error(`${stepsFile} must export a default async function(page, helpers, outDir)`);
  }
  await runSteps(page, helpers, outDir);
} catch (err) {
  if (err instanceof Error && err.name === 'PreconditionError') {
    preconditionFailure = err.message;
    console.error(`\n[precondition] ${preconditionFailure}`);
  } else {
    runError = err instanceof Error ? err.message : String(err);
    console.error(`\n[error] steps aborted: ${runError}`);
  }
} finally {
  await page.waitForTimeout(600);
  await context.close(); // flushes the video
  await browser.close();
}

const video = (await readdir(outDir)).find((f) => f.endsWith('.webm')) ?? null;

const screenshotAudit = await auditScreenshots(recorder.steps, outDir);
// A run that aborted on its precondition has no meaningful visual record to judge.
if (!preconditionFailure) recordScreenshotAudit(screenshotAudit, recorder);

const totalChecks = recorder.steps.reduce((n, s) => n + s.checks.length, 0);
const failedChecks = recorder.steps.flatMap((s) =>
  s.checks.filter((c) => !c.passed).map((c) => ({ step: s.index, label: s.label, ...c })),
);
const verdict = preconditionFailure
  ? 'precondition-not-met'
  : runError
    ? 'error'
    : failedChecks.length === 0 && totalChecks > 0
      ? 'pass'
      : 'fail';

const manifest = {
  phase: phaseId,
  verdict,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  environment: {
    appUrl: baseUrl,
    // The identity the run actually used, or null when it sent none. This recorded
    // `Administrator` for a run with the variables unset, which was true only because the
    // runner had invented the pair.
    nuxeoUser: credentials?.username ?? null,
    node: process.version,
    stepsFile,
  },
  totals: { steps: recorder.steps.length, checks: totalChecks, failed: failedChecks.length },
  ...(runError ? { error: runError } : {}),
  ...(preconditionFailure ? { preconditionFailure } : {}),
  screenshotAudit,
  video,
  steps: recorder.steps,
  consoleErrors: recorder.consoleErrors,
};

await writeFile(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(resolve(outDir, 'INDEX.md'), renderIndex(manifest), 'utf8');

console.log(`\nverdict  ${verdict.toUpperCase()}  (${totalChecks - failedChecks.length}/${totalChecks} checks passed)`);
if (preconditionFailure) {
  console.log(
    `\nThis is NOT a defect and NOT something to iterate on. The steps file states a\n` +
      `precondition that does not hold in this environment:\n\n  ${preconditionFailure}\n\n` +
      `Fix the environment, or run the steps file that matches it. Do not change\n` +
      `application code to make this run go green.`,
  );
}
if (failedChecks.length) {
  console.log('failed checks:');
  for (const c of failedChecks) {
    console.log(`  step ${c.step} "${c.label}" -> ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
  }
}
if (totalChecks === 0 && !runError) {
  console.log('No checks were recorded. A capture that asserts nothing does not count as evidence.');
}
if (screenshotAudit.duplicateGroups.length) {
  console.log(
    `\nscreenshots  ${screenshotAudit.unique} unique of ${screenshotAudit.total} — ${screenshotAudit.duplicated} are byte-identical to another shot in this run:`,
  );
  for (const g of screenshotAudit.duplicateGroups) {
    console.log(`  ${g.digest}  ${g.files.join(', ')}`);
  }
  console.log(
    '  Each of those filenames claims a distinct observation the image cannot support.\n' +
      '  Either differentiate what is on screen, or rename the shot to what it actually shows.',
  );
}
console.log(`\nreport   ${resolve(outDir, 'INDEX.md')}`);

process.exit(verdict === 'pass' ? EXIT_PASS : preconditionFailure ? EXIT_PRECONDITION : EXIT_FAIL);

/**
 * Hash every screenshot and group the byte-identical ones.
 *
 * The evidence corpus is full of these and nothing surfaced them: one *passing*
 * `phase-0-no-backend` run has five differently-named screenshots that are one
 * image, and a Phase 2 closure bundle presented 16 shots that were 10 pictures —
 * including `07-manifest-relabels-nav.png`, which is byte-identical to the
 * default-manifest shot and shows a collapsed icon rail with no labels at all.
 * A reviewer counting images in INDEX.md reads sixteen observations and gets ten.
 *
 * Duplicates are not automatically wrong — a "malformed config falls back to the
 * packaged surface" step *should* look like the default. But then the image
 * carries no discriminating information while its filename implies it does, and
 * that trade-off deserves to be stated rather than hidden.
 *
 * **`unique` is a lower bound on duplication, not a count of distinct
 * observations.** Byte-identity has no false positives — two equal digests are
 * genuinely the same image — but it under-reports badly. The pilot capture reported
 * 6 unique of 6 while two of those PNGs were visually indistinguishable, at 66415
 * against 66416 bytes: one byte apart from a sub-pixel rendering difference. A clean
 * audit therefore does **not** license the claim that every shot shows something
 * new; only the flagged groups are load-bearing. A perceptual or structural hash
 * would be the stronger tool, and this is not one.
 *
 * @param {import('./helpers.mjs').StepRecord[]} steps
 * @param {string} dir
 */
async function auditScreenshots(steps, dir) {
  /** @type {{ file: string, step: number, digest: string, bytes: number }[]} */
  const shots = [];
  for (const s of steps) {
    for (const file of s.screenshots) {
      try {
        const buf = await readFile(resolve(dir, file));
        shots.push({
          file,
          step: s.index,
          digest: createHash('sha256').update(buf).digest('hex').slice(0, 12),
          bytes: buf.length,
        });
      } catch {
        // A screenshot the run claims but did not write is itself worth recording.
        shots.push({ file, step: s.index, digest: 'missing', bytes: 0 });
      }
    }
  }

  /** @type {Map<string, string[]>} */
  const byDigest = new Map();
  for (const s of shots) {
    if (s.digest === 'missing') continue;
    byDigest.set(s.digest, [...(byDigest.get(s.digest) ?? []), s.file]);
  }

  const duplicateGroups = [...byDigest.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([digest, files]) => ({ digest, files }))
    .sort((a, b) => b.files.length - a.files.length);

  const duplicated = duplicateGroups.reduce((n, g) => n + g.files.length, 0);
  const total = shots.filter((s) => s.digest !== 'missing').length;

  return {
    total,
    unique: byDigest.size,
    duplicated,
    missing: shots.filter((s) => s.digest === 'missing').map((s) => s.file),
    strict: process.env['EVIDENCE_STRICT_SCREENSHOTS'] === '1',
    shots,
    duplicateGroups,
  };
}

/**
 * Fold the audit into the ordinary check machinery, so a worthless visual record
 * fails in the same place as everything else rather than in a footnote.
 *
 * The bar is deliberately low by default — it fails only when the whole run
 * collapses to a single image, which cannot be a legitimate outcome for a
 * multi-step capture. `EVIDENCE_STRICT_SCREENSHOTS=1` raises it to "no duplicates
 * at all", for a phase whose steps each claim a distinct visual observation.
 *
 * @param {Awaited<ReturnType<typeof auditScreenshots>>} audit
 * @param {{ steps: import('./helpers.mjs').StepRecord[] }} rec
 */
function recordScreenshotAudit(audit, rec) {
  if (audit.total === 0 && audit.missing.length === 0) return;

  const collapsed = audit.total > 1 && audit.unique === 1;
  const passed = audit.missing.length === 0 && !collapsed && !(audit.strict && audit.duplicateGroups.length > 0);

  const detail = audit.missing.length
    ? `${audit.missing.length} screenshot(s) recorded but not written: ${audit.missing.join(', ')}`
    : collapsed
      ? `all ${audit.total} screenshots are the same image (${audit.duplicateGroups[0].digest}); the visual record proves nothing`
      : `${audit.duplicated} of ${audit.total} screenshots are byte-identical to another (strict mode)`;

  rec.steps.push({
    index: rec.steps.length + 1,
    label: 'Screenshot audit (automatic)',
    screenshots: [],
    checks: [
      {
        name: `screenshots carry discriminating information (${audit.unique} unique of ${audit.total})`,
        passed,
        ...(passed ? {} : { detail }),
      },
    ],
  });
}

/**
 * Render the human readable report, with screenshots inlined so it can be
 * pasted into a PR description or attached to a Confluence page.
 * @param {typeof manifest} m
 */
function renderIndex(m) {
  const lines = [
    `# Evidence: ${m.phase}`,
    '',
    `**Verdict:** ${m.verdict.toUpperCase()} — ${m.totals.checks - m.totals.failed}/${m.totals.checks} checks passed across ${m.totals.steps} steps`,
    '',
    `- Started: ${m.startedAt}`,
    `- App: ${m.environment.appUrl}`,
    `- Steps file: \`${m.environment.stepsFile}\``,
    ...(m.video ? [`- Video: \`${m.video}\``] : []),
    '',
  ];

  if (m.preconditionFailure) {
    lines.push(
      '> **Precondition not met — this is not a defect.**',
      '>',
      `> ${m.preconditionFailure}`,
      '>',
      '> The steps file states an environment it requires, and that environment does not',
      '> hold here. Fix the environment or run the steps file that matches it. Do **not**',
      '> change application code to make this run go green, and do not read the failed',
      '> check below as a finding.',
      '',
    );
  }

  if (m.error) {
    // Prefix every line so a multi-line stack stays inside the blockquote.
    const quoted = m.error.split('\n').map((l) => `> ${l}`);
    lines.push('> **The run aborted before completing all steps.**', '>', ...quoted, '');
  }

  if (m.totals.failed > 0) {
    lines.push('## Failed checks', '');
    for (const s of m.steps) {
      for (const c of s.checks.filter((x) => !x.passed)) {
        lines.push(`- Step ${s.index} (${s.label}) — **${c.name}**${c.detail ? `: ${c.detail}` : ''}`);
      }
    }
    lines.push('');
  }

  lines.push('## Steps', '');
  for (const s of m.steps) {
    const failed = s.checks.filter((c) => !c.passed).length;
    const status = s.checks.length === 0 ? 'no checks' : failed === 0 ? 'pass' : `${failed} failed`;
    lines.push(`### ${s.index}. ${s.label}  _(${status})_`, '');
    for (const c of s.checks) {
      lines.push(`- ${c.passed ? '[pass]' : '[FAIL]'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    // Stated limitations, deliberately not counted as checks.
    for (const n of s.notes ?? []) lines.push(`- _not covered:_ ${n}`);
    if (s.checks.length || (s.notes ?? []).length) lines.push('');
    for (const shot of s.screenshots) {
      lines.push(`![${s.label} — ${shot}](./${shot})`, '');
    }
  }

  const a = m.screenshotAudit;
  if (a && (a.total > 0 || a.missing.length > 0)) {
    lines.push(
      '## Screenshot audit',
      '',
      `${a.unique} unique image(s) across ${a.total} screenshot(s).`,
      '',
    );
    if (a.missing.length) {
      lines.push(`**Missing:** ${a.missing.map((f) => `\`${f}\``).join(', ')} — recorded but never written.`, '');
    }
    if (a.duplicateGroups.length) {
      lines.push(
        `**${a.duplicated} screenshot(s) are byte-identical to another shot in this run.** Each filename below`,
        'claims a distinct observation that a single shared image cannot support. Some of these are legitimate —',
        'a fallback surface *should* look like the default — but in those cases the image carries no',
        'discriminating information, so the assertion has to come from the DOM checks, not the picture.',
        '',
        '| Digest | Screenshots sharing it |',
        '| --- | --- |',
        ...a.duplicateGroups.map((g) => `| \`${g.digest}\` | ${g.files.map((f) => `\`${f}\``).join(', ')} |`),
        '',
      );
    } else {
      lines.push('Every screenshot is a distinct image.', '');
    }
  }

  if (m.consoleErrors.length) {
    lines.push('## Browser console errors', '');
    for (const e of m.consoleErrors.slice(0, 20)) lines.push(`- \`${e}\``);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
