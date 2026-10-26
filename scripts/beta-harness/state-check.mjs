#!/usr/bin/env node
/**
 * Verify `.ai/state/phases.json` against the evidence actually on disk.
 *
 * This is the anti-false-completion control. Phase 1 was recorded complete — in
 * prose, in section 3 of `AGENTS/11-beta-program.md`, and used to downgrade a risk
 * — while its upgrade-safe config path was wrong by one segment and "would have
 * 404'd on every install". Nothing mechanically connected the claim to an artifact.
 *
 * Now a phase may be `complete` only if its cited manifest exists and says `pass`.
 * A missing manifest, a `fail`, a `precondition-not-met`, or a manifest with zero
 * checks all make the claim unsupported and this gate red.
 *
 * `manifest: "<phase-dir>/latest"` resolves to the newest timestamped run in that
 * directory, so the state file does not need editing after every capture. That is
 * deliberate: a stamp nobody updates becomes a lie quietly, whereas `latest`
 * degrades loudly the moment the newest run stops passing.
 *
 * Usage:
 *   node scripts/beta-harness/state-check.mjs [--json]
 *
 * Exit 1 if any phase claims more than the evidence supports.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const asJson = process.argv.includes('--json');
// `--state <path>` exists so the gate's own failure modes can be exercised against
// fixtures. A gate nobody has watched go red is not evidence.
const stateArg = process.argv[process.argv.indexOf('--state') + 1];
const statePath =
  process.argv.includes('--state') && stateArg
    ? resolve(process.cwd(), stateArg)
    : resolve(repoRoot, '.ai/state/phases.json');
const betaRoot = resolve(EVIDENCE_ROOT, 'beta');

/** A phase claiming one of these must have a passing manifest behind it. */
const EVIDENCE_REQUIRED = new Set(['complete', 'complete-with-deviations']);

/**
 * How many gates the pipeline runs today. Read from the gate script rather than
 * hardcoded, so this cannot drift the next time a gate is added.
 */
const CURRENT_GATE_COUNT = await countGates();

/**
 * How many gates a report shows reaching a verdict. `gates.ran` excludes a gate that reported NOT
 * RUN, which `results` includes; reports from before `gates` existed have only `results`.
 */
function gatesRan(report) {
  return report.gates?.ran?.length ?? report.results?.length ?? 0;
}

if (!existsSync(statePath)) {
  console.error(
    `state-check: ${statePath} does not exist. Nothing to verify, so this is not a pass.`,
  );
  process.exit(1);
}

/** @type {{ phase: string, severity: 'fail'|'warn', message: string }[]} */
const problems = [];
const rows = [];

const state = JSON.parse(await readFile(statePath, 'utf8'));

for (const p of state.phases ?? []) {
  const row = { id: p.id, status: p.status, manifest: null, verdict: null, checks: null };

  if (!EVIDENCE_REQUIRED.has(p.status)) {
    // Nothing to *prove* — but if the phase cites a manifest anyway, resolve it and show it.
    // This branch used to skip resolution entirely, so an in-progress phase citing a real
    // passing capture was reported as "no evidence cited". Understating recorded work is the
    // mirror image of the false-completion this script exists to prevent, and equally
    // misleading to a reader. Enforcement still happens only for the statuses above.
    if (p.status === 'blocked' && !(p.blockedOn?.length > 0)) {
      problems.push({
        phase: p.id,
        severity: 'fail',
        message: 'is `blocked` but does not say what blocks it.',
      });
    }
    if (p.evidence?.manifest) {
      const partial = await resolveManifest(p.evidence.manifest);
      if (partial.ok) {
        row.manifest = partial.rel;
        row.verdict = partial.manifest.verdict;
        row.checks = partial.manifest.totals?.checks ?? 0;
      } else {
        // Not a failure — an in-progress phase is allowed to cite a run that has since been
        // pruned — but it must not read as though the citation resolved.
        problems.push({
          phase: p.id,
          severity: 'warn',
          message: `cites evidence that does not resolve: ${partial.detail}`,
        });
      }
    }
    // The same reasoning applied to a cited **gate**. This branch resolved `manifest` only,
    // so an in-progress phase citing a real 15-of-15 green gate still printed "no evidence
    // cited" — understating the work for exactly the reason the comment above gives. A phase
    // legitimately reaches green gates before it has a phase-wide evidence manifest, which
    // is precisely the state Phase 6 is in.
    if (p.evidence?.gate) {
      const gate = await resolveGate(p.evidence.gate);
      if (gate.ok) {
        const ran = gatesRan(gate.report);
        row.gate = `${gate.report.verdict} (${ran} of ${CURRENT_GATE_COUNT} gates) — ${gate.rel}`;
      } else {
        problems.push({
          phase: p.id,
          severity: 'warn',
          message: `cites a gate report that does not resolve: ${gate.detail}`,
        });
      }
    }
    rows.push(row);
    continue;
  }

  if (!p.evidence?.manifest) {
    problems.push({
      phase: p.id,
      severity: 'fail',
      message: `claims \`${p.status}\` with no evidence.manifest. A status without an artifact is an assertion, not a record.`,
    });
    rows.push(row);
    continue;
  }

  const resolved = await resolveManifest(p.evidence.manifest);
  if (!resolved.ok) {
    problems.push({
      phase: p.id,
      severity: 'fail',
      message: `claims \`${p.status}\` but ${resolved.detail}`,
    });
    rows.push(row);
    continue;
  }

  row.manifest = resolved.rel;
  row.verdict = resolved.manifest.verdict;
  row.checks = resolved.manifest.totals?.checks ?? 0;

  rows.push(row);

  if (resolved.manifest.verdict !== 'pass') {
    problems.push({
      phase: p.id,
      severity: 'fail',
      message: `claims \`${p.status}\` but its newest evidence (${resolved.rel}) has verdict \`${resolved.manifest.verdict}\`.`,
    });
    continue;
  }
  if (!row.checks) {
    problems.push({
      phase: p.id,
      severity: 'fail',
      message: `claims \`${p.status}\` but ${resolved.rel} recorded zero checks. A capture that asserts nothing is not evidence.`,
    });
    continue;
  }
  // An integrity check, not a logic check. `phase-runner.mjs` derives `verdict` from
  // `failedChecks.length`, so it cannot itself emit `pass` alongside `failed > 0`. What
  // can is a hand-edited manifest — and evidence lives under
  // `~/Desktop/agentic-ui-evidence/`, outside the repo, unversioned and writable, which is
  // exactly the material this script exists to be sceptical about. Reading only `verdict`
  // meant one word decided whether a phase counted as done.
  const failed = resolved.manifest.totals?.failed ?? 0;
  if (failed > 0) {
    problems.push({
      phase: p.id,
      severity: 'fail',
      message:
        `cites ${resolved.rel} with verdict \`pass\` but \`totals.failed\` is ${failed}. ` +
        'The runner cannot produce that combination, so the manifest has been edited ' +
        'after the fact. Re-run the phase rather than reconciling the numbers.',
    });
    continue;
  }

  // The quality gate, not just the capture. `pass-partial` is rejected on purpose:
  // two reports in this corpus read `"verdict": "pass"` having run one gate of six.
  if (p.evidence.gate) {
    const gate = await resolveGate(p.evidence.gate);
    const ranCount = gate.ok ? gatesRan(gate.report) : 0;
    row.gate = gate.ok
      ? `${gate.report.verdict} (${ranCount} of ${CURRENT_GATE_COUNT} gates) — ${gate.rel}`
      : null;
    if (!gate.ok) {
      problems.push({
        phase: p.id,
        severity: 'fail',
        message: `cites a gate report but ${gate.detail}`,
      });
    } else if (gate.report.verdict === 'pass-partial') {
      problems.push({
        phase: p.id,
        severity: 'fail',
        message: `cites gate report ${gate.rel}, which is \`pass-partial\` — it never ran ${(gate.report.gates?.notRequested ?? []).join(', ')}. A filtered run is a fast inner loop, not a phase gate.`,
      });
    } else if (gate.report.verdict !== 'pass') {
      problems.push({
        phase: p.id,
        severity: 'fail',
        message: `cites gate report ${gate.rel}, whose verdict is \`${gate.report.verdict}\`.`,
      });
    } else {
      if (gate.imprecise) {
        problems.push({
          phase: p.id,
          severity: 'warn',
          message: `cites \`gates/latest\`, which is whatever ran last and may be unrelated. Use \`gates/latest:<label>\`.`,
        });
      }
      // The gate set has grown twice — `lockfile` and `typecheck` in Phase 2, then
      // `node` and `assertions`. A phase signed off under the old set has never been
      // through the newer ones, and that is worth knowing before trusting it.
      //
      // `evidence.regate` records a later run against the *current* set. The original
      // citation is kept rather than replaced: it is the historical fact of what was
      // actually run at sign-off, and overwriting it would erase the very gap this
      // warning exists to surface.
      const signedOff = gatesRan(gate.report);
      if (signedOff < CURRENT_GATE_COUNT) {
        const re = p.evidence.regate ? await resolveGate(p.evidence.regate) : null;
        const reRan = re?.ok ? gatesRan(re.report) : 0;
        if (re?.ok && re.report.verdict === 'pass' && reRan >= CURRENT_GATE_COUNT) {
          row.gate += `  [re-gated ${reRan}/${CURRENT_GATE_COUNT}: ${re.rel}]`;
        } else if (re?.ok && re.report.verdict === 'pass') {
          // Green, but over fewer gates than exist now — so a gate has been ADDED since the
          // re-gate ran. That is the same situation as never having re-gated, and it carries
          // the same `warn`. It was previously a `fail` reading "cites a re-gate that does
          // not hold", which accused six phases of citing bad evidence the moment
          // `spec-types` was added: the re-gates held perfectly, they were simply older than
          // a gate that did not exist when they ran. A gate that cries fraud over its own
          // expansion is a gate people learn to bypass.
          problems.push({
            phase: p.id,
            severity: 'warn',
            message: `re-gated green over ${reRan} gate(s), but the set is now ${CURRENT_GATE_COUNT}. It has not been through the gate(s) added since — re-gate and update \`evidence.regate\`.`,
          });
        } else if (p.evidence.regate) {
          problems.push({
            phase: p.id,
            severity: 'fail',
            message: `cites a re-gate that does not hold: ${re?.ok ? `${re.rel} is \`${re.report.verdict}\` over ${reRan} gate(s)` : re?.detail}`,
          });
        } else {
          problems.push({
            phase: p.id,
            severity: 'warn',
            message: `was signed off on a ${signedOff}-gate run; the gate set is now ${CURRENT_GATE_COUNT}. It has never been through the newer gates — re-gate and record it as \`evidence.regate\`.`,
          });
        }
      }
    }
  }

  // Passing gates, but possibly against code that no longer exists. A phase read
  // `complete` off a gate report from days and dozens of commits earlier, which is
  // the same false-completion this script exists to catch wearing a green hat.
  // Against the re-gate when there is one, because that is the run that speaks to the
  // current code; the original citation is a historical record of what was run at sign-off
  // and is deliberately never replaced. Checking the original instead produced a `records
  // no commit` warning that could never be cleared — those reports predate the field and
  // cannot be retrofitted — and an uncleanable warning is one people learn to skip past.
  const recencyRef = p.evidence?.regate ?? p.evidence?.gate;
  if (recencyRef) {
    const staleness = await checkRecency(recencyRef);
    if (staleness) {
      row.stale = staleness.summary;
      problems.push({ phase: p.id, severity: staleness.severity, message: staleness.message });
    }
  }

  // Passing, but the claim can still be wider than the evidence.
  if (!(p.notCovered?.length > 0)) {
    problems.push({
      phase: p.id,
      severity: 'warn',
      message:
        'is complete with an empty `notCovered`. Silence reads as full coverage; state the gaps.',
    });
  }
  const audit = resolved.manifest.screenshotAudit;
  if (audit && audit.total > 0 && audit.unique < audit.total) {
    problems.push({
      phase: p.id,
      severity: 'warn',
      message: `evidence has ${audit.unique} unique image(s) of ${audit.total}; do not quote the screenshot count as observations.`,
    });
  }
}

report();
process.exit(problems.some((p) => p.severity === 'fail') ? 1 : 0);

/**
 * @param {string} ref e.g. `phase-2-registry/latest` or an explicit timestamp dir
 * @returns {Promise<{ ok: true, rel: string, manifest: any } | { ok: false, detail: string }>}
 */
async function resolveManifest(ref) {
  const [phaseDir, stamp] = ref.split('/');
  const dir = resolve(betaRoot, phaseDir);
  if (!existsSync(dir)) {
    return { ok: false, detail: `no evidence directory \`${phaseDir}\` exists under ${betaRoot}.` };
  }

  let chosen = stamp;
  if (stamp === 'latest' || !stamp) {
    const entries = [];
    for (const name of await readdir(dir)) {
      const full = resolve(dir, name);
      if ((await stat(full)).isDirectory() && existsSync(resolve(full, 'manifest.json')))
        entries.push(name);
    }
    // Timestamped names sort lexicographically in chronological order.
    entries.sort();
    chosen = entries.at(-1);
    if (!chosen)
      return { ok: false, detail: `\`${phaseDir}\` contains no run with a manifest.json.` };
  }

  const file = resolve(dir, chosen, 'manifest.json');
  if (!existsSync(file))
    return { ok: false, detail: `${phaseDir}/${chosen}/manifest.json does not exist.` };

  try {
    return {
      ok: true,
      rel: `${phaseDir}/${chosen}`,
      manifest: JSON.parse(await readFile(file, 'utf8')),
    };
  } catch (err) {
    return {
      ok: false,
      detail: `${phaseDir}/${chosen}/manifest.json is not readable JSON: ${err}`,
    };
  }
}

/**
 * Resolve a gate reference.
 *
 *   `gates/latest:<label>`  newest report whose `phase` field is <label> — preferred,
 *                           because "newest overall" is poisoned by any unrelated run
 *                           (a deliberate-break probe made three phases go red here)
 *   `gates/<file>.json`     an exact report
 *   `gates/latest`          newest overall; accepted but flagged as imprecise
 *
 * @param {string} ref
 * @returns {Promise<{ ok: true, rel: string, report: any, imprecise?: boolean } | { ok: false, detail: string }>}
 */
async function resolveGate(ref) {
  const dir = resolve(betaRoot, 'gates');
  if (!existsSync(dir))
    return { ok: false, detail: `no gates directory exists under ${betaRoot}.` };

  const name = ref.split('/').slice(1).join('/');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) return { ok: false, detail: 'the gates directory contains no reports.' };

  if (name.startsWith('latest:')) {
    const label = name.slice('latest:'.length);
    for (const f of [...files].reverse()) {
      try {
        const report = JSON.parse(await readFile(resolve(dir, f), 'utf8'));
        if (report.phase === label) return { ok: true, rel: `gates/${f}`, report };
      } catch {
        /* skip an unreadable report rather than fail the lookup on it */
      }
    }
    return {
      ok: false,
      detail: `no gate report is labelled \`${label}\`. Run: npm run beta:gate -- --phase ${label}`,
    };
  }

  if (!name || name === 'latest') {
    const f = files.at(-1);
    return {
      ok: true,
      rel: `gates/${f}`,
      report: JSON.parse(await readFile(resolve(dir, f), 'utf8')),
      imprecise: true,
    };
  }

  const file = resolve(dir, name.endsWith('.json') ? name : `${name}.json`);
  if (!existsSync(file)) return { ok: false, detail: `gates/${name} does not exist.` };
  try {
    return { ok: true, rel: `gates/${name}`, report: JSON.parse(await readFile(file, 'utf8')) };
  } catch (err) {
    return { ok: false, detail: `gates/${name} is not readable JSON: ${err}` };
  }
}

/**
 * Has source changed since the cited gate ran?
 *
 * A gate report is a statement about one commit. Nothing tied it to that commit,
 * so a phase could stay `complete` indefinitely while the code underneath it moved
 * — the failure mode is a stale green, which reads exactly like a real one.
 *
 * Source changes are a `fail`: the gate has demonstrably not run against what is
 * on disk. Documentation-only changes are a `warn`, because re-gating prose is
 * busywork and treating it as a blocker would train people to ignore this.
 *
 * A report predating this check has no `commit` field. That is reported as a `warn`
 * rather than assumed fine, since "cannot tell" and "is current" are different
 * answers and only one of them is evidence.
 *
 * @param {string} ref
 * @returns {Promise<{ severity: 'fail'|'warn', message: string, summary: string } | null>}
 */
async function checkRecency(ref) {
  const gate = await resolveGate(ref);
  if (!gate.ok) return null; // Already reported by the caller.

  if (gate.report.dirty) {
    return {
      severity: 'fail',
      message: `cites gate report ${gate.rel}, which ran on a dirty working tree. It describes code that no commit contains.`,
      summary: 'ran dirty',
    };
  }

  const commit = gate.report.commit;
  if (!commit) {
    return {
      severity: 'warn',
      message: `cites gate report ${gate.rel}, which records no commit, so whether it covers the current code cannot be determined. Re-gate to record one.`,
      summary: 'commit unknown',
    };
  }

  if (git(['cat-file', '-e', `${commit}^{commit}`]) === null) {
    return {
      severity: 'warn',
      message: `cites gate report ${gate.rel}, whose commit ${commit.slice(0, 8)} is not in this repository (rebased or never pushed), so its currency cannot be checked.`,
      summary: `commit ${commit.slice(0, 8)} missing`,
    };
  }

  const changed = git(['diff', '--name-only', `${commit}..HEAD`]);
  if (changed === null) return null;

  const files = changed.split('\n').filter(Boolean);
  if (files.length === 0) return null;

  const isSource = (f) =>
    (f.startsWith('apps/') || f.startsWith('libs/') || f.startsWith('scripts/') || f === 'package-lock.json' || f === 'package.json') &&
    !f.endsWith('.md');
  const source = files.filter(isSource);
  const behind = (git(['rev-list', '--count', `${commit}..HEAD`]) ?? '?').trim();

  if (source.length > 0) {
    const shown = source.slice(0, 3).join(', ');
    return {
      severity: 'fail',
      message:
        `cites gate report ${gate.rel} from commit ${commit.slice(0, 8)}, ${behind} commit(s) behind HEAD, ` +
        `and ${source.length} source file(s) have changed since (${shown}${source.length > 3 ? ', …' : ''}). ` +
        'The gate has not run against the code on disk — re-gate and update the citation.',
      summary: `${behind} behind, ${source.length} source file(s) changed`,
    };
  }

  return {
    severity: 'warn',
    message: `cites gate report ${gate.rel} from commit ${commit.slice(0, 8)}, ${behind} commit(s) behind HEAD, though only documentation has changed since.`,
    summary: `${behind} behind, docs only`,
  };
}

/**
 * @param {string[]} argv
 * @returns {string | null} stdout, or null when git fails
 */
function git(argv) {
  const proc = spawnSync('git', argv, { cwd: repoRoot, encoding: 'utf8' });
  return proc.status === 0 ? proc.stdout : null;
}

/**
 * Ask the gate script itself how many gates exist, so this never goes stale.
 * @returns {Promise<number>}
 */
async function countGates() {
  try {
    const src = await readFile(resolve(import.meta.dirname, 'verify-gate.mjs'), 'utf8');
    const block = src.slice(src.indexOf('const ALL_GATES'), src.indexOf('const requested'));
    return (block.match(/^\s*(?:\{\s*)?id:\s*'/gm) ?? []).length;
  } catch {
    return 0; // Unknown, so never warn about it.
  }
}

function report() {
  const fails = problems.filter((p) => p.severity === 'fail');
  const warns = problems.filter((p) => p.severity === 'warn');

  if (asJson) {
    console.log(JSON.stringify({ ok: fails.length === 0, phases: rows, problems }, null, 2));
    return;
  }

  console.log(`\nPhase state check — ${statePath.replace(`${repoRoot}/`, '')}\n`);
  for (const r of rows) {
    const ev = r.manifest
      ? `${r.verdict} (${r.checks} checks) — ${r.manifest}`
      : 'no evidence cited';
    console.log(`  ${r.id.padEnd(20)} ${String(r.status).padEnd(12)} ${ev}`);
    if (r.gate) console.log(`  ${' '.repeat(20)} ${' '.repeat(12)} gate: ${r.gate}`);
    if (r.stale) console.log(`  ${' '.repeat(20)} ${' '.repeat(12)} currency: ${r.stale}`);
  }
  console.log('');
  for (const p of fails) console.log(`  [FAIL] ${p.phase} ${p.message}`);
  for (const p of warns) console.log(`  [warn] ${p.phase} ${p.message}`);
  if (problems.length) console.log('');

  if (fails.length) {
    console.log(
      `state-check: FAIL — ${fails.length} phase(s) claim more than the evidence on disk supports.`,
    );
  } else {
    console.log(
      `state-check: pass — every completed phase cites a manifest that exists and passed` +
        `${warns.length ? `, with ${warns.length} warning(s)` : ''}.`,
    );
  }
}
