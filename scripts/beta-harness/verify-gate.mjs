#!/usr/bin/env node
import { spawnToolSync } from './package-command.mjs';

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
 *   --base <ref>     git base for affected calculation (default origin/main). When it resolves
 *                    to HEAD there is nothing to be affected by, so lint, test, build and
 *                    typecheck run `run-many --all` instead — see `scope` below.
 *   --tail <n>       lines of failing output to show (default 40)
 *   --print-scope    print the resolved scope and the exact argv of the four scoped gates, then
 *                    exit. Runs nothing.
 *   --require-complete  exit 1 unless the verdict is `pass`: every gate ran and passed
 *   --platform-sensitive  only the gates whose verdict can differ by operating system,
 *   --require-scope-complete  exit 1 unless every SELECTED gate ran and passed
 *   --list-gates     print the selected gate ids and exit without running them
 *                        as each gate declares for itself. Ignored when --gates is given.
 *
 * Examples:
 *   node scripts/beta-harness/verify-gate.mjs --gates guardrails,lint
 *   node scripts/beta-harness/verify-gate.mjs --phase phase-1-config --base main
 *
 * Exit code is 1 if any gate failed, or with --require-complete if any did not run.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EVIDENCE_ROOT } from '../collect-evidence/evidence-path.mjs';
import { classify, summarize } from './gate-summary.mjs';

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
 * Does `--base` resolve to HEAD?
 *
 * If it does, `nx affected --base=<base>` matches **zero projects**, and the four gates built on
 * it pass in seconds having compiled, linted and run nothing. That is the state `main` is in:
 * check out `main`, pull, and `base` is `origin/main` is `HEAD`. The in-gate timings looked like
 * cache replay and were not — lint 19.0 s, test 1.5 s, build 1.4 s, typecheck 1.5 s, because Nx
 * found nothing to do. **A green gate on `main` said nothing whatever about the code**, and a
 * lint error merged to `main` was never seen by the gate again.
 *
 * So when the base is HEAD the scoped gates run `run-many --all` instead. Not a fallback and not
 * a widening: with no diff to narrow by, the whole workspace *is* the affected set, and the only
 * other honest option is to refuse to run at all. Cold, the full set is lint 29 projects, test
 * 25, build 6 + 2, typecheck 8 + 1 — affordable, and measured in the pull request.
 *
 * Compared by resolved SHA, not by ref name: `--base=main` on `main`, `--base=HEAD`, an explicit
 * SHA of the current commit and the default `origin/main` on a freshly pulled `main` are all the
 * same situation, and only the SHA sees that.
 *
 * **Peeled to a commit with `^{commit}`**, because `git rev-parse` on an *annotated* tag returns
 * the tag object's own SHA, not the commit it points at. So `--base=v1.2.3` with that tag sitting
 * on HEAD compared unequal, took the `affected` path, and Nx — which peels the ref itself — then
 * diffed HEAD against HEAD and ran zero projects. That is the vacuous pass this whole mechanism
 * exists to remove, reachable through a perfectly valid base ref. Found by review on PR #544 and
 * confirmed against a real annotated tag before fixing.
 *
 * A base that git cannot resolve — a shallow clone with no `origin/main`, a ref that does not
 * exist — is left to Nx to report. Guessing `--all` there would turn a broken checkout into a
 * fifteen-minute run whose failure says nothing about the checkout.
 */
const headSha = gitFact(['rev-parse', 'HEAD^{commit}'], null);
const baseSha = gitFact(['rev-parse', `${base}^{commit}`], null);
const baseIsHead = headSha !== null && baseSha !== null && baseSha === headSha;
const scope = baseIsHead ? 'all' : 'affected';

/**
 * The argv for a gate that would otherwise be `nx affected -t <target>`.
 *
 * One function, so the four gates cannot drift into disagreeing about scope — which is how this
 * defect would come back: a fifth target added as plain `affected` is vacuous on `main` again,
 * and nothing would say so.
 *
 * @param {string} target
 * @returns {string[]}
 */
const scoped = (target) =>
  baseIsHead
    ? ['nx', 'run-many', '-t', target, '--all']
    : ['nx', 'affected', '-t', target, `--base=${base}`];

/** The label carries the scope, so a report cannot be read as the other one. */
const scopedLabel = (what) => (baseIsHead ? `${what} (all projects)` : `Affected ${what}`);

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
    platformSensitive: true,
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
    platformSensitive: true,
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
    platformSensitive: true,
    label: 'Lockfile integrity controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/lockfile-integrity.selftest.mjs'],
  },
  // NXSAT-308 criterion 3: none of adf-hx, adf-core, adf-extensions, js-api or hxcs-js-client in
  // the lock, the installed tree, a manifest, `.npmrc` or an import. Next to `lockfile` because both
  // read the dependency tree. BLOCKING since the ADF removal (NXSAT-638) set `BLOCKING` in the
  // script: any finding fails it, and so does a location that cannot be read. It echoes on a pass
  // so the verdict line, which names the mode, is in the log.
  {
    id: 'dependency-tree',
    platformSensitive: true,
    label: 'Dependency tree (ADF removal)',
    cmd: 'node',
    argv: ['scripts/beta-harness/dependency-tree.mjs'],
    echoOnPass: true,
  },
  // Its negative controls. A report-only gate is green whatever it finds, so without these it could
  // regress into a scanner that finds nothing and stay green until the day it became blocking.
  {
    id: 'dependency-tree-selftest',
    platformSensitive: true,
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
    // npm audit output plus a dated allowlist. No filesystem walk of our source, nothing to differ.
    platformSensitive: false,
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
  // gate with an explicit skip (`BETA_SKIP_CODE_SCANNING=1`). Skipped, it exits with
  // NOT_RUN_EXIT_CODE, which the runner records as NOT RUN: never green, and the run is then
  // `pass-incomplete` rather than `pass`.
  {
    id: 'code-scanning',
    // Reads CodeQL results from the GitHub API, so nothing about it is platform-dependent.
    platformSensitive: false,
    /* But it still runs in the cross-platform job, because that is the only job that waits for
     * CodeQL to finish on this revision — no other workflow hosts this gate, so excluding it
     * here would remove CI's only enforcement of alert severity and allowlist expiry rather
     * than move it. Declared separately so the reason is the real one: this is about where the
     * CodeQL wait lives, not about Windows. */
    requiresCodeqlWait: true,
    label: 'Code scanning (CodeQL)',
    cmd: 'node',
    argv: ['scripts/beta-harness/code-scanning.mjs'],
    mayNotRun: true,
    // The ref, the analysis count and the alert count are the evidence.
    echoOnPass: true,
  },
  {
    id: 'guardrails',
    platformSensitive: true,
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
    // 874s on Windows — 60% of that job on its own, for 709 controls over i18n catalogues and
    // static analysis whose subject is platform-independent. The fixture plumbing it shares is
    // still exercised on Windows by `dependency-tree-selftest`, symlinks included, for 38s.
    platformSensitive: false,
    label: 'i18n guardrail negative controls',
    cmd: 'node',
    argv: ['scripts/review-guardrails.selftest.mjs'],
    // The negative/positive split is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  {
    id: 'crowdin-selftest',
    platformSensitive: true,
    label: 'Crowdin script controls',
    // Both suites behind one gate, via the npm script, so adding the status report did not add a
    // gate. The count in the verdict line is quoted in docs and in CLAUDE.md; a second entry here
    // would have made all of those wrong for a diagnostic that cannot break the application.
    tool: 'npm',
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
    platformSensitive: true,
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
    // 377s on Windows. Same reasoning: the sanitizer rules it verifies are string analysis, and the
    // fixture machinery is covered more cheaply elsewhere on that platform.
    platformSensitive: false,
    label: 'Sanitizer audit negative controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/sanitizer-audit.selftest.mjs'],
    // Which checks were observed failing on purpose is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  // The recovery that the gate above now depends on when it is interrupted. Registered rather than
  // left to be run by hand, for the reason this repository already applies to a committed scenes
  // file: nothing in CI referenced it, so it would be code that never executes and rots as the
  // selftest's perturbations move. Runs straight after, because it perturbs the same real files.
  {
    id: 'sanitizer-recovery-selftest',
    // The recovery it proves is a marker file and a byte comparison — pure filesystem, identical on
    // every OS. What is *not* identical is how a process dies: Windows has no signals, so Node turns
    // a hard kill into an abrupt exit. The controls accept either, but the trigger being a different
    // mechanism there is why this is not worth a second slow Windows job (NXSAT-751).
    platformSensitive: false,
    label: 'Sanitizer selftest crash-recovery controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/sanitizer-selftest-recovery.selftest.mjs'],
    // Same reasoning as above: the controls are the evidence, so show them on a pass.
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
    // Audits evidence JSON that earlier gates wrote.
    platformSensitive: false,
    label: 'Evidence assertion audit',
    cmd: 'node',
    argv: ['scripts/beta-harness/assertion-audit.mjs'],
  },
  // The assertion audit above asks whether a check can fail. It cannot ask whether the check is
  // reading the surface it claims to, and the parity steps are the one file where that question
  // decides everything: they capture the same claims on two sets of components, one of which can
  // never be captured again. The run was unable to finish for two months — a crumb selected by a
  // label that was itself under test aborted it on a timeout — and no gate was in a position to
  // notice, because every defect was in a steps file nothing audited.
  {
    id: 'parity-surface',
    platformSensitive: true,
    label: 'Parity surface adapter audit',
    cmd: 'node',
    argv: ['scripts/beta-harness/parity-surface-audit.mjs'],
  },
  // Static and synthetic: the controls are written to a temporary directory, so unlike the
  // sanitizer selftest this one cannot leave the tree dirty.
  {
    id: 'parity-surface-selftest',
    platformSensitive: true,
    label: 'Parity surface audit controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/parity-surface-audit.selftest.mjs'],
  },
  // The parity steps' own step-11 controls. `parity-surface` above audits that file's *shape* —
  // selectors in adapters, no unguarded click, no adapter gap. It cannot ask whether a verdict in
  // it is capable of being wrong, and step 11's was: "parity-user's AddChildren survives the save"
  // was green on the nxs surface while nothing had been saved, because the option filter matched
  // no option, so no change was staged, no Save appeared, and the entry survived an ACL nobody
  // touched. `aclSaveVerdict` is the fix, and this runs it in process against each situation step
  // 11 can observe, printing beside each what the old predicate would have concluded. Its second
  // group covers the root cause rather than the verdict: `showsPermission` against the strings the
  // panel actually emits — "Manage everything Everything", "Edit ReadWrite" — which is where
  // matching a translated label went wrong twice.
  //
  // It is here because it was registered nowhere. `beta:parity-selftest` existed in `package.json`
  // and was wired into neither this list nor `ci.yml`, so the only demonstration that the step-11
  // control can go red was a script a human had to remember to run — and an edit that dropped the
  // control would have been caught by nothing.
  //
  // In process and synthetic: no browser, no backend, no file written, ~50 ms. Next to the audit
  // above because both read the same steps file and neither compiles anything.
  {
    id: 'parity-selftest',
    platformSensitive: true,
    label: 'Parity step 11 save-verdict and option-match controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/steps/nxsat-308-parity.selftest.mjs'],
    // How many controls passed the old predicate while no save had happened is the evidence, so
    // surface it on a pass too.
    echoOnPass: true,
  },
  {
    id: 'lint',
    platformSensitive: true,
    label: scopedLabel('lint'),
    scoped: true,
    tool: 'npx',
    argv: scoped('lint'),
  },
  {
    id: 'test',
    platformSensitive: true,
    label: scopedLabel('tests'),
    scoped: true,
    tool: 'npx',
    argv: scoped('test'),
  },
  {
    id: 'build',
    platformSensitive: true,
    label: scopedLabel('build'),
    scoped: true,
    tool: 'npx',
    argv: scoped('build'),
  },
  // Libraries have no `build` target — Nx's module-boundary rule forbids a
  // buildable library from importing a non-buildable one, and nothing in
  // `libs/` is buildable until Phase 4 gives them ng-packagr. `typecheck` runs
  // the Angular compiler over a library on its own, so a change confined to one
  // is checked directly rather than only wherever `nuxeo-ui` happens to use it.
  {
    id: 'typecheck',
    platformSensitive: true,
    label: scopedLabel('typecheck'),
    scoped: true,
    tool: 'npx',
    argv: scoped('typecheck'),
  },
  // `typecheck` above covers library sources only: it runs the per-project targets, which
  // point at `tsconfig.lib.json`, and that config excludes `*.spec.ts` by construction.
  // Nineteen of twenty-seven projects had no such target at all. So until this gate existed,
  // no gate in the pipeline had ever type-checked a spec file, and 43 errors had accumulated
  // — one of them a production signature stricter than the payload it parsed.
  {
    id: 'spec-types',
    platformSensitive: true,
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
    platformSensitive: true,
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
    platformSensitive: true,
    label: 'API surface',
    cmd: 'node',
    argv: ['scripts/beta-harness/api-surface.mjs'],
  },
  // The gate that asserts the package can be *published*, by running a real
  // `npm publish --dry-run` on a copy of the built bytes. Nothing above it runs a
  // publish, so for the whole of Phase 4 `@nuxeo/satori-platform` was unpublishable —
  // ng-packagr had written a `prepublishOnly` that hard-fails full-mode packages — while
  // every gate here was green and the phase claimed "an upgrade is an npm version bump".
  {
    id: 'publishability',
    platformSensitive: true,
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
    platformSensitive: true,
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
    platformSensitive: true,
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
    platformSensitive: true,
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
    // Compares registered IDs in docs against code as strings.
    platformSensitive: false,
    label: 'Extension reference drift',
    cmd: 'node',
    argv: ['scripts/beta-harness/extension-reference-drift.mjs'],
  },
  // Its negative controls, and the reason this gate had six review findings against it on #544,
  // every one found by a human reading the diff: until `--root` existed it could only be run
  // against the one repository it lives in, and that repository is correct. There was nothing to
  // run it against. Each control builds a miniature repository that is wrong on purpose, under
  // `os.tmpdir()`, so nothing tracked is touched and this is safe beside anything.
  {
    id: 'reference-drift-selftest',
    // Fixture repositories and string comparison; no path semantics that differ by OS.
    platformSensitive: false,
    label: 'Extension reference drift controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/extension-reference-drift.selftest.mjs'],
    // Which of the six findings each control pins is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  // The same question for the page that shows each `nxs-` component with and without Satori: it
  // lives on Confluence, so a component added without a section there is missed in review. Fails
  // on a barrel component with no section, a section with no component, and a section whose ID,
  // story or image disagrees with the code.
  {
    id: 'nxs-comparison',
    // Checks a Markdown page covers every component. Text comparison.
    platformSensitive: false,
    label: 'Satori comparison page covers every nxs- component',
    cmd: 'node',
    argv: ['scripts/beta-harness/satori-comparison-doc.mjs'],
  },
  // Its negative controls, in memory and under `os.tmpdir()`, so safe to run beside anything.
  {
    id: 'nxs-comparison-selftest',
    // Controls for that text comparison.
    platformSensitive: false,
    label: 'Satori comparison page controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/satori-comparison-doc.selftest.mjs'],
    // The negative/positive split is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  // The controls of the gate that keeps Satori out of the Storybook published to GitHub Pages. The
  // gate itself needs a Storybook build, so it runs in CI and in storybook-pages.yml, not here.
  {
    id: 'storybook-publication-selftest',
    platformSensitive: true,
    label: 'Storybook publication gate controls',
    cmd: 'node',
    argv: ['scripts/storybook-publication-gate.selftest.mjs'],
    echoOnPass: true,
  },
  // The controls of the script that lays the published site out. It runs on real Storybook builds
  // in storybook-pages.yml, so like the gate above only its controls run here — they drive it
  // through stub builds instead, because what is under test is the laying-out, not the building.
  // Every refusal asserts that nothing was written: the failure worth guarding against is a site
  // that deploys successfully and is empty.
  {
    id: 'storybook-assemble-selftest',
    platformSensitive: true,
    label: 'Storybook site assembly controls',
    cmd: 'node',
    argv: ['scripts/storybook-assemble-site.selftest.mjs'],
    echoOnPass: true,
  },
  // The published addresses this repository advertises, and the ones it records as dead.
  //
  // Next to `supply-chain` and `peer-installability` in kind: it needs the network, so it declares
  // the same skip. Registered because two addresses went wrong in October and neither was noticed
  // by anything here — `https://nuxeo.github.io/agentic-ui-poc/` has been 404 with no redirect
  // since the 30 October rename, because GitHub redirects a renamed repository's URL and not its
  // Pages site; and the public Storybook was five days stale, found only because a human opened
  // the page. A liveness check alone would rot in the direction nobody looks, so the gate is
  // two-directional: a recorded-dead address that starts answering fails it too.
  {
    id: 'published-links',
    // HTTP status codes from GitHub. Nothing about it reads the filesystem.
    platformSensitive: false,
    label: 'Published links',
    cmd: 'node',
    argv: ['scripts/beta-harness/published-links.mjs'],
    mayNotRun: true,
    // Which addresses were checked, and which are recorded dead and whose they are, is the point.
    echoOnPass: true,
  },
  // Its negative controls, against a local HTTP server. The gate observes one state of the world
  // at a time and today both of its lists are correct, so nothing about a real run tells a working
  // check from one that returns pass unconditionally. Four of the eight controls are negative.
  {
    id: 'published-links-selftest',
    platformSensitive: false,
    label: 'Published links controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/published-links.selftest.mjs'],
    echoOnPass: true,
  },
  // The controls for the weekly AGENTS/ staleness report, and for the workflow that files it.
  //
  // Registered rather than left as a script someone remembers to run, because the thing it covers
  // is the least observable kind of defect this repository has: `staleness-check.yml` interpolated
  // its own generated text into a shell body, failed on exit 127 for seven consecutive weeks from
  // 14 September, and filed nothing. The issue step runs *only* when there is drift, so the job
  // was green precisely when it had nothing to report — nobody had a reason to look.
  //
  // Two of its nine controls are negative in the strict sense: they run the OLD interpolated shell
  // with a hostile value and require it to misbehave. Without them the suite would not distinguish
  // a closed injection from a harmless fixture.
  //
  // In process, fixtures under `os.tmpdir()`, ~1 s.
  {
    id: 'staleness-report-selftest',
    /* The workflow it covers runs on `ubuntu-latest` and nowhere else, and what is under test is
     * a Node script's text handling plus the shape of a YAML `run:` body — neither of which a
     * second operating system can say anything new about. The one `bash` control deliberately
     * reproduces a Linux runner's shell, so running it under a different shell would weaken it
     * rather than widen the coverage.
     *
     * Declared `false` after the Windows job proved the point from the other direction: two
     * controls need a filename containing `>` or a newline, which Win32 cannot create, so they
     * failed on the filesystem rather than on the subject. They are POSIX-gated and reported as
     * SKIPPED now, so a Windows developer's full `beta:gate` is green and honest about what ran. */
    platformSensitive: false,
    label: 'AGENTS staleness report controls',
    cmd: 'node',
    argv: ['scripts/agents-staleness-report.selftest.mjs'],
    // Which controls are negative is the evidence, so surface it on a pass too.
    echoOnPass: true,
  },
  // `.cursor/` is the source for the agent configuration and `.claude/` and `.agent/` are
  // generated copies, so three copies of every skill exist with nothing comparing them. That
  // is the shape of drift this repository keeps paying for, and it is worse here than usual:
  // a skill fixed in one tool's copy and stale in another is wrong only for whoever happens to
  // be using the other tool.
  {
    id: 'agent-mirror',
    platformSensitive: true,
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
    platformSensitive: true,
    label: 'Customer extension guardrails',
    // The npm script, so the gate and CI run the same two things: the guardrail against our
    // reference library, which proves it passes, and its selftest, which proves it can fail.
    tool: 'npm',
    argv: ['run', '--silent', 'beta:customer-guardrails'],
    echoOnPass: true,
  },
  // The nx commands THIS runner does not use. Every gate above that touches nx builds
  // `nx affected -t <target> --base=<base>` or `nx run-many -t <target> --all`, and neither
  // passes `--exclude` or a project pattern — so `findMatchingProjects`, which is where nx turns
  // a pattern into a regex, is reached by nothing here. CI's `test` job does pass
  // `--exclude=browse,document-detail,knowledge-discovery,search`, and that is how a tree where
  // nx cannot compile a pattern at all was green through every local gate while CI's affected
  // leg died (run 42932394850): a `minimatch@^10` override reached nx's exact `10.2.5` pin, and
  // minimatch 11.0.1 had removed the `makeRe` nx calls.
  //
  // Last rather than early on purpose, and it is a real cost: on a broken tree `lint`, `test`,
  // `build` and `typecheck` all pass first, because none of them walks that path, so the red
  // arrives minutes late. The alternative was renumbering 36 rows of the §2 inventory for a
  // CI-only fix. If this gate ever fires in anger, moving it next to `lockfile` — where it
  // belongs by cost and by subject — is the right follow-up.
  {
    id: 'nx-project-matching',
    // Spawns nx and walks `node_modules/nx/dist`, so a Windows run can tell you something a
    // macOS run cannot: whether the probes' directory patterns still match a project root there.
    platformSensitive: true,
    label: 'Nx project-pattern matching',
    cmd: 'node',
    argv: ['scripts/beta-harness/nx-project-matching.mjs'],
    // The subject, the two patterns and the minimatch version it checked are the evidence that
    // the probes ran against something real, so surface them on a pass too.
    echoOnPass: true,
  },
  // And its controls, because the gate above shipped wrong in exactly the way this repository
  // keeps paying for: check C accepted a scanned `minimatch` member under EITHER access path,
  // which is green against the break it was written for — 11.0.1 dropped `makeRe` from both — and
  // green against half of it. A minimatch keeping the named export and dropping the function
  // property satisfies "either" while every `minimatch_1.minimatch.makeRe(…)` call still throws.
  // Review (#586) found it by reading the code, because the gate had no controls at all.
  //
  // Hermetic: the gate's four pure functions, fixtures under `os.tmpdir()`, no nx spawn and no
  // tracked file touched. Which also bounds it — the gathering half (`spawnToolSync`,
  // `createRequire` against nx's tree) is the one class of verdict these controls cannot reach,
  // and both files say so rather than leaving a reader to infer it.
  {
    id: 'nx-project-matching-selftest',
    // Pure functions, temp-directory fixtures, no path comparison that an OS can change.
    platformSensitive: false,
    label: 'Nx project-pattern matching controls',
    cmd: 'node',
    argv: ['scripts/beta-harness/nx-project-matching.selftest.mjs'],
    // The negative/positive split is the evidence, not noise: "37 controls passed" says nothing
    // about whether any of them could have failed.
    echoOnPass: true,
  },
];

/* Every gate must say whether its VERDICT can differ by operating system. Not whether it is
 * useful — whether running it a second time on another platform can tell you something the first
 * run could not.
 *
 * Checked rather than assumed, because a gate added without the field would otherwise inherit
 * whatever `--platform-sensitive` does with `undefined`, and that decision would be made by
 * accident. This is the whole anti-drift mechanism: the answer lives on the gate, and a new gate
 * cannot run until someone has answered for it. A list of ids kept anywhere else goes stale
 * against the gates it describes — this repository has paid for that three times. */
const undeclared = ALL_GATES.filter((g) => typeof g.platformSensitive !== 'boolean').map(
  (g) => g.id,
);
if (undeclared.length > 0) {
  console.error(
    `Gate(s) without a \`platformSensitive\` declaration: ${undeclared.join(', ')}.\n` +
      'Add `platformSensitive: true` when the verdict can differ by operating system — paths, ' +
      'process spawning, permissions, line endings — or `false` with a one-line reason why it ' +
      'cannot. Guessing on behalf of a new gate is how a cross-platform run stops meaning ' +
      'anything.',
  );
  process.exit(2);
}

const requested = args.get('gates');
const platformOnly = args.has('platform-sensitive');
const selected =
  platformOnly && typeof requested !== 'string'
    ? ALL_GATES.filter((g) => g.platformSensitive || g.requiresCodeqlWait)
    : typeof requested === 'string'
      ? requested
          .split(',')
          .map((s) => s.trim())
          .map((id) => {
            const g = ALL_GATES.find((x) => x.id === id);
            if (!g) {
              console.error(
                `Unknown gate "${id}". Valid: ${ALL_GATES.map((x) => x.id).join(', ')}`,
              );
              process.exit(2);
            }
            return g;
          })
      : ALL_GATES;

const notRequested = ALL_GATES.filter((g) => !selected.includes(g)).map((g) => g.id);
/* `--list-gates` prints the selection and runs nothing. Added because a control could not
 * otherwise observe what `--platform-sensitive` selects: passing `--gates` to keep a selftest
 * cheap overrides the flag, so the control exercised precedence and nothing else, and would have
 * passed with the platform filter inverted or ignored. Review caught that. */
if (args.has('list-gates')) {
  console.log(selected.map((g) => g.id).join('\n'));
  process.exit(0);
}

/* `--print-scope` resolves the scope and runs nothing.
 *
 * It prints the gates' own `argv` arrays, not a re-derivation of them, so a control reading this
 * output is reading the command that would be executed. A second copy of the decision here —
 * even one that looked right — would be exactly the self-confirming check this repository has
 * shipped three of: it would stay green with `scoped()` wired to `affected` unconditionally. */
if (args.has('print-scope')) {
  console.log(`scope ${scope}`);
  console.log(`base ${base}${baseSha ? ` (${baseSha.slice(0, 9)})` : ' (unresolved)'}`);
  console.log(`head ${headSha ? headSha.slice(0, 9) : 'unresolved'}`);
  for (const gate of ALL_GATES.filter((g) => g.scoped)) {
    console.log(`${gate.id} ${gate.tool ?? gate.cmd} ${gate.argv.join(' ')}`);
  }
  process.exit(0);
}

console.log(`\nBeta verification gate — ${phase}`);
console.log(`  base   ${base}`);
/* Printed every run, not only in the `--all` case. A reader who sees `affected` knows the run
 * speaks for the diff and nothing else; a reader who sees nothing assumes whichever they expected,
 * which is how the vacuous figures on `main` were quoted for weeks as if they covered the code. */
console.log(
  baseIsHead
    ? `  scope  run-many --all — ${base} resolves to HEAD, so nothing is affected`
    : `  scope  affected --base=${base} — this run speaks for the diff, not the workspace`,
);
console.log(
  `  gates  ${selected.map((g) => g.id).join(' -> ')}  (${selected.length} of ${ALL_GATES.length})`,
);
if (notRequested.length) {
  console.log(`  NOT REQUESTED  ${notRequested.join(', ')} — this run cannot speak for them`);
}
console.log('');

const results = [];

for (const gate of selected) {
  process.stdout.write(`[run ] ${gate.label} ... `);
  const started = Date.now();
  const proc = spawnToolSync(gate.tool ?? gate.cmd, gate.argv, {
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
  const status = classify(gate, proc.status);
  const passed = status === 'pass';

  console.log(
    `${passed ? 'pass' : status === 'not-run' ? 'NOT RUN' : 'FAIL'} (${(ms / 1000).toFixed(1)}s)`,
  );

  if (status !== 'fail' && gate.echoOnPass && output.trim()) {
    for (const line of output.trimEnd().split('\n')) console.log(`       ${line}`);
    console.log('');
  }

  results.push({
    id: gate.id,
    label: gate.label,
    status,
    passed,
    exitCode: proc.status,
    durationMs: ms,
    command: `${gate.tool ?? gate.cmd} ${gate.argv.join(' ')}`,
    outputTail: lastLines(output, tail),
  });

  if (status === 'fail') break;
}

const anyFailed = results.some((r) => r.status === 'fail');
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
 *
 * `pass-incomplete` exists for the same reason one level down: a full run in which a gate
 * reported NOT RUN used to print "all 29 gates green" with code scanning skipped.
 */
const {
  verdict,
  counts,
  notRun,
  lines: summaryLines,
} = summarize({
  total: ALL_GATES.length,
  notRequested,
  skipped,
  results,
  tail,
});

/**
 * One fact out of git, or `fallback` if git refused.
 *
 * Hoisted on purpose: the scope resolution at the top of the file calls it too, and resolving
 * `--base` against HEAD there is what decides whether the scoped gates are `affected` or `--all`.
 *
 * @param {readonly string[]} argv
 * @param {T} fallback
 * @template T
 * @returns {string | T}
 */
function gitFact(argv, fallback) {
  const proc = spawnSync('git', argv, { encoding: 'utf8' });
  return proc.status === 0 ? proc.stdout.trim() : fallback;
}

const report = {
  phase,
  verdict,
  base,
  /* `affected` or `all`. Without it a report cannot be told apart from one whose scoped gates
   * matched zero projects, and that is the distinction the whole of G3 is about. */
  scope,
  ranAt: new Date().toISOString(),
  /* The commit the gate actually ran against. `ranAt` alone cannot answer the question that
   * matters — "does this report describe the code as it is now?" — because a wall-clock time says
   * nothing about what was committed since. `state-check.mjs` uses this to reject a phase signed
   * off on a run that predates the source it claims to cover. */
  commit: gitFact(['rev-parse', 'HEAD'], null),
  // A green gate on a dirty tree describes something no commit contains.
  dirty: gitFact(['status', '--porcelain'], '') !== '',
  // Green, not run and failed, of all gates. A not-run gate is never in `green`.
  counts,
  gates: {
    available: ALL_GATES.map((g) => g.id),
    requested: selected.map((g) => g.id),
    // Gates that reached a verdict, pass or fail.
    ran: results.filter((r) => r.status !== 'not-run').map((r) => r.id),
    // Started, but reported that they checked nothing (NOT_RUN_EXIT_CODE).
    notRun,
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
for (const line of summaryLines) console.log(line);
console.log(`\nreport   ${reportPath}`);

// `--require-complete`, for CI that claims the full gate: a green exit must mean every gate ran
// and passed, so `pass-incomplete` (a gate NOT RUN) and `pass-partial` fail as well. Left strict
// on purpose — it is the guard against a run claiming completeness it does not have.
if (!anyFailed && args.has('require-complete') && verdict !== 'pass') {
  console.error(`verdict ${verdict}: --require-complete accepts only every gate run and green`);
  process.exit(1);
}

/* `--require-scope-complete` is the narrower claim a deliberately scoped run can make: every gate
 * SELECTED ran and passed. Separate from `--require-complete` rather than a loosening of it,
 * because that flag's strictness is the point and the Windows job is not entitled to it.
 *
 * Asserted against `selected` and `results` directly, not via the verdict. A filtered run is
 * classified `pass-partial` whether or not a selected gate was skipped — the skip is invisible in
 * the verdict — so reading the verdict here would accept exactly the hole this is for. */
if (args.has('require-scope-complete')) {
  const ran = new Set(
    results.filter((r) => (r.status ?? (r.passed ? 'pass' : 'fail')) === 'pass').map((r) => r.id),
  );
  const shortfall = selected.map((g) => g.id).filter((id) => !ran.has(id));
  if (shortfall.length > 0) {
    console.error(
      `--require-scope-complete: ${shortfall.length} selected gate(s) did not run green: ` +
        `${shortfall.join(', ')}`,
    );
    process.exit(1);
  }
}

process.exit(anyFailed ? 1 : 0);

/**
 * Node 22 added a built-in `localStorage` that requires `--localstorage-file` and
 * shadows jsdom's, so any spec touching it throws `SecurityError`. Opting out
 * restores jsdom's implementation.
 *
 * The flag does not exist before Node 22, where passing it makes Node refuse to
 * start — so it is added only when the running major actually supports it. The
 * repo pins Node 24 in `.nvmrc`, where the built-in store is still off by default
 * (`localStorage` is undefined, so jsdom's is used), which is why CI never needs this.
 * Node 25 is the first major where it is on and throws.
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
