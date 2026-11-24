# Beta delivery record

**What this file is for:** presenting what has been built, with enough detail to answer
"what changed, why, and how do we know". It is the narrative record. Keep it current —
if a change is worth a commit, it is worth a line here.

**How it relates to the other documents**, because there are already several and they have
contradicted each other before:

| File                           | Role                                                             | Authority               |
| ------------------------------ | ---------------------------------------------------------------- | ----------------------- |
| `AGENTS/11-beta-program.md` §3 | terse _verified facts_, for agents mid-task                      | **highest** on any fact |
| `.ai/state/phases.json`        | machine-checkable phase status, verified by `npm run beta:state` | **highest** on status   |
| `docs/beta-plan.md`            | the plan of record: scope, phases, timelines                     | highest on _intent_     |
| **this file**                  | the narrative: what was done, why, with numbers and evidence     | highest on _history_    |

If this file disagrees with §3 or `phases.json` on a fact, **they win and this is stale**.
Nine cross-document contradictions accumulated earlier in this programme — including two
reviews disagreeing about whether CI had ever run — so the precedence above is deliberate.

Last updated: 2026-08-24 (Phase 6 opened).

Updating this file is **step 10 of the `beta-phase` skill**, not an optional courtesy.

---

## 1. Where the programme stands

| Phase                                   | Status                                                                              | Evidence                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Unblock and verify                  | **complete**                                                                        | `phase-0-baseline` 14/14 at sign-off; re-captured 12/12 on the browse page                                                                   |
| 1 — Layer 0: upgrade-safe configuration | **in progress** 2026-11-02 (NXSAT-660): an unexplained request fails; caveat below  | `phase-1-config` 39/39 at sign-off; now 39/40                                                                                                |
| 2 — Layer 1: extension registry         | **in progress** 2026-11-02 (NXSAT-660): the same request fails; carry-forward named | `phase-2-registry` 46/46 at sign-off; now 42/43                                                                                              |
| 3 — Component adoption                  | **superseded** 2026-11-02 (NXSAT-660): the adopted components were removed          | 55/55 at sign-off; now 29/29 on the browse page, which is **not adoption evidence**                                                          |
| 4 — Layer 2: publishable platform       | **complete with deviations**, 12 recorded; narrowed 2026-11-02 (NXSAT-660)          | `phase-4-platform` 25/25 at sign-off; now 18/18 on the signed-out template                                                                   |
| 5 — Layer 3: agent harness              | **complete**                                                                        | `phase-5-harness` 27/27                                                                                                                      |
| 6 — Beta quality bar                    | **in progress** — 5 of 7; step 6 reopened 2026-09-22, step 3 **not met** 2026-11-23 | `phase-6-a11y` **34/35** on `2026-11-23T18-53-44`, every axe check passing after the 2.5.3 fix (20/35 earlier that day); 27/27 on 2026-08-24 |

This table was three phases stale for a day — it read Phase 3 "in progress", Phase 4 "not
started", Phase 5 "partial" after all three had shipped. `npm run beta:state` is the
machine-checked version and is red whenever a phase claims more than its evidence supports;
prefer it to this table.

**Phases 1 and 2** have been back in progress since 2026-11-02 (NXSAT-660). The latest run
`phases.json` records for each fails one check: a request the app sends to
`/nuxeo/agentic-ui/` from the browse and themes pages fails, and its source is not yet
identified.

**Phase 4's claim** was narrowed the same day: its template is now checked signed out only,
and the signed-in checks, which need Nuxeo, are recorded as notes rather than assertions.

**Phase 1's caveat:** i18n extraction covers only three templates. That is real remaining
work, and it was carried inside the phase while the phase was recorded complete. It is not
why the phase reopened; `phases.json` still lists it under what the phase does not cover.

---

## 2. What was built — the product

### Layer 0: configuration without a rebuild

- Bootstrap config **outside the bundle, never installed by the package**. The marketplace
  installer copies the web directory with `overwrite="true"`, so anything inside it is destroyed
  on upgrade. The path is `nxserver/nuxeo.war/agentic-ui-config` — a sibling of the bundle,
  outside the destructive copy. Phase 1 originally shipped `nxserver/web/…`, which **would have
  404'd in every deployment**; corrected after independent review. Phase 1 also installed
  `bootstrap.json` there with `overwrite="false"`, which a 2026-10-07 rehearsal showed failing
  the upgrade after an edit; since NXSAT-317 the package installs only `bootstrap.example.json`,
  and the customer copies it to `bootstrap.json`. _Superseded 2026-10-07 (NXSAT-312): the package
  installs no configuration file, nothing on disk there is read or served, and there is no
  migration from it._
- _Superseded by NXSAT-312: both halves are now package fragments served by `nuxeo-agentic-core`,
  and the Note below is no longer read._ Runtime manifest as a **Nuxeo document** at `/default-domain/config/agentic-ui`, so it
  inherits Nuxeo versioning, ACLs and per-tenant scoping. Eleven `InjectionToken` factories
  resolve from it. Every load path is tolerant: a missing file, absent document, 403 or
  malformed JSON falls back to packaged defaults that reproduce the pre-Phase-1 values
  exactly.
- Theme blocks are token-driven, and the `!important` override block that would have fought
  customer CSS is gone.
- Manifest `labels` layer over the translation catalogue, so **relabelling the product is a
  manifest edit**.

### Layer 1: the addressable surface

`libs/shared/extensions`. Eight slots, keyed by opaque
string with no enum or `switch` on slot identity — so a ninth slot needs no change to the
eight.

Live and rendering: **navbar**, **sidebar**, **bulk actions** (six), **documentList
columns** (twelve). Each entry is hideable, reorderable, relabellable and rule-gateable
from JSON alone.

Still reserved and read by nothing: `routes`, `toolbar`, `contextMenu`, `tabs`. **Do not
describe those as extension points.**

Rules are registered evaluators over the existing document predicates. Two behaviours worth
knowing:

- An **unregistered rule id fails open** — a manifest naming a rule this build lacks leaves
  the entry visible, because Layer 1 visibility is not an authorisation boundary and failing
  closed would let a typo strip working actions out of the UI.
- Except for `SECURITY_RELEVANT_RULE_IDS`, which fail **closed**. That list is declared
  rather than attached at registration, because the unsafe window is precisely the one
  before registration happens: without it, a consumer resolving the navbar early saw an
  unknown id and got `true`, which **would have offered Administration to every user**.

### Phase 3: component adoption

The UI is built on our own `nxs-` Satori components (`libs/shared/satori-components`). Phase 3's
evidence is recorded in `.ai/state/phases.json`.

### Phase 4: the Layer 2 registration contract

- **`provideSatoriExtensions()`** is the single documented entry point a customer's
  extension library calls — one declarative object rather than four imperative
  calls against four registries a customer should not have to know about. Contributions are applied in an **environment initializer**, which runs
  earlier than `APP_INITIALIZER` and so closes — rather than narrows — the window
  in which an unknown rule id fails open.
- **The application uses it.** `provide-app-extensions.ts` now contributes its two
  auth rules, two slots, six bulk handlers and three lazy drawer panels through
  the public function instead of injecting `ExtensionSlotRegistry`,
  `ExtensionRuleRegistry`, `ExtensionComponentRegistry` and
  `ExtensionActionRegistry` by hand. A contract the product does not itself use is
  the "registered but dead" surface this programme has shipped twice.
- Rules, components and handlers are **last-wins per id** so a customer layer can
  override a packaged one; slot descriptors **accumulate**, so adding a toolbar
  button cannot silently delete the packaged ones.
- **Watched fail on purpose**: with all five registration paths sabotaged, 6 of 8
  specs went red. One of the two survivors was a real false green — it asserted a
  rule evaluated `true`, which an _unregistered_ rule also does. Rewritten to
  assert `false`, which only a registered evaluator can return.
- **Delivered since**: at the time of writing the libraries did not build as packages —
  `ng-packagr` was absent and the committed `ng-package.json` configured a tool that was
  not installed. That is closed; see the next section.

---

### Phase 4: the shipped package

`@nuxeo/satori-platform` builds with `@nx/angular:package` — one publishable library with
four secondary entry points, `./app-config`, `./extensions`, `./nuxeo-client` and `./ui`,
pointing at the existing shared library sources. A 347 kB tarball of 25 files: FESM
bundles, rolled-up declarations, the customer `AGENTS.md`, the extension reference, and the
guardrail script a customer runs in their own CI. Ten peers declared; nothing bundled.

Four things guard it, and each was added because something got past the ones before it:

- **`beta:api`** — the public `.d.ts` surface against a 2,221-line snapshot. Its first
  version reported PASS across 27 changed types, because a rolled-up bundle has no
  `export` prefix for its regex to match. Its second recorded
  `const EXTENSION_SLOTS:` and nothing after the colon — the slot ids every customer
  manifest is written against — because multi-line `const` and `type` were outside its
  body-capture allowlist.
- **`beta:publishable`** — a real `npm publish --dry-run`, which is the only check that
  executes `prepublishOnly`. **The package could not be published at all for the whole of
  Phase 4.** It was compiled in Angular's full compilation mode, so ng-packagr wrote a
  script whose only job is to hard-fail `npm publish`, and the phase was signed off on the
  claim that a customer upgrade is an `npm version` bump.
- **`beta:fork`** — compiles the app template against the **built** declarations, which is
  the resolution a customer actually gets. It is what found the package being compiled
  without `strictNullChecks`.
- **`beta:customer-guardrails`** — the shipped guardrail, run against our own reference
  extension library, so we do not learn it is broken from a customer's CI log.

**Publishing was deferred at this phase.** `private: true` was set then. NXSAT-667 has since
removed it, and `publishConfig` names the Nuxeo registry. The scope and registry are decided
(`@nuxeo/satori-platform` on Nuxeo Nexus) and the runbook is
`docs/publishing-to-nuxeo-registry.md`. Nothing has been published yet.

---

### After Phase 5: an independent adversarial review

Every phase self-reported green and CI-green, and the review found defects in every one.
The remediation is in git history from `0ccf3f0` onward. What it changed, honestly
characterised:

| Found                                                               | Was it a live defect?                            |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| Package unpublishable (full compilation mode)                       | **Yes** — Phase 4's central claim had no vehicle |
| Module boundaries unenforced; 4 real cross-boundary imports         | **Yes** — including a `shared/` lib on features  |
| API snapshot blind to `const`/`type` bodies                         | **Yes** — a renamed slot id read as "no change"  |
| 4 blob-URL leaks + the same 4 subscriptions unguarded               | **Yes**                                          |
| `<img [src]>` bound to a Nuxeo URL, bypassing the interceptor       | **Yes**                                          |
| i18n catalogue check asserted existence, not content                | Hole — an empty catalogue passed                 |
| Drift gate treated a comment as code                                | Hole — 3 generators had already exploited it     |
| 3 of 5 customer guardrail checks satisfiable without doing the work | Hole — all three probed and closed               |
| Lockfile gate skipped 52 devDependency edges                        | Hole — all 52 resolve today                      |
| `state-check` read `verdict` and not `totals.failed`                | Hole — reachable only by a doctored manifest     |
| 4 local gates never ran in CI, `bundle` among them                  | Hole — "green locally" ≠ "green in CI"           |

Every fix was watched failing on purpose before being trusted, in both directions where
the old behaviour could still be run. Two review claims did **not** reproduce and were
not acted on: 14 "unfalsifiable" evidence assertions (all 180 assertion conditions compare
against measured runtime values), and the Node gate being "non-strict" (deliberate, with
the hazard printed on every run, a `BETA_GATE_NODE_STRICT=1` override, and CI on the
pinned major).

---

### Phase 6: 5 of 7 steps done; step 6 open since 2026-09-22, step 3 not met as of 2026-11-23

**This section is dated 2026-09-22 and the paragraphs below it are older.** It said "opened, two
steps done of seven" and "barely started", which was true when written and is not now — steps 0–2, 4
and 5 are done, and **two** are open: step 6 (the 90% bar), reopened 2026-09-22 because
`shared-ai-client` entered the measurement at 15.98%; and step 3 (WCAG 2.1 AA), in question from
2026-09-23 and **not met** as of 2026-11-23. That day's first capture failed `label-content-name-mismatch`
on the navigation's user-profile control, on every screen. The control was fixed the same day, and the next capture
passes every axe check; see the WCAG row below. (Phase 6 has seven steps numbered **0–6**;
an earlier revision of this sentence referred to a step 7, which does not exist.) Where a figure below disagrees with the
table at the end of this section, the table is the later measurement.

What
exists after step 1:

**Step 0 — the coverage ratchet was lying in two directions.** Both were created by the
previous day's library changes and neither presented as a failure. An entry for the
deleted `drawers` library was reported forever as "not measured, unchanged" — a permanent
line of reassurance about a library that is gone, whose recorded 100% was meaningless
anyway (an empty barrel with `passWithNoTests`). And a project _absent_ from the baseline
was printed as `new` and then excluded from every check, so `permission-dialogs` sat at
93.85% completely unguarded from creation. Both now fail; `--update-baseline` prunes
orphans too, without which the one command a maintainer would reach for could not fix the
complaint.

**Step 1 — the upgrade rehearsal**, the 15th gate and the only one that crosses a version
boundary. It installs the tarball, stages the reference customer's Layer 0/1/2 surfaces,
bumps the version, reinstalls, and asserts eight things — 21 customer files byte-identical,
the app still compiles through the unpacked `exports` map, no edits to our sources, and
**every slot the JSON manifest names still present in the upgraded package**.

That last assertion is the point, and it is demonstrated rather than argued.
`--break-slot toolbar` removes a slot named only in the JSON manifest and referenced by no
TypeScript: the compile stays **green** and that check alone goes red. A clean build and a
broken customer. `api-surface` would notice the declaration moved, but that reads as
"update the snapshot", not "every manifest naming this slot is now inert".

Honest limits, from the script's own header: the two versions differ only in their version
string — inventing API changes would be testing the invention, so sensitivity comes from
the negative control instead. And it is static, so it proves the contract survives, not
that the pixels arrive.

**Step 2 — Playwright E2E, where there was none.** Twelve specs over four critical paths:
browse, search, document detail and the route guards. Assertions are on repository _data_,
never on a component merely rendering — an unauthenticated XHR draws `lib-browse` with no
rows, which is visible and proves nothing. The document under test is discovered through
the app's own proxy rather than pinned, so the suite does not pass on one machine and read
as a product defect everywhere else.

Sensitivity was measured, not assumed: **with bogus credentials 9 of 12 specs fail**, and
the 3 that pass are the auth specs, which are deliberately credential-independent.

It does **not** run in PR CI. It needs a Nuxeo container with OpenSearch plus a served app,
and `verify-gate` has no precondition-not-met path — so it is a phase gate, and
`e2e-preflight.mjs` exits 2 rather than let an absent stack read as thirteen product
failures, or an _empty_ Nuxeo read as a pass. That it only runs when someone runs it is a
real limitation and is recorded as one.

Three corrections came out of this step, and two were defects in work from the day before:

- The guard spec asserted that an unauthenticated visitor is redirected, and failed. The
  cause was environmental, not a product defect: this Nuxeo has **anonymous authentication
  enabled**, so `/me` answers 200 as `Anonymous` with no credentials and the app's
  intentional SSO-detection path adopts that session. `authGuard` is sound. Now a verified
  fact in the agent contract, because it makes a class of auth assertion untestable locally.
  The product implication is carried forward: a customer deploying with anonymous auth on
  gets an app that signs unauthenticated visitors in, so the **privilege** boundary is what
  to test, not the sign-in boundary.
- The upgrade rehearsal's check 4d ran `git status` and claimed to prove "no edits to our
  sources were needed". It proved nothing — the script never touches the repo, so the claim
  was true by construction — and what it actually detected was uncommitted work. Replaced
  with a real invariant: the customer tree must import only published entry points.
- That replacement then missed its own probe, because a bare side-effect import has neither
  `from` nor parentheses. The shipped customer guardrail had the identical gap. Both fixed.

**Still open, with the real numbers:**

| Requirement         | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit coverage ≥ 90% | **10 of 11 in-scope projects** as of 2026-09-22, `shared-ai-client` short at 15.98%. Two earlier figures on this row were each true when written: "5 of 17" until 2026-08-24, when the gate stopped scoring 0/0 statements as 100%; then "3 of 15" before the Phase 6 coverage work took `search` 22.76% → 93.41% and `document-detail` 29.8% → 92.56%. Re-measure with `nvm use 20 && npm run beta:coverage -- --run` rather than quoting any of them. Re-measured 2026-10-24 on Angular 21 (NXSAT-669), whose Vitest 4 counts statements by syntax rather than by line: 11 of 16 in-scope projects ≥90%, `document-detail` 88.03%, with no covered line lost ([record](./angular-21-migration.md#coverage))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Playwright E2E      | **done** — 12 specs, 9 credential-sensitive; not in PR CI (needs Docker Nuxeo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| WCAG 2.1 AA         | **NOT MET as of 2026-11-23.** `phase-6-a11y/2026-11-23T08-09-11`, captured on `main` at e27deeaa0 with axe-core 4.14.1, reports `{steps:14, checks:35, failed:15}`. Fourteen failures are one node: `label-content-name-mismatch` (2.5.3 Label in Name, Level A, serious) on the navigation's user-profile control. With the rail collapsed it shows only the avatar initials NXSAT-673 added on 2026-10-26, which were not a word of its accessible name, and it is in the shell, so every surface failed. The fifteenth is a Health 404 on an optional configuration file the local server does not serve, which is an environment condition. The 35/35 of 2026-10-22 used axe-core 4.13.0, which does not run that rule under the WCAG tags. The 2026-09-15/16 `button-name` failures do not reproduce. The diagnosis is in `docs/accessibility.md`. The control was fixed the same day: `phase-6-a11y/2026-11-23T18-53-44`, on the fix's branch with axe-core 4.14.1, passes all 14 axe checks, 34 of 35, and only Health fails, on 404s that are not accessibility findings: the local environment's, its test data's, and the unexplained request that keeps Phases 1 and 2 open. That clears the capture's axe checks, not the bar: `docs/accessibility.md` records failures in states the capture does not reach. The sign-off pass is `2026-08-24T14-40-16`, 27/27: **met** on the 15 cases scanned, with 7 rule classes fixed, `KNOWN_VIOLATIONS` empty and three upstream nodes excluded on one step. Dialogs, upload, dark mode and pre-auth login are **not** covered |
| SAST                | **done, and the premise was wrong** — CodeQL default setup had run since 2026-07-24 and was reporting 21 open alerts, 6 high, that nothing read. All fixed; 14 of them from one HTML escaper missing the double quote. Two gates now consume the output: `supply-chain` (production `high`/`critical`, dated acceptances, unimported deps) and `code-scanning` (fails if the ref was never analysed). Production audit 1 low (quill, accepted to 2026-11-30); dev-inclusive 9 high, reported not gated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Safari              | **WebKit verified, not Safari** — `apps/nuxeo-ui-e2e/playwright.config.ts` registers a `webkit` project alongside `chromium`, and that file records the rule that it is "registered only once the suite passed on it", so its presence is the evidence. WebKit is the engine Safari ships; it is not Safari, and shares neither its UI nor iOS's stricter storage rules. This row read "never run; Chromium only" after that stopped being true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Coverage alone is most of the phase's 20-30 day estimate.

---

## 3. What was built — the harness

Nine gates, cheapest first. **Every one has been watched fail on purpose**, because a gate
nobody has seen go red is not evidence.

| Gate                                    | Catches                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `node`                                  | a wrong Node major, whose red is indistinguishable from a code defect |
| `lockfile`                              | a lock `npm ci` will refuse on Linux                                  |
| `guardrails`                            | style and architecture violations, **and hardcoded credentials**      |
| `assertions`                            | evidence assertions that **cannot fail**                              |
| `lint` / `test` / `build` / `typecheck` | the application                                                       |
| `bundle`                                | what a customer actually receives                                     |

Plus three checks deliberately outside the pipeline: `beta:coverage` (needs a measurement
run), `beta:state` (evidence lives outside the repo, so it is local-only), `beta:backend`
(starts containers).

Three of those gates exist because something got through:

- **`node`** — an agent on Node 25 saw `clipboard.utils.spec.ts` throw `SecurityError` and
  reported a _product defect_. Node 25 defines a `localStorage` that throws and shadows
  jsdom's. "Fixing" the spec would have damaged working code.
- **`assertions`** — Phase 1 shipped a defect past two checks that "certified properties they
  could not observe". One compared `"main.js"` to `"main.js"`; the review's own words were
  that it "could not fail — and notably it did not catch defect 1, which is precisely the
  failure it appeared to guard".
- **`bundle`** — Phase 3's spike found a dependency importing `ng-mocks`, a **test-mocking
  library**, from its shipped runtime bundle; with the real library installed it reached a 1.6 MB
  customer-facing chunk carrying two `eval()` calls. The gate reads the built bytes for both, and
  checks that the required assets ship non-empty. It does not measure size: the initial bundle's
  budget belongs to Angular's production build (`angular.json`), which fails `nx build nuxeo-ui`
  above `maximumError`.

A completed phase now cites a **specific** manifest rather than `latest`: a stale local dev server
turned Phase 0's newest capture red and invalidated a `complete` claim that was never in doubt.

**`beta:state`** is the anti-false-completion control: a phase may claim `complete` only if
its cited manifest exists and says `pass`. It has already refused a sign-off of mine — adding
the ninth gate invalidated three phases' re-gate citations until they were re-gated.

**Independent validation** is specified in `AGENTS/12-review-agents.md`, with thin adapters
for both toolchains (`.cursor/skills/audit-evidence/`, `.claude/agents/`). Its mechanical
half is `beta:audit` and `beta:state`. **Its human half has never been run** for Phase 1 or
Phase 2.

---

## 4. Decisions taken

No standing decisions are recorded here. The decisions already taken are in the "Decisions locked"
section of `docs/beta-plan.md`.

---

## 5. Numbers, for the leadership conversation

**These have not been presented yet and should be.**

### Initial bundle

Measured 2026-10-14 (NXSAT-638) on a production build on Node 20 with the Nx cache off: an initial
bundle of **2.96 MB** (616 kB transfer). `maximumError` is 4.0 MB, leaving 1.04 MB of headroom;
`maximumWarning` is 2.5 MB, which the build exceeds by 456 kB. Angular's production build
enforces the budget (`angular.json`): it warns above `maximumWarning`, fails above `maximumError`,
and prints the initial total — read the current number from `nx build nuxeo-ui`'s output rather
than from this file. The `bundle` gate checks what the bundle contains, not its size, and CI's 6 MiB
ceiling on all shipped JS and CSS is a separate step, "Check bundle size (nuxeo-ui)" in `ci.yml`.

### Unit test coverage, measured for the first time

Against the Beta bar of **90%**:

| Project                                                   | Lines | Short by  |
| --------------------------------------------------------- | ----- | --------- |
| `search`                                                  | 22.8% | 67.2pp    |
| `document-detail`                                         | 29.8% | 60.2pp    |
| `browse`                                                  | 56.7% | 33.3pp    |
| `ui`                                                      | 68.2% | 21.8pp    |
| `shared-ke-client`                                        | 70.9% | 19.2pp    |
| `nuxeo-client`                                            | 78.4% | 11.6pp    |
| `collections`                                             | 81.7% | 8.3pp     |
| `shared-kd-client`                                        | 88.1% | 1.9pp     |
| `shared-extensions`                                       | 96.0% | **meets** |
| `assets`, `core`, `drawers`, `shared-app-config`, `tasks` | 100%  | **meets** |

A **ratchet** gate stops these worsening; closing the gap is Phase 6 and it is large.
`nuxeo-ui` is excluded — its Karma builder takes a different coverage flag — and says so on
every run.

### Accessibility — the bar was met on 2026-08-24, and the baseline was wrong

On 2026-08-24 WCAG 2.1 AA was **met on the fifteen cases scanned**, with one upstream exception:
three `aria-required-children` nodes in an upstream component library's markup, excluded on the
step that scanned that library's surface alone. The library and its route were removed in October
2026, and the nodes left with them unfixed and never re-scanned. This is a dated result. Phase 6
step 3 was in question from 2026-09-23, and on 2026-11-23 the bar is **not met**:
`phase-6-a11y/2026-11-23T08-09-11` failed one WCAG 2.5.3 rule on one control, on every screen (the
WCAG row of "Still open", above). The control was fixed the same day, and
`phase-6-a11y/2026-11-23T18-53-44`, with axe-core 4.14.1, passes every axe check. The bar stays
not met for the failures recorded in states the capture does not reach. Before quoting a later
verdict, re-run `phase-6-a11y` and quote the axe-core version its manifest records
(`environment.axeCore`). The capture is pinned to 4.14.1 and refuses any other.

The number that matters more than the fixes: the previous capture scanned **three** surfaces and
ratcheted **four** rule ids. Widening it to fifteen cases found **seven** rule classes and **77**
violating nodes. Three of the classes existed only in view-mode and column-panel states that a
single visit per route never reaches — so the ratchet was reporting "no new violations" over a scan
that could not see half the violations.

| Rule                          | Nodes | Now | Owner                                             |
| ----------------------------- | ----- | --- | ------------------------------------------------- |
| `label`                       | 42    | 0   | ours                                              |
| `nested-interactive`          | 40    | 0   | ours                                              |
| `button-name`                 | 21    | 0   | ours                                              |
| `role-img-alt`                | 12    | 0   | ours                                              |
| `color-contrast`              | 7     | 0   | ours                                              |
| `scrollable-region-focusable` | 2     | 0   | ours                                              |
| `aria-progressbar-name`       | 2     | 0   | ours                                              |
| `aria-required-children`      | 3     | 3   | upstream; excluded, and its surface since removed |

Three findings worth more than the counts:

- **The most widespread violation was deliberate.** `sat-platform-nav` binds one translated string
  to _both_ `matTooltip` and `[attr.aria-label]`. Our catalogues set that key to `''` on purpose, to
  suppress a tooltip duplicating the visible label — and thereby gave the nav toggle
  `aria-label=""` on **every** surface, critical, for as long as the key had been blank. An empty
  accessible name is invisible unless you use a screen reader.
- **Two accessibility fixes already in the code did not work.** Browse carried
  `[attr.aria-label]` on its row checkboxes and axe still flagged them: Material declares
  `aria-label` as an _input_ and forwards it to the inner native control, so the `attr.` form
  leaves that control unnamed. Separately, `z-index` sat on `position: static` wrappers, where it
  does nothing.
- **The first regression check for this was itself defeated.** It read `aria-label` off the live
  element; re-introducing the empty override turned all twelve axe assertions red and that check
  still said pass. Replaced with deterministic assertions on the three files that constitute the
  mechanism, each falsified on its own. Fixing it exposed the half of the original fix that had
  been missed — `en-fallback.ts` still carried the empty strings, so a failed catalogue fetch would
  have silently restored the defect.

`KNOWN_VIOLATIONS` is now **empty**. The one exclusion was scoped to the upstream library's step
alone, not to `KNOWN_VIOLATIONS`, so the same rule failing on a surface we own still failed the
capture.

**Not covered, stated rather than implied:** dialogs, the upload flow, dark mode, and the pre-auth
login surface — the last a harness limitation, because the runner sets `httpCredentials` and the app
authenticates before login can render.

### Security

Production `npm audit`: **1 low** (`quill` XSS), 0 high, 0 critical — unchanged by adding
nine dependencies. `eval()` occurrences in the shipped bundle: **0** (was 2 before the
`ng-mocks` stub).

---

## 6. Known gaps, all named

Nothing here is a surprise later.

1. ~~**`routes`, `toolbar`, `contextMenu`, `tabs` slots are reserved and unread.**~~
   **Closed** — each gained a host; `toolbar`, `contextMenu` and `tabs` carry packaged entries
   and `routes` resolves contributions. NXSAT-316 added a ninth, `documentView`. The gated
   inventory is section 2 of `docs/extension-reference.md`.
2. **i18n covers three templates.** Inside Phase 1, which was recorded complete until 2026-11-02.
3. ~~**`nuxeo-ui` has no `typecheck` target.**~~ **Closed** — added and proven by
   reintroducing the exact typo that escaped twice.
4. ~~**The marketplace package has never been installed or upgraded on a real server.**~~
   **Rehearsed 2026-10-07** with `nuxeoctl mp-install` on a throwaway server, and the rehearsal
   **disproved** the design: after `bootstrap.json` was edited, an upgrade failed and left no
   version installed (NXSAT-317). NXSAT-317 ships only `bootstrap.example.json` and never installs
   the customer's file; the same rehearsal then passed for today's package → the fix, with and
   without an edit, fixed → fixed, a fresh install, and remove → reinstall. R7 is Low for that
   installer. _Superseded 2026-10-07 (NXSAT-312): no configuration file is installed at all; the
   rehearsal that matters now is upgrading ours with customer configuration packages installed,
   which passed (R7)._ **Still not rehearsed:** the Admin Center / Update Center path. The npm
   `upgrade-rehearsal` gate remains a separate exercise and never covered this.
5. **Independent validation has never run** for Phase 1 or Phase 2, and the multi-model
   review gate has never run at all.

---

## 7. Corrections made to the record

Kept because a record that hides its own errors is not one.

| Claim                                                 | Correction                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "CI has never run on this branch"                     | Wrong. `ci.yml` triggers on `push` as well as `pull_request`; it had run and passed repeatedly. Two phase reviews disagreed and the _other_ one was right.                                                                                                                                            |
| "`SATORI_GH_READONLY_TOKEN` was never set"            | Wrong. A repository secret since 2026-08-03.                                                                                                                                                                                                                                                          |
| "`phase-0-no-backend` is an abandoned red"            | Wrong. Its nine failures were one precondition mismatch — Nuxeo was up and that file requires it down.                                                                                                                                                                                                |
| Risk R7 downgraded to Low                             | Withdrawn. It was downgraded on the strength of an install path that would have 404'd.                                                                                                                                                                                                                |
| Phase 4 "libraries build with ng-packagr" ticked done | **Nothing built.** The tick rested on an `ng-package.json` existing — and `ng-packagr` is not installed, nor declared, so no build was possible. Corrected in `docs/phase-4-publishable-platform.md`, which now carries the blocker and why the lockfile change is deliberate rather than incidental. |

---

## 8. Keeping this file honest

Update it when: a phase changes status, a decision is taken, a number moves, a gap opens or
closes, or a claim is corrected. Prefer adding a row to rewriting a section — the history is
the point.

**Exhaustive is the standard.** A diversion, a challenge and a dead end each get their own line in
§10. A superseded claim moves to §7 rather than being deleted.

Do not restate §3's facts here in different words. Link to them.

---

## 9. Open decisions awaiting a human

None of these is blocked on work. Each is blocked on **someone deciding**, and each is listed with
what it costs to keep waiting.

| #   | Decision                                                                                                                                                                                                                                                                         | Options                                                                                         | Cost of not deciding                                                                                                                                                                                    | Who      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D-4 | **Independent validation has never run** for Phase 1 or Phase 2, and the multi-model review gate has never run at all.                                                                                                                                                           | Schedule it, or accept self-review for those phases and say so.                                 | Every phase so far has self-reported green **and** contained at least one overstated claim. Phase 1's would have shipped a dead feature to every customer. This is the control that catches that class. | Eng lead |
| D-5 | ~~**The marketplace package has never been installed or upgraded on a real server.**~~ **Decided by rehearsal, 2026-10-07:** install, customise and upgrade were run with `nuxeoctl mp-install`; the non-overwriting design failed and NXSAT-317 replaced it with a sample file. | Remaining choice: rehearse the Admin Center / Update Center path too, or accept it as untested. | Risk R7 is Low for the NXSAT-317 installer via `nuxeoctl`; the Admin Center path is unproven.                                                                                                           | Eng lead |

---

## 10. Diversions, challenges and dead ends

**The most expensive knowledge in this repo, and the easiest to lose.** Work that was tried and
reverted leaves no trace in the diff, so without this section the next person pays for it again.
Each row says what it bought, because a dead end that eliminated an option is not wasted.

| What was attempted                                                 | Why it was abandoned or reverted                                                                                                                                                                                                                                                                         | What it bought                                                                                                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A `row-selection` evidence screenshot of an unselected list**    | Byte-identical to the previous shot; the screenshot audit caught it. A picture of an unselected list is not evidence that selection works.                                                                                                                                                               | The step now selects a row, asserts the checkbox reports itself checked, then clears the selection.                                                                           |
| **`sortBy=ecm:isFolder`, to get folders-first from the server**    | Nuxeo answers an unsupported sort field with **HTTP 200 and zero entries**, not an error.                                                                                                                                                                                                                | Made the refuse-by-name pattern mandatory for sort keys, and settled that "folders first" cannot be expressed server-side at all. The default sort dropped the folderish key. |
| **A numbered pager**                                               | Nuxeo sets `resultsCountLimit` to the requested `pageSize` and counts only within it, so a real total arrives **exactly when the folder fits on one page** — measured, `pageSize=39` over 39 children answered `39` and `pageSize=20` answered `-2`. The total is known only when paging is unnecessary. | Next/previous, and a pager that shows a total only when the server gave one. Never `1–50 of 50`.                                                                              |
| **`git checkout` on a barrel, to undo a deliberate red-gate test** | It reverted three legitimate edits in the same file along with the test change, and the next `typecheck` passed **from cache** while the barrel was broken.                                                                                                                                              | A reminder that `--skip-nx-cache` is required after any revert, and that reverting by file is the wrong granularity when a file holds several changes.                        |

---
