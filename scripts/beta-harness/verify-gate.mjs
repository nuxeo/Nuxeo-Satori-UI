#!/usr/bin/env node
/**
 * Beta phase verification gate.
 *
 * Runs the repository's quality gates in the cheapest-first order and writes a
 * structured report. Designed to be run repeatedly by an agent until it is
 * green, so it optimises for one thing: telling you the *next* actionable
 * failure without making you read a wall of output.
 *
 * Usage:
 *   node scripts/beta-harness/verify-gate.mjs [options]
 *
 * Options:
 *   --phase <id>     label the report, e.g. phase-3-document-list
 *   --gates <list>   comma separated subset of the ids in ALL_GATES below. Passing an
 *                    unknown one prints the full current list, so that is the
 *                    authoritative enumeration rather than this line, which went stale
 *                    twice while gates were added.
 *   --base <ref>     git base for affected calculation (default origin/main)
 *   --tail <n>       lines of failing output to show (default 40)
 *
 * Examples:
 *   node scripts/beta-harness/verify-gate.mjs --gates guardrails,lint
 *   node scripts/beta-harness/verify-gate.mjs --phase phase-1-config --base main
 *
 * Exit code is 1 if any gate failed.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const [k, inline] = a.slice(2).split('=', 2);
    args.set(k, inline ?? (process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]));
  }
}

const phase = args.get('phase') ?? 'adhoc';
const base = args.get('base') ?? process.env['NX_BASE'] ?? 'origin/main';
const tail = Number(args.get('tail') ?? 40);

/**
 * Ordered cheapest-first. Stopping at the first failure is deliberate: a lint
 * error usually explains the test failure that would follow, and running the
 * full set on a known-broken tree wastes minutes per iteration.
 */
const ALL_GATES = [
  // Gate zero, and the cheapest of all: is this runtime one whose results mean
  // anything? An agent on the wrong Node major gets a red that is indistinguishable
  // from a code defect, and the obvious response — edit the failing spec — damages
  // working code. That happened. This gate makes it impossible to happen silently.
  {
    id: 'node',
    label: 'Node runtime preflight',
    cmd: 'node',
    argv: ['scripts/beta-harness/node-version.mjs'],
    // The warning text is the whole point, so surface it even when the gate passes.
    echoOnPass: true,
  },
  // Next because it is the next cheapest and because Phase 2 proved it is the one
  // failure none of the others can see: nothing downstream checks that the lock's
  // dependency edges resolve, so a lock that `npm ci` will refuse on Linux leaves
  // every local gate green.
  {
    id: 'lockfile',
    label: 'Lockfile integrity',
    cmd: 'node',
    argv: ['scripts/beta-harness/lockfile-integrity.mjs'],
  },
  // And the lockfile gate's own negative controls, because that gate has now been wrong in both
  // directions: it matched dependency names but not versions (green on the very lock that kept
  // CI red for all of Phase 2), and then its override waiver dropped the version selector off
  // `brace-expansion@^5.0.0` and excused every major of a package whose tree holds three. Both
  // were caught by a human reading it, which is the part this closes.
  {
    id: 'lockfile-selftest',
    label: 'Lockfile integrity controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/lockfile-integrity.selftest.mjs'],
  },
  // NXSAT-308 criterion 3: none of adf-hx, adf-core, adf-extensions, js-api or hxcs-js-client in
  // the lock, the installed tree, a manifest, `.npmrc` or an import. Next to `lockfile` because both
  // read the dependency tree. REPORT-ONLY until the ADF removal commit flips `BLOCKING` in the
  // script, so on main it is green while listing every finding — which is why it echoes on a pass:
  // the list is the removal backlog. It still fails in report-only mode when a location cannot be
  // read, and when the tree is clean but nobody flipped the switch.
  {
    id: 'dependency-tree',
    label: 'Dependency tree (ADF removal)',
    cmd: 'node',
    argv: ['scripts/beta-harness/dependency-tree.mjs'],
    echoOnPass: true,
  },
  // Its negative controls. A report-only gate is green whatever it finds, so without these it could
  // regress into a scanner that finds nothing and stay green until the day it became blocking.
  {
    id: 'dependency-tree-selftest',
    label: 'Dependency tree controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/dependency-tree.selftest.mjs'],
    // The negative/quiet/listing split is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  // Phase 6 step 4 gate: SCA with teeth, next to `lockfile` because both read the dependency
  // tree — one asks whether it resolves, this one asks whether it is safe to ship.
  //
  // It gates on `npm audit --omit=dev`, not the full audit. The dev-inclusive total is 9 high
  // and 13 moderate, none of which reaches a customer; gating on that would be permanently red,
  // and a gate that cannot pass gets bypassed and then ignored. The dev total is reported on
  // every run so it cannot be quietly forgotten either.
  //
  // Needs network access to the registry, which is why it sits early enough to fail fast rather
  // than after eight minutes of builds.
  {
    id: 'supply-chain',
    label: 'Supply chain',
    cmd: 'node',
    argv: ['scripts/beta-harness/supply-chain.mjs'],
    // The accepted-advisory notes and the dev-inclusive total are the evidence, not noise.
    echoOnPass: true,
  },
  // Phase 6 step 4 gate: read the SAST results. Registered on 2026-08-25, after the 21 alerts it
  // found were fixed and it could be shown green rather than asserted.
  //
  // Sits next to `supply-chain` because they answer the two halves of the same question — is what
  // we depend on safe, and is what we wrote safe. Needs `gh` and network access, so it is the only
  // gate with an explicit skip (`BETA_SKIP_CODE_SCANNING=1`), which prints NOT RUN rather than pass.
  {
    id: 'code-scanning',
    label: 'Code scanning (CodeQL)',
    cmd: 'node',
    argv: ['scripts/beta-harness/code-scanning.mjs'],
    // The ref, the analysis count and the alert count are the evidence.
    echoOnPass: true,
  },
  {
    id: 'guardrails',
    label: 'Review guardrails',
    cmd: 'node',
    argv: ['scripts/review-guardrails.mjs', '--base', base],
  },
  // The i18n guardrails' negative controls, registered for the same reason as
  // `sanitizer-selftest` below: the controls are the entire basis for trusting the guardrail, so
  // running them must not be optional.
  //
  // Eleven guardrails shipped before this existed with no tests at all, and two of the three it
  // covers were written with a defect the controls found — an unguarded `JSON.parse` that crashed
  // the whole script, discarding every other guardrail's diagnostics, and a parity branch that
  // reported "no en.json" for a file that was present but unparseable.
  //
  // Unlike `sanitizer-selftest` this touches nothing tracked: it builds a throwaway git repository
  // per control under `os.tmpdir()`, so it is safe to run concurrently with anything.
  {
    id: 'guardrails-selftest',
    label: 'i18n guardrail negative controls',
    cmd: 'node',
    argv: ['scripts/review-guardrails.selftest.mjs'],
    // The negative/positive split is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  {
    id: 'crowdin-selftest',
    label: 'Crowdin script controls',
    // Both suites behind one gate, via the npm script, so adding the status report did not add a
    // gate. The count in the verdict line is quoted in docs and in CLAUDE.md; a second entry here
    // would have made all of those wrong for a diagnostic that cannot break the application.
    cmd: 'npm',
    argv: ['run', '--silent', 'review:crowdin-selftest'],
    // The negative/positive split is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  // SonarCloud security remediation harness (section 5 of docs/sonarcloud-security-remediation-plan.md).
  // Enforces that every DomSanitizer.bypassSecurityTrust* call is registered in
  // .ai/state/sanitizer-allowlist.json with a written justification. Catches unregistered bypasses,
  // stale allowlist entries, Category A regressions (redundant bypasses), Safe* values in NONE
  // contexts (source[src], audio[src], video[poster]), and unpaired HTML sanitization.
  // Sits next to guardrails because both are static code checks with no compilation required.
  {
    id: 'sanitizer-audit',
    label: 'Sanitizer bypass audit',
    cmd: 'node',
    argv: ['scripts/beta-harness/sanitizer-audit.mjs'],
  },
  // The audit's negative controls, registered as a gate rather than left as an optional script.
  //
  // Until this entry existed, `beta:gate` ran `sanitizer-audit.mjs` but nothing ran its selftest, so
  // the audit could regress into an always-green implementation with every required check still
  // passing. The controls are the entire basis for trusting the audit; a gate whose evidence is
  // optional is a gate on trust rather than on proof — the precise failure `CLAUDE.md` records as
  // having cost this programme three gates.
  //
  // Runs immediately after the audit: it perturbs real files and restores them in a `finally`, so it
  // must not overlap a build, and both are cheap and static.
  {
    id: 'sanitizer-selftest',
    label: 'Sanitizer audit negative controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/sanitizer-audit.selftest.mjs'],
    // Which checks were observed failing on purpose is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  // Static, so it belongs with the cheap gates — and it guards the one thing the
  // other six structurally cannot. Lint, test, build and typecheck all check the
  // *application*; nothing checked whether the *evidence* was capable of failing.
  // Phase 1 shipped a defect past two checks that "certified properties they could
  // not observe", one of which was tautological and missed the very failure it
  // appeared to guard.
  {
    id: 'assertions',
    label: 'Evidence assertion audit',
    cmd: 'node',
    argv: ['scripts/beta-harness/assertion-audit.mjs'],
  },
  {
    id: 'lint',
    label: 'Affected lint',
    cmd: 'npx',
    argv: ['nx', 'affected', '-t', 'lint', `--base=${base}`],
  },
  {
    id: 'test',
    label: 'Affected tests',
    cmd: 'npx',
    argv: ['nx', 'affected', '-t', 'test', `--base=${base}`],
  },
  {
    id: 'build',
    label: 'Affected build',
    cmd: 'npx',
    argv: ['nx', 'affected', '-t', 'build', `--base=${base}`],
  },
  // Libraries have no `build` target — Nx's module-boundary rule forbids a
  // buildable library from importing a non-buildable one, and nothing in
  // `libs/` is buildable until Phase 4 gives them ng-packagr. `typecheck` runs
  // the Angular compiler over a library on its own, so a change confined to one
  // is checked directly rather than only wherever `nuxeo-ui` happens to use it.
  {
    id: 'typecheck',
    label: 'Affected typecheck',
    cmd: 'npx',
    argv: ['nx', 'affected', '-t', 'typecheck', `--base=${base}`],
  },
  // `typecheck` above covers library sources only: it runs the per-project targets, which
  // point at `tsconfig.lib.json`, and that config excludes `*.spec.ts` by construction.
  // Nineteen of twenty-seven projects had no such target at all. So until this gate existed,
  // no gate in the pipeline had ever type-checked a spec file, and 43 errors had accumulated
  // — one of them a production signature stricter than the payload it parsed.
  {
    id: 'spec-types',
    label: 'Spec typecheck',
    cmd: 'node',
    argv: ['scripts/beta-harness/spec-typecheck.mjs'],
  },
  // Last, because it reads the artifact `build` produces. It asks the only question
  // the other gates cannot: what does a customer actually receive? Phase 3's spike
  // found adf-hx importing a test library from its shipped runtime bundle, which put
  // ng-mocks' implementation and two `eval()` calls into a customer-facing chunk.
  {
    id: 'bundle',
    label: 'Bundle contents',
    cmd: 'node',
    argv: ['scripts/beta-harness/no-test-libs-in-bundle.mjs'],
    // It reports VACUOUS when adf-hx is not in the bundle; that has to be visible.
    echoOnPass: true,
  },
  // Phase 4 gate: the publishable platform's API surface must match its snapshot.
  // Runs after `build` because it reads dist/libs/platform/*.d.ts — the bytes a
  // customer actually installs, not the source. A library can gain or lose an
  // export without lint/test/build/typecheck noticing, because every in-repo
  // caller is updated in the same commit; the break lands on the customer.
  {
    id: 'api-surface',
    label: 'API surface',
    cmd: 'node',
    argv: ['scripts/beta-harness/api-surface.mjs'],
  },
  // The gate that asserts the package can be *published*, by running a real
  // `npm publish --dry-run` on a copy of the built bytes. Nothing above it runs a
  // publish, so for the whole of Phase 4 `@nuxeo-satori/platform` was unpublishable —
  // ng-packagr had written a `prepublishOnly` that hard-fails full-mode packages — while
  // every gate here was green and the phase claimed "an upgrade is an npm version bump".
  {
    id: 'publishability',
    label: 'Package publishability',
    cmd: 'node',
    argv: ['scripts/beta-harness/publishability.mjs'],
    // Names which of its five checks are load-bearing; that belongs in the log.
    echoOnPass: true,
  },
  // Publishable is not installable. Every gate above runs inside this monorepo, whose
  // node_modules already holds `@hylandsoftware/satori-ui` from GitHub Packages; a customer's does
  // not, and npm installs every non-optional peer. This installs the built tarball from public npm
  // with no credentials, and re-runs it with the Satori peer made required, which must fail — the
  // risk `docs/publish-readiness.md` §5 recorded as uncovered. Needs registry.npmjs.org.
  {
    id: 'peer-installability',
    label: 'Installs without GitHub Packages',
    cmd: 'node',
    argv: ['scripts/beta-harness/peer-installability.mjs'],
    // The control's outcome is the evidence that the pass means anything.
    echoOnPass: true,
  },
  // Compiles the template against the **built** declarations instead of the source
  // tree, which is the only gate that sees the resolution a customer actually gets.
  // It is what found the platform package being compiled without `strictNullChecks`,
  // shipping 27 wrongly non-nullable types while every other gate was green.
  {
    id: 'fork-simulation',
    label: 'Fork simulation',
    cmd: 'node',
    argv: ['scripts/beta-harness/fork-simulation.mjs'],
  },
  // Phase 6 gate, and the only one that crosses a version boundary. Every gate above tests
  // a single version in isolation, so none of them can see the failure the whole four-layer
  // contract depends on: an upgrade that compiles cleanly and silently drops the customer's
  // customisations. Proven sensitive by removing a manifest-only slot id — the compile stays
  // green and this is the only check that goes red.
  {
    id: 'upgrade-rehearsal',
    label: 'Upgrade rehearsal',
    cmd: 'node',
    argv: ['scripts/beta-harness/upgrade-rehearsal.mjs'],
    // The per-assertion notes are the evidence; they belong in the log.
    echoOnPass: true,
  },
  // Phase 5 gate: the customer-facing extension reference must agree with the code.
  // It is the only document whose audience is customers, and nothing checked it. When
  // first measured it was wrong in both directions — it claimed `documentList` had
  // nothing resolving it while both browse routes resolve twelve registered columns,
  // and it used an ID that exists only in spec files as its security example.
  {
    id: 'reference-drift',
    label: 'Extension reference drift',
    cmd: 'node',
    argv: ['scripts/beta-harness/extension-reference-drift.mjs'],
  },
  // `.cursor/` is the source for the agent configuration and `.claude/` and `.agent/` are
  // generated copies, so three copies of every skill exist with nothing comparing them. That
  // is the shape of drift this repository keeps paying for, and it is worse here than usual:
  // a skill fixed in one tool's copy and stale in another is wrong only for whoever happens to
  // be using the other tool.
  {
    id: 'agent-mirror',
    label: 'Agent config mirrors match .cursor',
    cmd: 'node',
    argv: ['scripts/mirror-agent-config.mjs', 'check'],
  },
  // There is no `review-corpus` gate any more, and deliberately so.
  //
  // It compared the pre-PR review skill's embedded statistics against a committed
  // docs/pr-review-findings.jsonl. Both are gone: the findings record is the Confluence
  // analysis page, the skill quotes no counts, and the only claim left — its section ordering —
  // is checked on demand by `review:analysis -- check-order`, which needs Confluence
  // credentials and so cannot be a gate. Keeping a gate here under its old name would have
  // been the `proxy-check` defect the skill itself leads with: a check whose body no longer
  // tests the noun in its name.
  //
  // What the gate really enforced was that four files of review bookkeeping travelled in every
  // pull request that went through a review round. `review:guardrails` now fails a diff that
  // reintroduces them, which is the guarantee actually worth having.
  //
  // Phase 5 gate: the guardrail we ship to customers, run against the reference
  // extension library in this repo. A tool we hand customers and never run ourselves
  // is a tool we would discover was broken from a customer's CI log.
  {
    id: 'customer-guardrails',
    label: 'Customer extension guardrails',
    cmd: 'node',
    argv: [
      'libs/platform/guardrails/check-extension-library.mjs',
      'libs/extensions/acme-extensions',
    ],
  },
];

const requested = args.get('gates');
const selected =
  typeof requested === 'string'
    ? requested
        .split(',')
        .map((s) => s.trim())
        .map((id) => {
          const g = ALL_GATES.find((x) => x.id === id);
          if (!g) {
            console.error(`Unknown gate "${id}". Valid: ${ALL_GATES.map((x) => x.id).join(', ')}`);
            process.exit(2);
          }
          return g;
        })
    : ALL_GATES;

const notRequested = ALL_GATES.filter((g) => !selected.includes(g)).map((g) => g.id);

console.log(`\nBeta verification gate — ${phase}`);
console.log(`  base   ${base}`);
console.log(
  `  gates  ${selected.map((g) => g.id).join(' -> ')}  (${selected.length} of ${ALL_GATES.length})`,
);
if (notRequested.length) {
  console.log(`  NOT REQUESTED  ${notRequested.join(', ')} — this run cannot speak for them`);
}
console.log('');

const results = [];
let firstFailure = null;

for (const gate of selected) {
  process.stdout.write(`[run ] ${gate.label} ... `);
  const started = Date.now();
  const proc = spawnSync(gate.cmd, gate.argv, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      ...webstorageOptOut(),
    },
  });
  const ms = Date.now() - started;
  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
  const passed = proc.status === 0;

  console.log(`${passed ? 'pass' : 'FAIL'} (${(ms / 1000).toFixed(1)}s)`);

  if (passed && gate.echoOnPass && output.trim()) {
    for (const line of output.trimEnd().split('\n')) console.log(`       ${line}`);
    console.log('');
  }

  results.push({
    id: gate.id,
    label: gate.label,
    passed,
    exitCode: proc.status,
    durationMs: ms,
    command: `${gate.cmd} ${gate.argv.join(' ')}`,
    outputTail: lastLines(output, tail),
  });

  if (!passed) {
    firstFailure = results.at(-1);
    break;
  }
}

const allPassed = results.every((r) => r.passed);
const skipped = selected.slice(results.length).map((g) => g.id);
const full = notRequested.length === 0;

/**
 * `pass` and `pass-partial` are deliberately different strings.
 *
 * Two reports in the evidence corpus read `"verdict": "pass"` while having run a
 * single gate — `skipped` was empty because the other five were never *selected*,
 * not skipped — so nothing distinguished them from a full green except counting
 * `results` by hand. The skills tell an agent to quote the verdict line verbatim;
 * making the verdict itself carry the coverage means a partial run cannot be
 * quoted as if it were complete.
 */
const verdict = !allPassed ? 'fail' : full ? 'pass' : 'pass-partial';

/**
 * The commit the gate actually ran against, and whether the tree was dirty.
 *
 * `ranAt` alone cannot answer the question that matters — "does this report
 * describe the code as it is now?" — because a wall-clock time says nothing about
 * what was committed since. `state-check.mjs` uses this to reject a phase signed
 * off on a run that predates the source it claims to cover.
 */
function gitFact(argv, fallback) {
  const proc = spawnSync('git', argv, { encoding: 'utf8' });
  return proc.status === 0 ? proc.stdout.trim() : fallback;
}

const report = {
  phase,
  verdict,
  base,
  ranAt: new Date().toISOString(),
  commit: gitFact(['rev-parse', 'HEAD'], null),
  // A green gate on a dirty tree describes something no commit contains.
  dirty: gitFact(['status', '--porcelain'], '') !== '',
  gates: {
    available: ALL_GATES.map((g) => g.id),
    requested: selected.map((g) => g.id),
    ran: results.map((r) => r.id),
    // Selected but never reached, because an earlier gate failed.
    skipped,
    // Never asked for. This run says nothing at all about these.
    notRequested,
    coverage: full ? 'full' : 'partial',
  },
  results,
  skipped,
};

const outDir = resolve(EVIDENCE_ROOT, 'beta', 'gates');
await mkdir(outDir, { recursive: true });
const stamp = report.ranAt.replace(/[:.]/g, '-').slice(0, 19);
const reportPath = resolve(outDir, `${stamp}-${phase}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('');
if (allPassed && full) {
  console.log(`verdict  PASS — all ${ALL_GATES.length} gates green`);
} else if (allPassed) {
  console.log(`verdict  PASS (PARTIAL) — ${results.length} of ${ALL_GATES.length} gates green`);
  console.log(`         NOT RUN: ${notRequested.join(', ')}`);
  console.log(
    '         A partial run is a fast inner loop, not a phase gate. Do not sign off on this.',
  );
} else {
  console.log(`verdict  FAIL — first failing gate: ${firstFailure.id}`);
  if (skipped.length) {
    console.log(`skipped  ${skipped.join(', ')} (not run because an earlier gate failed)`);
  }
  console.log(`\ncommand  ${firstFailure.command}`);
  console.log(`--- last ${tail} lines ---`);
  console.log(firstFailure.outputTail);
  console.log('--- end ---');
}
console.log(`\nreport   ${reportPath}`);

process.exit(allPassed ? 0 : 1);

/**
 * Node 22 added a built-in `localStorage` that requires `--localstorage-file` and
 * shadows jsdom's, so any spec touching it throws `SecurityError`. Opting out
 * restores jsdom's implementation.
 *
 * The flag does not exist before Node 22, where passing it makes Node refuse to
 * start — so it is added only when the running major actually supports it. The
 * repo pins Node 20 in `.nvmrc`, which is why CI never needs this.
 *
 * @returns {{ NODE_OPTIONS?: string }}
 */
function webstorageOptOut() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) return {};
  return {
    NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--no-experimental-webstorage']
      .filter(Boolean)
      .join(' '),
  };
}

/**
 * @param {string} text
 * @param {number} n
 */
function lastLines(text, n) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(-n).join('\n');
}
