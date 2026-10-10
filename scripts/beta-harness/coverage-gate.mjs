#!/usr/bin/env node
/**
 * Coverage ratchet gate.
 *
 * The Beta quality bar is >90% unit coverage. Nothing here is near that — the
 * adf-hx bridge has 11 tests for 2,949 lines — so a gate set at 90% would be red
 * on every run from now until Phase 6, and a gate that cannot pass gets bypassed
 * and then ignored. That is worse than no gate.
 *
 * So this ratchets instead. It records where each project is today and fails when
 * a project goes **backwards**. Coverage can only improve, and the report says how
 * far each project still is from the 90% target, so the debt stays visible rather
 * than becoming a number nobody looks at until Phase 6.
 *
 * It summarises `coverage-final.json`, which the default Vitest reporters already
 * write, rather than requiring `json-summary` — Nx swallows `--coverage.reporter`,
 * and adding it to seventeen vite configs to satisfy one script is the wrong trade.
 *
 * ## Three states, not two
 *
 * A project is **measured**, or it is **unmeasurable** — a coverage report that measures
 * nothing. The distinction is the whole point of the 2026-08-24 fix: `0/0` statements scored
 * as `100%`, so `assets` and `tasks`, which have no spec files at all, were recorded in the
 * baseline as meeting the Beta bar. That inflated count reached the plan, the delivery record
 * and a leadership page as "5 of 17 projects meet 90%" when the true figure was 3.
 *
 * Unmeasurable is neither a pass nor a fail: it is *untested*. A baseline entry for one
 * **fails** this gate, because the entry is itself the defect.
 *
 * ## Hard floors, beside the ratchet
 *
 * A project named in `FLOORS` must clear its floor on every run, from its first commit, rather
 * than enter at whatever it measures. That is for code written against the bar rather than
 * catching up to it — `satori-components`, the `nxs-` library NXSAT-308 builds new.
 *
 * Usage:
 *   node scripts/beta-harness/coverage-gate.mjs                    # check the ratchet
 *   node scripts/beta-harness/coverage-gate.mjs --update-baseline  # re-record after a rise
 *   node scripts/beta-harness/coverage-gate.mjs --run              # run the tests first
 *   node scripts/beta-harness/coverage-gate.mjs --json
 *
 * Exit 1 if any project's line coverage dropped by more than the tolerance, if a floor in
 * `FLOORS` is not met, or if --update-baseline is needed and has not been given.
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import ts from 'typescript';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const updateBaseline = argv.includes('--update-baseline');
const runTests = argv.includes('--run');

const baselinePath = resolve(repoRoot, '.ai/state/coverage-baseline.json');
const coverageRoot = resolve(repoRoot, 'coverage');

/** The Beta quality bar from `docs/adf-hx-beta-plan.md`, Phase 6. */
const TARGET = 90;

/**
 * Projects outside the Beta slice, and why.
 *
 * The plan scopes Beta to "a deep core slice — browse, folder tree, search, document
 * detail, metadata, permissions, versions, upload/CRUD", and says in as many words that
 * "workflow, users and groups, administration and publishing are out". The gate never
 * encoded that, so `administration` at 62% and `knowledge-discovery` at 65% were counted
 * against a bar the plan does not hold them to — which makes the shortfall look like Beta
 * debt and buries the two projects that genuinely are.
 *
 * The default is IN scope: a project has to be named here to be excused, so a new library
 * counts against the bar until someone argues otherwise. The reverse default is how the
 * uninstrumented allowlist quietly grew.
 *
 * Being out of scope excuses a project from the 90% *bar* only. The ratchet still applies —
 * out-of-scope code may not silently rot.
 */
const OUT_OF_SCOPE = Object.freeze({
  administration: 'administration — out of Beta scope per the plan',
  tasks: 'workflow tasks — out of Beta scope per the plan',
  'knowledge-discovery': 'KD feature, not part of the core slice',
  'shared-kd-client': 'KD client, not part of the core slice',
  'shared-ke-client': 'KE client, not part of the core slice',
  assets: 'asset search, not part of the core slice',
  trash: 'trash, not part of the core slice',
  'acme-extensions': 'reference customer extension — example code, not product',
  'contoso-extensions': 'reference customer extension — example code, not product',
  'insurance-extensions': 'reference customer extension — example code, not product',
  'nuxeo-satori-template': 'forkable template — example code, not product',
  core: 'untouched Nx scaffold',
});

/*
 * `shared-ai-client` is deliberately NOT in the list above, and was briefly added by mistake.
 *
 * The reasoning for adding it was that its KD and KE siblings are excluded and the AI backend is
 * not in this repository. Both premises are true and the conclusion does not follow.
 * `docs/adf-hx-beta-plan.md` is the plan of record and names the excluded set exactly —
 * "administration, workflow tasks, KD/KE, assets, trash — plus the reference extension libraries
 * and the forkable template" — then says: **"The default is in-scope, so a new library counts
 * until someone argues otherwise."** KD/KE are named. The AI client is not.
 *
 * And it is genuinely exercised by the core slice: `search` and `document-detail` both consume
 * `AiGatewayService`. A missing backend does not prevent unit-testing an Angular HTTP client
 * against mocked responses, which is how every other client here is tested.
 *
 * It sits at 15.98%, so excluding it moves the reported in-scope figure from 10 of 11 to 10 of 10
 * without a line of production code changing. That is the exact reason the bar is scope-aware and
 * the scope lives in the plan rather than here: changing this map is not how scope gets decided.
 */

/**
 * Per-project line-coverage floors, enforced on every run and separate from the ratchet.
 *
 * The number is NXENG-615's "Unit tests coverage > 90%", the bar `TARGET` already reports
 * against. A floor project is also held to two things the ratchet excuses:
 *
 * - **It must be measured this run.** No report, or a report that measures nothing, is a failed
 *   floor rather than "outside the affected set".
 * - **None of its files may sit outside the measurement.** v8 lists a file no spec imports with
 *   an empty statement map, so it cannot lower the percentage. The ratchet accepts a dated
 *   allowlist entry for that; a floor that did the same could be met by not testing a new
 *   component at all. Only `noStatements` entries — files with nothing to execute — are excused.
 */
const FLOORS = Object.freeze({
  'satori-components': TARGET,
});

/** @param {string} project */
function inBetaScope(project) {
  return !Object.hasOwn(OUT_OF_SCOPE, project);
}
/**
 * Slack in percentage points. Line coverage moves a little when a file is added
 * without its spec in the same commit, and failing a gate on 0.3pp of noise trains
 * people to bypass it. Anything larger is a real regression.
 */
const TOLERANCE = 0.5;
/**
 * Below this many statements, a coverage percentage carries no information about quality.
 * `libs/core` is an untouched Nx scaffold — one placeholder component, an empty template and
 * the generated `should create` spec — and scores a perfectly truthful 100% over 7
 * statements. The figure is not wrong; it is just not evidence of anything.
 *
 * The number is a judgement call, so it does **not** exclude a project from the count. It
 * only makes the gate say which of its own passes are thin, next to the count it reports.
 */
const THIN_STATEMENTS = 20;

const projects = await discoverProjects();
const vitest = projects.filter((p) => p.kind === 'vitest');
const other = projects.filter((p) => p.kind !== 'vitest');

if (runTests) {
  if (vitest.length === 0) {
    console.error('coverage-gate: no Vitest projects found, so there is nothing to measure.');
    process.exit(1);
  }
  console.log(`Running ${vitest.length} Vitest project(s) with coverage…`);
  if (other.length) {
    // Stated, not silently dropped: a gate that quietly skips a project reads as
    // "everything is covered" when it is not.
    console.log(
      `  Excluded, no v8 coverage available: ${other.map((p) => p.name).join(', ')}\n` +
        `  (Karma's builder takes --code-coverage, not --coverage.enabled, and fails on the latter.)`,
    );
  }
  console.log('');
  // `--coverage.enabled=true`, not `--coverage`: Nx sees the latter twice and errors
  // with `Expected a single value for option "--coverage "`.
  const r = spawnSync(
    'npx',
    [
      'nx',
      'run-many',
      '-t',
      'test',
      `--projects=${vitest.map((p) => p.name).join(',')}`,
      '--coverage.enabled=true',
    ],
    { stdio: 'inherit', env: { ...process.env, ...webstorageOptOut() } },
  );
  if (r.status !== 0) {
    console.error(
      '\ncoverage-gate: tests failed, so coverage numbers would be meaningless. Fix the tests first.',
    );
    process.exit(1);
  }
}

/**
 * Projects that emitted a coverage report carrying no usable measurement — see
 * `collect()`. Populated by `collect()`, so it must be declared before the call.
 */
const vacuous = [];

/**
 * Projects whose `coverage-final.json` is older than their newest source or spec file.
 *
 * This gate reads artifacts off disk rather than measuring anything itself, so it is only as
 * truthful as the freshness of what it reads — and a stale report is not merely imprecise, it
 * asserts things that are no longer so. Two real cases, hours apart:
 *
 * - `collections` was reported at 81.67% from a report predating the extraction of its four
 *   permission dialogs. The figure reconciled exactly against a file set that had moved out,
 *   and the ratchet then called the first honest measurement a 19.55pp regression.
 * - The uninstrumented allowlist was authored from reports predating twelve `adf-hx-bridge`
 *   specs, so it listed `hxql-literal.ts` as having no in-project spec while
 *   `hxql-literal.spec.ts` sat beside it, committed in `a0528ab`. Nine of eighteen entries
 *   were wrong on the day they were written.
 *
 * Both were mistakes of the same shape, made twice in one session, which is what a check is
 * for. Compared against every `.ts` under the project root: a source file edited after the
 * report was written means the report does not describe the code on disk. So does a report that
 * counts a file under the project root which no longer exists — a deletion leaves nothing newer.
 */
const stale = [];

const measured = await collect();

if (measured.length === 0) {
  console.error(
    'coverage-gate: no coverage reports found under `coverage/`.\n' +
      'Run it with --run, or run the tests with --coverage.enabled=true first.\n' +
      'Refusing to report a pass on a measurement that did not happen.',
  );
  process.exit(1);
}

/**
 * Uninstrumented source files, checked against a dated allowlist.
 *
 * See `findUninstrumented()` for what this catches and why the percentage alone could not.
 * The allowlist is dated on purpose: an undated exception is indistinguishable from an
 * oversight six weeks later, and this repository has already had gates whose exceptions
 * outlived their reasons.
 *
 * Three failure modes, all blocking:
 *   1. a file is uninstrumented and not in the allowlist  — new untested code
 *   2. a file is uninstrumented and its entry has expired — accepted debt, now due
 *   3. the allowlist names a file that is now instrumented or gone — stale entry, so the
 *      file is deleted from the list rather than left as false reassurance
 */
const uninstrumentedAllowlistPath = resolve(
  repoRoot,
  '.ai/state/coverage-uninstrumented-allowlist.json',
);
const rawAllowlist = existsSync(uninstrumentedAllowlistPath)
  ? JSON.parse(await readFile(uninstrumentedAllowlistPath, 'utf8'))
  : {};
/** Dated debt: files with real code that no test reaches. */
const datedAllowlist = rawAllowlist.files ?? {};
/**
 * Permanent exemptions for files that genuinely contain no executable statements — pure type
 * declarations, `export *` barrels, constant tables. A deadline for these would be a lie, since
 * there is nothing to test. Self-policing: if one ever gains a statement its entry is stale, so
 * the list cannot quietly become a dumping ground.
 */
const noStatementsAllowlist = new Set(Object.keys(rawAllowlist.noStatements ?? {}));

/**
 * Executable top-level statements in a source file, read from the source, not the coverage map.
 *
 * A `noStatements` exemption is otherwise checked only against coverage, and a file no spec
 * imports has an empty coverage map whatever it holds — so a barrel that gained a function would
 * stay exempt. For a floor project the exemption is re-derived from the code instead. Imports,
 * re-exports, interfaces, type aliases and `declare` forms carry no runtime code.
 */
function executableStatements(text) {
  const source = ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, false);
  return source.statements.filter(
    (statement) =>
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement) &&
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      !ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword),
  ).length;
}

/** A percentage truncated to two places, so a figure below a floor never prints as meeting it. */
function truncatedPercent(covered, total) {
  return Math.floor((covered / total) * 10000) / 100;
}

// Regression case, run on every invocation: nine covered statements on one line and an uncovered
// one on the next are 90% of statements but 50% of lines.
{
  const at = (line) => ({ start: { line, column: 0 }, end: { line, column: 1 } });
  const ids = [...Array(10).keys()];
  const got = summarise({
    'case.ts': {
      statementMap: Object.fromEntries(ids.map((i) => [i, at(i < 9 ? 1 : 2)])),
      s: Object.fromEntries(ids.map((i) => [i, i < 9 ? 1 : 0])),
    },
  });
  if (got.sCovered !== 9 || got.sTotal !== 10 || got.lCovered !== 1 || got.lTotal !== 2) {
    throw new Error(`coverage-gate: summarise counted lines wrongly: ${JSON.stringify(got)}`);
  }
}

// Regression cases, run on every invocation so the exemption check cannot regress unnoticed.
for (const [text, want] of [
  ["export { A } from './a';\nexport * from './b';\nexport type { T } from './t';\n", 0],
  ['export interface I {\n  a: string;\n}\nexport type U = 1 | 2;\n', 0],
  ["export { A } from './a';\nexport function f(): number {\n  return 1;\n}\n", 1],
  ['export const x = 1;\n', 1],
  ['export enum E {\n  A,\n}\n', 1],
]) {
  const got = executableStatements(text);
  if (got !== want) {
    throw new Error(`coverage-gate: executableStatements found ${got}, not ${want}, in:\n${text}`);
  }
}

/**
 * Computed before either baseline write, so `--update-baseline` can reset the ratchet without
 * resetting a floor: a write still exits 1 when a floor is not met.
 *
 * @type {{ project: string, floor: number, why: string }[]}
 */
const floorFailures = [];
for (const [project, floor] of Object.entries(FLOORS)) {
  const fails = (why) => floorFailures.push({ project, floor, why });
  if (!projects.some((p) => p.name === project && p.kind === 'vitest')) {
    fails('there is no Vitest project of that name, so the floor guards nothing');
    continue;
  }
  const empty = vacuous.find((v) => v.project === project);
  if (empty) {
    fails(`its coverage report measures nothing (${empty.why})`);
    continue;
  }
  const m = measured.find((x) => x.project === project);
  if (!m) {
    fails('it has no coverage report this run, so the floor was not measured');
    continue;
  }
  const staleReport = stale.find((t) => t.project === project);
  if (staleReport) {
    fails(
      staleReport.gone?.length
        ? `its coverage report counts ${staleReport.gone.length} source file(s) that no longer ` +
            `exist (${staleReport.gone.join(', ')}), so the floor was measured on old code`
        : 'its coverage report is older than its source, so the floor was measured on old code',
    );
    continue;
  }
  // Lines, not statements, because the floor is a line floor — see `summarise()`. Compared on the
  // counts, because a rounded percentage would let 89.996% round its way to 90.
  if (m.lCovered * 100 < floor * m.lTotal) {
    fails(
      `${truncatedPercent(m.lCovered, m.lTotal)}% of lines covered (${m.lCovered} of ${m.lTotal} lines)`,
    );
  }
  for (const u of m.unmeasured ?? []) {
    if (noStatementsAllowlist.has(u.file)) {
      const code = executableStatements(readFileSync(resolve(repoRoot, u.file), 'utf8'));
      if (code === 0) continue;
      fails(
        `${u.file} is exempt under noStatements but has ${code} executable top-level ` +
          'statement(s), and no spec reaches it',
      );
      continue;
    }
    fails(`${u.file} contributes no statements [${u.why}] — no spec reaches it`);
  }
}

const baseline = existsSync(baselinePath) ? JSON.parse(await readFile(baselinePath, 'utf8')) : null;

if (!baseline) {
  if (!updateBaseline) {
    console.error(
      `coverage-gate: no baseline at ${relative(repoRoot, baselinePath)}.\n` +
        'Record one with --update-baseline, then commit it. Until then there is nothing to ratchet against.',
    );
    process.exit(1);
  }
  await write(measured, 'initial baseline');
  exitOnFloorFailures();
  process.exit(0);
}

const rows = [];
const regressions = [];
const rises = [];

/**
 * Percentage fell, but strictly more statements are covered than before — the denominator
 * grew because previously uninstrumented code entered the measurement. Reported prominently
 * and not failed; see the classification in the loop below.
 */
const expanded = [];

/** Measured this run but absent from the baseline, so nothing ratchets them. */
const unratcheted = [];

for (const m of measured) {
  const was = baseline.projects?.[m.project];
  const delta = was === undefined ? null : round(m.lines - was.lines);
  rows.push({ ...m, was: was?.lines ?? null, delta, target: round(TARGET - m.lines) });
  if (was === undefined) {
    // A `continue` alone is how a new project escaped the ratchet silently: it was
    // printed as `new` in the table and then excluded from every check, so its coverage
    // could fall to zero on the next commit without a word. `permission-dialogs` was in
    // exactly that state — 93.84%, entirely unguarded — from the moment it was created.
    unratcheted.push(m.project);
    continue;
  }
  if (delta < -TOLERANCE) {
    // A percentage drop has two very different causes, and failing both punishes the wrong one.
    //
    //   (a) tests were deleted or weakened            -> fewer statements covered  -> REGRESSION
    //   (b) an uninstrumented file entered the report -> more  statements covered  -> not one
    //
    // In (b) nothing that was tested became untested; the denominator grew because code that
    // was invisible is now measured. `collections` was exactly this: adding the first spec for
    // `collection-detail.ts` covered 64.6% of its 635 statements, took covered statements from
    // ~105 to ~515, and the *reported* figure fell from 81.67% to 62.12%.
    //
    // Failing that would make the gate punish honest measurement and reward leaving files
    // uninstrumented — the precise hole `findUninstrumented()` was just added to close. So the
    // absolute count decides, and only when the baseline actually recorded one.
    const haveCounts =
      typeof was.sCovered === 'number' &&
      typeof was.sTotal === 'number' &&
      typeof m.sCovered === 'number';
    const expandedHonestly = haveCounts && m.sCovered > was.sCovered && m.sTotal > was.sTotal;
    if (expandedHonestly) {
      expanded.push({
        project: m.project,
        was: was.lines,
        now: m.lines,
        delta,
        wasTotal: was.sTotal,
        nowTotal: m.sTotal,
        wasCovered: was.sCovered,
        nowCovered: m.sCovered,
      });
    } else {
      regressions.push({ project: m.project, was: was.lines, now: m.lines, delta });
    }
  } else if (delta > TOLERANCE)
    rises.push({ project: m.project, was: was.lines, now: m.lines, delta });
}

/**
 * Baseline entries with no coverage report this run, split by **why**.
 *
 * These were one undifferentiated list, reported as "outside the affected set" — which is
 * usually true and is not a failure. But it also absorbed entries for projects that no
 * longer exist, and those never come back: `drawers` was deleted on 2026-08-24 and its
 * baseline entry would have printed "not measured, unchanged" on every run forever, a
 * permanent line of reassurance about a library that is gone. Worse, its recorded 100% was
 * meaningless — it was an empty barrel with `passWithNoTests`.
 *
 * A baseline naming a project the workspace does not have is stale data in the file this
 * gate's authority rests on, so it fails.
 */
const projectNames = new Set(projects.map((p) => p.name));
const baselineNames = Object.keys(baseline.projects ?? {});
const vacuousNames = new Set(vacuous.map((v) => v.project));
const unmeasured = baselineNames.filter(
  (p) =>
    !measured.some((m) => m.project === p) &&
    projectNames.has(p) &&
    // Not "outside the affected set" — these DID run, and produced nothing to measure.
    // Reporting them as unmeasured-but-unchanged is how the false 100% stayed invisible.
    !vacuousNames.has(p),
);
const orphaned = baselineNames.filter((p) => !projectNames.has(p));

/**
 * The defect this check exists for: a project with nothing measurable that nevertheless
 * carries a percentage in the baseline. Every such entry is a claim the gate cannot support,
 * and each one inflates the "projects meeting the Beta bar" count that leadership reads.
 *
 * It fails rather than warns because the file is this gate's entire authority. A warning
 * would have left the same three false 100%s in place, which is exactly what happened for
 * as long as they sat there unnoticed.
 */
const falseCredit = vacuous.filter((v) => baselineNames.includes(v.project));

const todayArg = argv[argv.indexOf('--today') + 1];
const today =
  argv.includes('--today') && todayArg ? todayArg : new Date().toISOString().slice(0, 10);

const unmeasuredAll = measured.flatMap((m) =>
  (m.unmeasured ?? []).map((u) => ({ project: m.project, ...u })),
);
const unlisted = [];
const expired = [];
for (const item of unmeasuredAll) {
  if (noStatementsAllowlist.has(item.file)) continue;
  const entry = datedAllowlist[item.file];
  if (!entry) {
    unlisted.push(item);
    continue;
  }
  if (!entry.until || entry.until < today) {
    expired.push({ ...item, until: entry.until ?? '(none)' });
  }
}
const unmeasuredNow = new Set(unmeasuredAll.map((u) => u.file));
const staleAllowlist = [
  ...Object.keys(datedAllowlist).filter((f) => !unmeasuredNow.has(f)),
  // A `noStatements` entry is stale the moment the file starts producing statements: the
  // exemption said there was nothing to measure, and now there is.
  ...[...noStatementsAllowlist].filter((f) => !unmeasuredNow.has(f)),
];

if (updateBaseline) {
  const merged = { ...baseline.projects };
  for (const m of measured) merged[m.project] = entryFor(m);
  // Orphans are pruned here as well as reported. Without this, `--update-baseline`
  // preserved an entry for a deleted project indefinitely — the one command a
  // maintainer would reach for to fix the complaint could not fix it.
  for (const p of orphaned) delete merged[p];
  // Same reasoning for vacuous entries: the command a maintainer reaches for to fix the
  // complaint has to be able to fix it, or the gate is telling them to hand-edit the file
  // it is asking them to trust.
  for (const v of vacuous) delete merged[v.project];
  await write(
    Object.entries(merged).map(([project, v]) => ({ project, ...v })),
    `updated from ${measured.length} project(s)` +
      (orphaned.length
        ? `, pruned ${orphaned.length} orphaned entr(ies): ${orphaned.join(', ')}`
        : '') +
      (vacuous.length
        ? `, pruned ${vacuous.length} unmeasurable entr(ies): ${vacuous.map((v) => v.project).join(', ')}`
        : ''),
  );
  exitOnFloorFailures();
  process.exit(0);
}

report();
/**
 * Every blocking category, in one place.
 *
 * The uninstrumented checks were added to `report()` and to the FAIL banner but not here, so
 * they printed "coverage-gate: FAIL" and then exited 0 — and with `--json`, emitted
 * `ok: false` alongside a zero exit. CI reads the exit code, so the gate would have announced
 * a failure and been recorded as a pass.
 *
 * It was missed because the first negative controls appeared to work: they ran while
 * `collections` still carried its stale baseline, so a regression was already forcing exit 1
 * and every control inherited it. The controls were confirming a failure they had not caused.
 * That is the specific way a control can lie, and the fix is to re-run them from a green
 * starting state — which is how this surfaced.
 */
process.exit(
  stale.length ||
    floorFailures.length ||
    regressions.length ||
    orphaned.length ||
    unratcheted.length ||
    falseCredit.length ||
    unlisted.length ||
    expired.length ||
    staleAllowlist.length
    ? 1
    : 0,
);

/* ---------- collection ---------- */

/**
 * Walk `coverage/` for `coverage-final.json` files and summarise each.
 * @returns {Promise<{ project: string, lines: number, statements: number, branches: number, functions: number, files: number }[]>}
 */
async function collect() {
  if (!existsSync(coverageRoot)) return [];
  const out = [];
  for (const p of vitest) {
    // Keyed off the target's own `reportsDirectory`, so the baseline uses real Nx
    // project names rather than a directory basename guessed from the path.
    const file = resolve(repoRoot, p.reportsDirectory, 'coverage-final.json');
    if (!existsSync(file)) continue;
    const reportAge = (await stat(file)).mtimeMs;
    const newestSource = await newestSourceMtime(p.root);
    if (newestSource > reportAge) {
      stale.push({
        project: p.name,
        report: new Date(reportAge).toISOString(),
        source: new Date(newestSource).toISOString(),
      });
    }
    let data;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    // Deleting a source leaves no newer file behind, so the mtime test above cannot see it, and
    // the report goes on counting the deleted file's statements.
    const rootAbs = resolve(repoRoot, p.root);
    const gone = Object.keys(data)
      .map((f) => resolve(repoRoot, f))
      .filter((f) => f.startsWith(`${rootAbs}${sep}`) && !existsSync(f))
      .map((f) => relative(repoRoot, f));
    if (gone.length) {
      const entry = stale.find((t) => t.project === p.name);
      if (entry) entry.gone = gone;
      else
        stale.push({
          project: p.name,
          report: new Date(reportAge).toISOString(),
          source: null,
          gone,
        });
    }
    const s = summarise(data);
    if (s.files === 0) continue;
    const specs = await countSpecs(p.root);
    const unmeasured = await findUnmeasured(p.root, data);
    // Two ways to produce a number that is not coverage. Both are separated out here rather
    // than filtered away, so the gate can name them instead of silently shrinking its scope.
    if (s.sTotal === 0) {
      vacuous.push({ project: p.name, files: s.files, specs, why: 'zero measurable statements' });
      continue;
    }
    if (specs === 0) {
      vacuous.push({
        project: p.name,
        files: s.files,
        specs,
        why: `${s.sTotal} statement(s) but no spec files`,
      });
      continue;
    }
    out.push({ project: p.name, specs, unmeasured, ...s });
  }
  return out.sort((a, b) => a.project.localeCompare(b.project));
}

/**
 * Source files that contribute **zero measured statements**, so they sit outside the denominator.
 *
 * ## Two ways to be invisible, one consequence
 *
 * 1. **Absent from the report.** v8 only instruments a file some test imports, so a file no spec
 *    reaches is not reported as 0% — it is missing entirely.
 * 2. **Present with an empty statement map.** The report lists the file and records no statements
 *    at all. `search-filters-drawer.component.ts` is 1303 lines with ~465 executable lines and
 *    appears this way; the `search` project therefore reported 56.49% over 848 statements while
 *    its largest component contributed nothing to either side of that fraction.
 *
 * Only case 1 was checked before. Case 2 passed every check: the file IS in the report, so the
 * absent-file test is satisfied, and the project has plenty of statements, so the project-level
 * `sTotal === 0` vacuous test is satisfied too. Repo-wide, case 2 hides **67 files with
 * executable code** — including inside `shared-extensions` (96.04%) and `permission-dialogs`
 * (93.85%), two of the five projects counted as meeting the Beta bar.
 *
 * The cause differs between the two; the consequence does not. Untested code is invisible rather
 * than failing, so both are reported the same way and allowlisted the same way.
 *
 * ## The `noStatements` category
 *
 * 63 zero-statement files legitimately have none — pure type declarations, `export *` barrels,
 * constant tables. Those cannot be "tested" and a dated deadline for them would be a lie, so they
 * get a permanent exemption in a separate list. It is self-policing: if such a file ever gains a
 * statement, its entry is reported stale and must be removed, which is what stops the permanent
 * list becoming a dumping ground.
 *
 * @param {string} root project root, repo-relative
 * @param {Record<string, unknown>} data the parsed `coverage-final.json`
 * @returns {Promise<{file: string, why: 'absent'|'empty'}[]>} sorted by path
 */
async function findUnmeasured(root, data) {
  const abs = resolve(repoRoot, root);
  if (!existsSync(abs)) return [];
  // Report keys are absolute already, but resolve anyway: a relative key would never match and
  // would flag every file in the project.
  const statementsByFile = new Map(
    Object.entries(data).map(([f, d]) => [
      resolve(repoRoot, f),
      Object.keys((d ?? {}).s ?? {}).length,
    ]),
  );
  const out = [];
  for await (const f of walk(abs, ['node_modules', 'dist', 'coverage', '.nx'])) {
    if (!f.endsWith('.ts')) continue;
    // Specs, type-only declarations, the test harness, stories and the Storybook config carry no
    // shippable statements: each is excluded from the project's `tsconfig.lib.json`.
    if (/\.spec\.ts$|\.d\.ts$|(^|\/)test-setup\.ts$|\.stories\.ts$|\/\.storybook\//.test(f)) {
      continue;
    }
    const n = statementsByFile.get(f);
    if (n === undefined) out.push({ file: relative(repoRoot, f), why: 'absent' });
    else if (n === 0) out.push({ file: relative(repoRoot, f), why: 'empty' });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

async function discoverProjects() {
  const found = [];
  for await (const file of walk(repoRoot, ['node_modules', 'dist', '.git', 'coverage', '.nx'])) {
    if (!file.endsWith('/project.json')) continue;
    let j;
    try {
      j = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    const t = j.targets?.test;
    if (!t) continue;
    const root = relative(repoRoot, resolve(file, '..'));
    const name = j.name ?? root;
    if (t.executor === '@nx/vitest:test' && t.options?.reportsDirectory) {
      found.push({ name, root, kind: 'vitest', reportsDirectory: t.options.reportsDirectory });
    } else {
      found.push({ name, root, kind: 'other' });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Vitest's v8 provider writes istanbul-shaped data: `s`/`b`/`f` are hit counts
 * keyed by entries in `statementMap`/`branchMap`/`fnMap`.
 *
 * Two line figures. The ratchet's `lines` is the statement percentage, as recorded in the
 * baseline since the gate began. `lTotal`/`lCovered` are exact, the way istanbul derives lines:
 * each distinct start line is one line, covered if any statement on it ran. A floor reads those,
 * because it is a line floor and nine statements on one line are still one line. Under v8 the two
 * agree — it emits one statement per line, and on 2026-10-09 every one of 28,593 statements in
 * 308 files started on a line of its own — so this changes no figure today; it stops the floor
 * depending on that.
 * @param {Record<string, any>} data
 */
function summarise(data) {
  let sTotal = 0,
    sCovered = 0,
    lTotal = 0,
    lCovered = 0,
    bTotal = 0,
    bCovered = 0,
    fTotal = 0,
    fCovered = 0,
    files = 0;
  for (const entry of Object.values(data)) {
    files += 1;
    // Skip the branch/function tallies for a file with no statements.
    //
    // v8 gives a never-imported file an entry with an empty `statementMap` PLUS a synthetic
    // `fnMap`/`branchMap` pair named `(empty-report)`, both recorded as HIT — `f: {0: 1}`,
    // `b: {0: [1]}`. So every untested file donated one free covered function and one free
    // covered branch with no uncovered counterpart, inflating both percentages by exactly the
    // number of unmeasured files. `adf-hx-bridge` had eighteen such files.
    //
    // Statements and lines were never affected, which is why this hid: the headline number the
    // ratchet acts on was right while the two beside it were not.
    const hasStatements = Object.keys(entry.s ?? {}).length > 0;
    const lineHits = new Map();
    for (const [id, hits] of Object.entries(entry.s ?? {})) {
      sTotal += 1;
      if (hits > 0) sCovered += 1;
      const line = entry.statementMap?.[id]?.start?.line;
      if (line !== undefined) lineHits.set(line, Math.max(lineHits.get(line) ?? 0, hits));
    }
    lTotal += lineHits.size;
    for (const hits of lineHits.values()) if (hits > 0) lCovered += 1;
    if (hasStatements) {
      for (const arr of Object.values(entry.b ?? {})) {
        for (const hits of arr ?? []) {
          bTotal += 1;
          if (hits > 0) bCovered += 1;
        }
      }
    }
    if (!hasStatements) continue;
    for (const hits of Object.values(entry.f ?? {})) {
      fTotal += 1;
      if (hits > 0) fCovered += 1;
    }
  }
  // `t === 0 -> 100` is defensible for branches and functions: a file with no branches
  // really is fully branch-covered, and that is what istanbul's own summary reports.
  //
  // It is NOT defensible for statements, and the previous version applied it there too.
  // `tasks` and `assets` emit reports with files but *zero* statements, so 0/0 scored 100
  // and both were recorded in the baseline as meeting the 90% Beta bar. That number reached
  // the plan, the delivery record and a leadership page as "5 of 17 projects meet 90%",
  // when the true count was 3. A gate that reports full coverage for a project with no
  // measurable code does not overstate by a rounding error — it inverts the answer.
  //
  // So statement/line coverage of nothing is `null` — *unmeasurable*, a third state
  // distinct from both pass and fail — and `sTotal` is returned so the caller can say why.
  const pct = (c, t) => (t === 0 ? 100 : round((c / t) * 100));
  const stmts = sTotal === 0 ? null : round((sCovered / sTotal) * 100);
  return {
    files,
    sTotal,
    // Returned so the ratchet can compare absolute counts, not only percentages. A
    // percentage alone cannot tell "tests were deleted" from "a previously uninstrumented
    // file entered the denominator" — see the comparability check in the main flow.
    sCovered,
    lTotal,
    lCovered,
    statements: stmts,
    branches: pct(bCovered, bTotal),
    functions: pct(fCovered, fTotal),
    lines: stmts,
  };
}

/**
 * Count `*.spec.ts` under a project root.
 *
 * Zero statements is not the only way to be vacuous. `core` reports 100% from **7**
 * statements and **no spec files at all** — incidental execution during module import,
 * not coverage. A project with no specs has not been tested, whatever the percentage
 * says, so it must not be counted towards the Beta bar either.
 * @param {string} root
 */
/**
 * The newest mtime among a project's `.ts` files, so `collect()` can tell whether the coverage
 * report it is about to trust predates the code it claims to describe.
 */
async function newestSourceMtime(root) {
  const abs = resolve(repoRoot, root);
  if (!existsSync(abs)) return 0;
  let newest = 0;
  for await (const f of walk(abs, ['node_modules', 'dist', 'coverage', '.nx'])) {
    if (!f.endsWith('.ts')) continue;
    const m = (await stat(f)).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}

async function countSpecs(root) {
  const abs = resolve(repoRoot, root);
  if (!existsSync(abs)) return 0;
  let n = 0;
  for await (const f of walk(abs, ['node_modules', 'dist', 'coverage', '.nx'])) {
    if (/\.spec\.ts$/.test(f)) n += 1;
  }
  return n;
}

async function* walk(dir, skip = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, skip);
    else yield full;
  }
}

/* ---------- output ---------- */

/**
 * The shape of one baseline entry.
 *
 * Extracted because it was written out in **two** places — here and in the `--update-baseline`
 * merge — and they drifted the moment absolute counts were added: the merge kept building
 * percentage-only objects, `write()` read `m.sTotal` as `undefined`, and `JSON.stringify`
 * dropped the key. The baseline then looked correctly updated while silently omitting the very
 * field the update was for. One definition, so the two cannot disagree again.
 *
 * `sTotal`/`sCovered` are the absolute counts. Recording percentages alone is what let
 * `collections` carry 81.67% — earned over 633 statements belonging to four permission dialogs
 * that have since moved to `libs/shared/permission-dialogs` — into a project whose current
 * contents measure 829. That figure reconciles to the digit against the old file set and to
 * nothing at all against the new one, and the gate could not tell, because it never stored the
 * size of what it measured.
 */
function entryFor(m) {
  return {
    lines: m.lines,
    statements: m.statements,
    branches: m.branches,
    functions: m.functions,
    sTotal: m.sTotal,
    sCovered: m.sCovered,
  };
}

async function write(list, why) {
  const projects = {};
  for (const m of list) {
    projects[m.project] = entryFor(m);
  }
  await mkdir(resolve(repoRoot, '.ai/state'), { recursive: true });
  const body = {
    $comment: [
      'Coverage ratchet baseline. `npm run beta:coverage` fails if a project drops below',
      'its entry here by more than 0.5pp. Raise these by writing tests, never by editing',
      'the file to match a regression.',
      `Beta target is ${TARGET}% (docs/adf-hx-beta-plan.md, Phase 6).`,
    ],
    target: TARGET,
    tolerance: TOLERANCE,
    projects,
  };
  await writeFile(baselinePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  console.log(`coverage-gate: baseline written (${why}) -> ${relative(repoRoot, baselinePath)}`);
  for (const [p, v] of Object.entries(projects).sort()) {
    const gap = round(TARGET - v.lines);
    console.log(
      `  ${p.padEnd(28)} ${String(v.lines).padStart(6)}%  ${gap > 0 ? `${gap}pp short of ${TARGET}%` : `meets ${TARGET}%`}`,
    );
  }
}

function report() {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          // `ok` must agree with the exit code, so every blocking category belongs in it.
          // The uninstrumented checks were reported to a human and omitted here first, which
          // would have let an evidence manifest record a clean pass while the gate had failed.
          ok:
            stale.length === 0 &&
            floorFailures.length === 0 &&
            regressions.length === 0 &&
            orphaned.length === 0 &&
            unratcheted.length === 0 &&
            falseCredit.length === 0 &&
            unlisted.length === 0 &&
            expired.length === 0 &&
            staleAllowlist.length === 0,
          stale,
          target: TARGET,
          floors: { configured: FLOORS, failures: floorFailures },
          rows,
          meetingTarget: rows.filter((r) => r.target <= 0).map((r) => r.project),
          // Scope-aware view of the bar. `meetingTarget` above counts every project,
          // including ones the plan puts out of Beta scope, so quoting it as "N of M meet
          // the Beta bar" overstates the denominator in one direction and the debt in the
          // other. These two are the figures worth citing.
          betaScope: {
            inScope: rows.filter((r) => inBetaScope(r.project)).map((r) => r.project),
            meetingTargetInScope: rows
              .filter((r) => inBetaScope(r.project) && r.target <= 0)
              .map((r) => r.project),
            shortInScope: rows
              .filter((r) => inBetaScope(r.project) && r.target > 0)
              .map((r) => ({ project: r.project, lines: r.lines, short: r.target })),
            outOfScope: Object.fromEntries(
              rows
                .filter((r) => !inBetaScope(r.project))
                .map((r) => [r.project, OUT_OF_SCOPE[r.project]]),
            ),
          },
          regressions,
          rises,
          // A percentage drop that is not a regression: the denominator grew because
          // uninstrumented files entered the measurement. Recorded so the drop is explicable
          // to anyone reading the evidence later rather than looking like a silent loosening.
          expanded,
          unmeasured,
          orphaned,
          unratcheted,
          vacuous,
          falseCredit,
          unmeasured: {
            total: unmeasuredAll.length,
            absent: unmeasuredAll.filter((u) => u.why === 'absent').length,
            empty: unmeasuredAll.filter((u) => u.why === 'empty').length,
            exempt: unmeasuredAll.filter((u) => noStatementsAllowlist.has(u.file)).length,
            unlisted,
            expired,
            staleAllowlist,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\nCoverage ratchet — ${rows.length} project(s) measured, Beta target ${TARGET}%\n`);
  // `stmts` and `specs` are shown because a percentage without its denominator is what made
  // this gate wrong in the first place. `core` reports a truthful 100% over **7** statements
  // from one generated "should create" spec; printed as a bare `100%` it reads identically to
  // `shared-app-config`'s 100% over 428. The column is the difference between the two.
  // `excluded` is the second half of that same argument, and the more dangerous half. A file no
  // test imports contributes zero statements, so it is omitted from the denominator entirely and
  // *cannot* lower the percentage. `ui` reported a clean 100% while 1,519 lines across nine files
  // sat outside the measurement, and `search` reported 91.16% with a 1,303-line filters drawer
  // excluded. Printed as a bare percentage those read as "fully tested". Nearly 7,000 in-scope
  // lines are in this state, so the column is the difference between a true number and an
  // honest one.
  console.log(
    `  ${'project'.padEnd(28)} ${'lines'.padStart(7)} ${'was'.padStart(7)} ${'delta'.padStart(7)} ${'stmts'.padStart(6)} ${'specs'.padStart(5)} ${'excluded'.padStart(14)}   gap to ${TARGET}%`,
  );
  for (const r of rows) {
    const was = r.was === null ? '  new' : `${r.was}%`;
    const delta = r.delta === null ? '    -' : `${r.delta > 0 ? '+' : ''}${r.delta}`;
    const ex = excludedFor(r.project);
    const exCol = ex.files === 0 ? '—' : `${ex.files}f / ${ex.lines}L`;
    console.log(
      `  ${r.project.padEnd(28)} ${`${r.lines}%`.padStart(7)} ${was.padStart(7)} ${delta.padStart(7)} ` +
        `${String(r.sTotal ?? '-').padStart(6)} ${String(r.specs ?? '-').padStart(5)} ${exCol.padStart(14)}   ` +
        `${r.target > 0 ? `${r.target}pp short` : 'met'}`,
    );
  }
  const totalExcluded = rows.reduce((sum, r) => sum + excludedFor(r.project).lines, 0);
  if (totalExcluded > 0) {
    console.log(
      `\n  excluded = source files no test imports, so they contribute no statements and cannot\n` +
        `  lower the percentage beside them. ${totalExcluded} line(s) across these projects are in\n` +
        `  that state, dated in .ai/state/coverage-uninstrumented-allowlist.json. A percentage in\n` +
        `  this table is a statement about the measured subset, not about the project.`,
    );
  }

  // The headline number, printed rather than left to be counted by hand. "5 of 17 meet 90%"
  // reached three documents because nothing ever stated the figure the gate itself supported.
  const meeting = rows.filter((r) => r.target <= 0);
  const thin = meeting.filter((r) => r.sTotal < THIN_STATEMENTS);
  console.log(
    `\n  ${meeting.length} of ${rows.length} measured project(s) meet ${TARGET}%` +
      (meeting.length ? `: ${meeting.map((r) => r.project).join(', ')}` : ''),
  );
  if (thin.length) {
    // Reported, not excluded. Dropping these from the count would be a second arbitrary
    // rule to argue about; naming them lets the reader apply their own judgement.
    console.log(
      `  Of those, ${thin.length} clear${thin.length === 1 ? 's' : ''} the bar over fewer than ` +
        `${THIN_STATEMENTS} statements — ${thin.map((r) => `${r.project} (${r.sTotal})`).join(', ')}.\n` +
        `  Truthful, but it says nothing about quality. Substantively covered: ` +
        `${meeting.length - thin.length}.`,
    );
  }
  if (vacuous.length) {
    console.log(
      `  ${vacuous.length} further project(s) produced a report with nothing measurable —` +
        ' excluded from that count, listed below.',
    );
  }

  if (unmeasured.length) {
    console.log(`\n  Not measured this run (outside the affected set): ${unmeasured.join(', ')}`);
    console.log('  Their baseline entries are unchanged; this run says nothing about them.');
  }

  if (vacuous.length) {
    console.log('\n  Unmeasurable — a report was produced, but it measures nothing:');
    for (const v of vacuous) {
      console.log(
        `    ${v.project.padEnd(26)} ${v.files} file(s), ${v.specs} spec file(s) — ${v.why}`,
      );
    }
    console.log(
      '    These previously scored 100% (0/0 statements) and were recorded as meeting the\n' +
        '    Beta bar. They are neither passing nor failing: they are untested.',
    );
  }

  if (orphaned.length) {
    console.log(`\n  Baseline names ${orphaned.length} project(s) this workspace does not have:`);
    for (const p of orphaned) console.log(`    ${p}`);
  }

  if (unratcheted.length) {
    console.log(`\n  Measured but absent from the baseline, so nothing guards them:`);
    for (const p of unratcheted) console.log(`    ${p}`);
  }

  if (rises.length) {
    console.log('\n  Improved — run --update-baseline to lock these in:');
    for (const r of rises) console.log(`    ${r.project}  ${r.was}% -> ${r.now}%  (+${r.delta}pp)`);
  }

  if (expanded.length) {
    console.log(
      '\n  Percentage fell but coverage did not — the denominator grew as uninstrumented\n' +
        '  files entered the measurement. Not a regression:',
    );
    for (const e of expanded) {
      console.log(
        `    ${e.project}  ${e.was}% -> ${e.now}%  (${e.delta}pp)  ` +
          `covered ${e.wasCovered} -> ${e.nowCovered} of ${e.wasTotal} -> ${e.nowTotal} statements`,
      );
    }
    console.log(
      '    Strictly more statements are covered than before, so nothing that was tested\n' +
        '    became untested. Run --update-baseline to record the honest figure.',
    );
  }

  if (unmeasuredAll.length) {
    const exempt = unmeasuredAll.filter((u) => noStatementsAllowlist.has(u.file)).length;
    const debt = unmeasuredAll.length - exempt;
    const allowed = debt - unlisted.length - expired.length;
    const absent = unmeasuredAll.filter((u) => u.why === 'absent').length;
    const empty = unmeasuredAll.length - absent;
    console.log(
      `\n  Unmeasured — ${unmeasuredAll.length} source file(s) contribute zero statements ` +
        `(${absent} absent from the report, ${empty} present with an empty statement map):`,
    );
    const byProject = {};
    for (const u of unmeasuredAll) {
      if (noStatementsAllowlist.has(u.file)) continue;
      (byProject[u.project] ??= []).push(u.file);
    }
    for (const [project, files] of Object.entries(byProject)) {
      console.log(`    ${project} (${files.length})`);
    }
    console.log(
      '    Either way the code is outside the denominator, so it cannot lower the percentage —\n' +
        '    untested code is invisible here, not failing.\n' +
        `    ${exempt} exempt (no statements to measure), ${allowed} dated/unexpired, ` +
        `${unlisted.length} unlisted, ${expired.length} expired.`,
    );
  }

  if (stale.length) {
    console.log(
      `\n  STALE REPORTS — ${stale.length} project(s) have source newer than their coverage report, ` +
        'or a report counting deleted files:',
    );
    for (const t of stale) {
      const parts = [`report ${t.report}`];
      if (t.source) parts.push(`source ${t.source}`);
      if (t.gone?.length)
        parts.push(`counts ${t.gone.length} deleted file(s): ${t.gone.join(', ')}`);
      console.log(`    ${t.project.padEnd(24)} ${parts.join('  ')}`);
    }
    console.log(
      '    These numbers describe code that has since changed, so nothing below can be\n' +
        '    trusted for them. Re-run the tests with coverage before reading this.',
    );
  }

  if (staleAllowlist.length) {
    console.log(
      `\n  Stale allowlist — ${staleAllowlist.length} entr(ies) name a file that is now covered or gone:`,
    );
    for (const f of staleAllowlist) console.log(`    ${f}`);
  }

  reportFloors();

  console.log('');
  if (
    stale.length ||
    floorFailures.length ||
    orphaned.length ||
    unratcheted.length ||
    falseCredit.length ||
    unlisted.length ||
    expired.length ||
    staleAllowlist.length
  ) {
    const parts = [];
    if (stale.length) parts.push(`${stale.length} stale coverage report(s)`);
    if (floorFailures.length) parts.push(`${floorFailures.length} unmet coverage floor(s)`);
    if (orphaned.length) parts.push(`${orphaned.length} orphaned baseline entr(ies)`);
    if (unratcheted.length) parts.push(`${unratcheted.length} unratcheted project(s)`);
    if (falseCredit.length) parts.push(`${falseCredit.length} unmeasurable baseline entr(ies)`);
    if (unlisted.length) parts.push(`${unlisted.length} unlisted uninstrumented file(s)`);
    if (expired.length) parts.push(`${expired.length} expired uninstrumented entr(ies)`);
    if (staleAllowlist.length) parts.push(`${staleAllowlist.length} stale allowlist entr(ies)`);
    console.log(`coverage-gate: FAIL — ${parts.join(', ')}.`);
    if (falseCredit.length) {
      const names = falseCredit.map((v) => v.project);
      console.log(
        `\n  ${names.join(', ')} carr${names.length === 1 ? 'ies' : 'y'} a recorded percentage in\n` +
          '  .ai/state/coverage-baseline.json but ha' +
          (names.length === 1 ? 's' : 've') +
          ' nothing measurable. Remove the\n' +
          '  entr' +
          (names.length === 1 ? 'y' : 'ies') +
          ' with --update-baseline, or write the tests that make the number real.\n' +
          '  A recorded 100% here is not a harmless placeholder: it is counted as meeting the\n' +
          `  ${TARGET}% Beta bar, and that inflated count has already reached the plan, the\n` +
          '  delivery record and a leadership page.',
      );
    }
    if (orphaned.length) {
      console.log(
        `\n  Remove ${orphaned.join(', ')} from .ai/state/coverage-baseline.json.\n` +
          '  A baseline entry for a project that no longer exists prints "not measured,\n' +
          '  unchanged" on every run forever — a permanent line of reassurance about\n' +
          "  nothing. This gate's authority rests on that file being true.",
      );
    }
    if (unratcheted.length) {
      console.log(
        `\n  Add ${unratcheted.join(', ')} with --update-baseline. Until then they are\n` +
          '  printed as `new` and excluded from every check, so their coverage could fall\n' +
          '  to zero without this gate saying a word.',
      );
    }
    if (unlisted.length) {
      console.log(
        `\n  ${unlisted.length} source file(s) contribute zero statements and are in neither\n` +
          '  list in .ai/state/coverage-uninstrumented-allowlist.json:',
      );
      for (const u of unlisted) console.log(`    ${u.project}  [${u.why}]  ${u.file}`);
      console.log(
        '\n  Write a spec; or add a dated entry under `files` if it has code that is not\n' +
          '  tested yet; or add it under `noStatements` if it genuinely has nothing to measure\n' +
          '  (types, an `export *` barrel, a constant table).\n\n' +
          '  A file contributing zero statements is omitted from the denominator, so it cannot\n' +
          '  lower the percentage. `[absent]` means no test imports it — that is how adf-hx-bridge\n' +
          "  reported 65.61% with eight untested API ports, Phase 3's deliverable, outside the\n" +
          '  measurement. `[empty]` means the report lists it with no statements at all — that is\n' +
          '  how search reported 56.49% while its 1303-line filters drawer counted for nothing.',
      );
    }
    if (expired.length) {
      console.log(`\n  ${expired.length} uninstrumented file(s) whose acceptance has expired:`);
      for (const e of expired) console.log(`    ${e.file}  (until ${e.until})`);
      console.log(
        '\n  The date has passed. Write the spec, or move the date and say why in the entry —\n' +
          '  deliberately, as a decision someone can be held to, not as a quiet edit.',
      );
    }
    if (staleAllowlist.length) {
      console.log(
        `\n  Remove ${staleAllowlist.length} stale entr(ies) from the uninstrumented allowlist —\n` +
          '  those files are now instrumented or deleted. An exception that outlives the problem\n' +
          '  it described is false reassurance, and it makes the remaining entries look reviewed\n' +
          '  when they have not been.',
      );
    }
    // Integrity failures do NOT hide a regression. This used to `return` here, so with any
    // of the checks above firing the console reported only them and said nothing about a
    // project that had lost coverage — a real 2.89pp drop in `adf-hx-bridge` was visible
    // only via `--json`. An unrelated failure masking the gate's primary finding is the
    // worst possible failure mode for a gate whose whole purpose is to notice a decline.
    reportRegressions(regressions);
    reportBetaBar(rows);
    return;
  }
  if (regressions.length) {
    reportRegressions(regressions);
    reportBetaBar(rows);
  } else {
    console.log(`coverage-gate: pass — no project regressed by more than ${TOLERANCE}pp.`);
    reportBetaBar(rows);
  }
}

/** After a baseline write: a floor is not something `--update-baseline` can record its way past. */
function exitOnFloorFailures() {
  if (floorFailures.length === 0) return;
  reportFloors();
  console.log(`\ncoverage-gate: FAIL — ${floorFailures.length} unmet coverage floor(s).`);
  process.exit(1);
}

/** The `FLOORS` verdict, printed on every run so a met floor is visible as well as a missed one. */
function reportFloors() {
  const projectsWithFloors = Object.keys(FLOORS);
  if (projectsWithFloors.length === 0) return;
  console.log('\n  Hard floors — must be met on every run, not ratcheted:');
  for (const project of projectsWithFloors) {
    const failures = floorFailures.filter((f) => f.project === project);
    const m = measured.find((x) => x.project === project);
    if (failures.length === 0) {
      console.log(
        `    ${project.padEnd(24)} ${String(truncatedPercent(m.lCovered, m.lTotal)).padStart(6)}%  ` +
          `meets ${FLOORS[project]}% (${m.lCovered} of ${m.lTotal} lines; every unmeasured file ` +
          'is statement-free)',
      );
      continue;
    }
    console.log(`    ${project.padEnd(24)} FAIL — floor ${FLOORS[project]}%:`);
    for (const f of failures) console.log(`      - ${f.why}`);
  }
  if (floorFailures.length) {
    console.log(
      '\n  Write the missing tests. A floor project cannot take a dated allowlist entry or a\n' +
        '  lower baseline: the floor applies from its first commit, so each component brings\n' +
        '  its specs with it.',
    );
  }
}

/**
 * Report progress against the Beta bar, separating the slice from what is out of scope.
 *
 * Reporting one "furthest from the bar" figure across every project named whichever
 * library happened to be lowest, which was usually one the plan does not hold to the bar at
 * all. That reads as Beta debt and hides the projects that actually are short.
 *
 * @param {{ project: string, lines: number, target: number }[]} rows
 */
function reportBetaBar(rows) {
  const scoped = rows.filter((r) => inBetaScope(r.project));
  const short = scoped.filter((r) => r.target > 0).sort((a, b) => b.target - a.target);
  const met = scoped.length - short.length;

  console.log(
    `\n  Beta bar (${TARGET}%), in-scope slice only: ${met} of ${scoped.length} project(s) meet it.`,
  );
  for (const r of short) {
    console.log(`    ${r.project.padEnd(24)} ${String(r.lines).padStart(6)}%  ${r.target}pp short`);
  }
  if (short.length === 0) console.log('    every in-scope project meets the bar.');

  // Named, not silently dropped: an exemption nobody can see is an exemption nobody reviews.
  const excused = rows.filter((r) => !inBetaScope(r.project) && r.target > 0);
  if (excused.length > 0) {
    console.log(
      `\n  Out of Beta scope, so not held to ${TARGET}% (the ratchet still applies to them):`,
    );
    for (const r of excused) {
      console.log(
        `    ${r.project.padEnd(24)} ${String(r.lines).padStart(6)}%  — ${OUT_OF_SCOPE[r.project]}`,
      );
    }
  }
}

/**
 * Files and source lines a project has in the dated allowlist — code no test imports, so it
 * sits outside the denominator and cannot affect the percentage.
 *
 * Keyed by walking the allowlist paths rather than by asking Nx, because the entries are plain
 * repository paths and a few are recorded relative to `nuxeo-client`'s lib root.
 *
 * @param {string} project
 * @returns {{ files: number, lines: number }}
 */
function excludedFor(project) {
  let files = 0;
  let lines = 0;
  for (const entry of Object.keys(datedAllowlist)) {
    if (projectForPath(entry) !== project) continue;
    files += 1;
    lines += countLines(entry);
  }
  return { files, lines };
}

/** @param {string} entry @returns {number} */
function countLines(entry) {
  for (const candidate of [
    resolve(repoRoot, entry),
    resolve(repoRoot, 'libs/shared/nuxeo-client/src/lib', entry),
  ]) {
    if (!existsSync(candidate)) continue;
    try {
      return readFileSync(candidate, 'utf8').split('\n').length;
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Map a repository path to the Nx project name the coverage rows use.
 *
 * @param {string} entry
 * @returns {string}
 */
function projectForPath(entry) {
  const match = /^libs\/(?:features|shared|extensions)\/([^/]+)\//.exec(entry);
  if (!match) return entry.startsWith('apps/') ? 'nuxeo-ui' : 'nuxeo-client';
  const dir = match[1];
  // Four shared libraries are published under a name that differs from their directory.
  const renamed = {
    ui: 'ui',
    'nuxeo-client': 'nuxeo-client',
    extensions: 'shared-extensions',
    'app-config': 'shared-app-config',
    'kd-client': 'shared-kd-client',
    'ke-client': 'shared-ke-client',
    'ai-client': 'shared-ai-client',
    util: 'shared-util',
  };
  return renamed[dir] ?? dir;
}

/** @param {{ project: string, was: number, now: number, delta: number }[]} regressions */
function reportRegressions(regressions) {
  if (regressions.length === 0) return;
  console.log(`\ncoverage-gate: FAIL — ${regressions.length} project(s) lost coverage:`);
  for (const r of regressions)
    console.log(`  ${r.project}  ${r.was}% -> ${r.now}%  (${r.delta}pp)`);
  console.log(
    '\n  Add the missing tests. Do not run --update-baseline to make this pass —\n' +
      '  that is the same move as weakening a test, one file further away.',
  );
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/** Node 22+ shadows jsdom's localStorage; see scripts/beta-harness/node-version.mjs. */
function webstorageOptOut() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) return {};
  return {
    NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--no-experimental-webstorage']
      .filter(Boolean)
      .join(' '),
  };
}
