# Demo deck — claims ledger

**Rule: no factual claim reaches a slide without a row here.** A row carries the claim, the
first-hand source, and the caveat that must travel with it.

This file exists because the failure mode of a leadership deck is not invention — it is a **true
number quoted without the caveat that makes it mean what the audience thinks it means**. This
programme has shipped that error before, in both directions, and an independent review caught it
every time.

Verified 2026-09-01 against the current branch unless a row says otherwise.

---

## 1. Part 6 re-verification (Phase A)

`docs/beta-demo-runbook.md` Part 6 lists fourteen things not to demo, dated 2026-08-25. **161
commits** landed since. Every entry re-checked against current code:

| #       | Verdict                     | Established by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F0**  | holds                       | No `acme.*` reference anywhere in `apps/nuxeo-ui/src`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **F1**  | withdrawn 2026-10-06        | NXSAT-313 added `branding.logo` to `AppBrandingConfig`; `bootstrap-config.spec.ts` asserts each accepted and rejected `src`. The navigation-rail mark, the expanded rail's "Content Innovation Cloud" title and the favicon still have no key.                                                                                                                                                                                                                                                                                                                                                  |
| **F2**  | holds                       | `app-shell.component.ts:203` — `return match?.label ?? …branding.applicationTitle`. The route label wins; the brand surfaces only on an unmatched route.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **F3**  | holds                       | `runtime-manifest.ts` declares neither `branding` nor `themes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **F4**  | holds                       | `applyOverride()` (`extension-slot-registry.service.ts:136-146`) patches only `order`, `label`, `rule`, `visible`. A `slots` addition reusing a packaged id spreads everything **except** `action` — which is why the runbook's "use `slots.documentList`" advice is right.                                                                                                                                                                                                                                                                                                                     |
| **F5**  | **WRONG — withdrawn**       | Was true of the template it cites and is not true now. `nav-drawer.component.html:10` renders `{{ item \| descriptorLabel }}` and the rail `{{ navText(item) }}` (`app-shell.component.html:25`); both prefer the descriptor's `labelKey` and fall back to `label`. `AppTranslateLoader` layers the manifest's `labels` last over the catalogue (`app-translate-loader.ts:220`, pinned by its precedence spec). So `labels["nav.item.<slug>"]` **does** relabel navigation, one text for all locales (not keyed by language). `overrides.<id>.label` bypasses the key and wins if both are set. |
| **F6**  | **WRONG — withdrawn**       | All four slots are live. Registered `provide-app-extensions.ts:104-106`; `toolbar` rendered `document-detail.html:140`; `tabs` `document-detail.ts:378`; `contextMenu` `browse.ts:459`; `routes` `extension-routes.ts:96` + `provideExtensionRoutes()` at `provide-app-extensions.ts:197`, calling `router.resetConfig` at `extension-routes.ts:112`.                                                                                                                                                                                                                                           |
| **F7**  | holds, **different reason** | The rule bodies are real (`document-rules.ts:52-56`). The **writer** is missing: `provide-app-extensions.ts:174-176` sets `username`, `isAdministrator`, `selectionCount` — never `selection`. Always `false` in effect.                                                                                                                                                                                                                                                                                                                                                                        |
| **F8**  | holds (core defect)         | Byte-identical duplicates confirmed by size in `showcase-adf-hx/2026-08-20T14-07-03/`: three files at exactly **64,105 B**, two at **74,300 B**. The exact 21/22 figure was not re-run.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **F9**  | holds                       | `app.routes.ts:34` defines the route; no nav descriptor references it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **F10** | holds                       | The three ids are registered (`extensions.ts:85,107,116`) but `NAV_ITEMS` places only `acme.navbar.acmeExtensions`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **F11** | **not re-verified**         | Needs a production build, a static serve and a real sign-in attempt. Recorded as unconfirmed rather than restated. Use `nx serve` and the question does not arise.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **F12** | holds                       | Live check: `/default-domain/config/satori-template` exists, `note:note` empty. _Since NXSAT-312 no Note is read; the template serves a manifest with no fragments._                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **F13** | **WRONG — withdrawn**       | Re-checked 2026-09-26. The absent local `target/` said only that nobody had run Maven **on a laptop**; it runs in CI on every pull request. `2026.0.1-20260926071953-BUILD-1109` was built and published to preprod by run 36226401180 and is live on the listing. Installing the ZIP and upgrading over it were then rehearsed on 2026-10-07 with `nuxeoctl mp-install` — see the upgrade row in section 2 and NXSAT-317. The Admin Center / Update Center path is still unverified.                                                                                                           |

**Nine of the fourteen hold as written. Three were wrong and are withdrawn, one holds for a
different reason, one is unconfirmed.** That base rate is the argument for re-verifying rather than trusting a
dated document — F5 is the demonstration: it held when it was written, was re-verified as holding on
2026-09-01, and was withdrawn on 2026-09-26 when a reviewer read it against the template it cites
rather than against the earlier verdict.

### Two staleness findings outside Part 6

| Finding                  | Was                                          | Is                                                                                                         |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Beat 1 document count    | "113 documents"                              | **187** (live NXQL count, non-trashed, 2026-09-01). Drifts with use — re-count, never quote.               |
| Upstream component count | Part 5 said "Six"; Part 1's table said seven | **Seven.** Counted from aliased imports. Part 1 was right. This is the first number the audience asks for. |

### One state finding that would have produced a false slide

The manifest document at `/default-domain/config/agentic-ui` (no longer read since NXSAT-312) **was not empty** — it held Beat 6's
column overrides from an earlier run (`lastContributor` → "Updated by", `modified` hidden).
Capturing browse in that state and captioning it "the product as shipped" is a customised screen
with a baseline caption — the F8 failure class exactly. **Reset to `{"version":1}` before any
baseline capture.** Added to the runbook as a Beat 1 precondition.

---

## 2. Claims cleared for slides

| Claim                                                              | Source                                                                                                                                                                                                                        | Caveat that must travel with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~**7 upstream adf-hx components adopted**~~ withdrawn             | 7 `Upstream*Component` aliases, verified                                                                                                                                                                                      | **Withdrawn 2026-10-14 — do not say it.** NXSAT-635 removed the POC route they rendered on, and NXSAT-638 the packages. Caveat as cleared: The `hxp-` prefix says nothing about authorship — **13 same-prefix components are ours**. History and Trash are ours, reading real Nuxeo audit and trash APIs.                                                                                                                                                                                                                                                           |
| ~~**13 components are ours**~~ withdrawn                           | `libs/shared/adf-hx-bridge/src/lib/ui/` — 13 dirs                                                                                                                                                                             | **Withdrawn 2026-10-14 — do not say it.** NXSAT-635 removed the library. It was cleared with no caveat.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Real repository, 187 documents**                                 | Live NXQL count 2026-09-01                                                                                                                                                                                                    | Drifts with use. Re-count at capture time; do not reuse this figure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Four extension slots now live**                                  | Phase A, F6 above                                                                                                                                                                                                             | New as of 2026-08-31. Layer 1 remains **additive**: a manifest can add, hide, reorder and relabel, but cannot replace a packaged route or change what a packaged tab renders.                                                                                                                                                                                                                                                                                                                                                                                       |
| **`@nuxeo-satori/platform`, 5 entry points**                       | Runbook Part 2                                                                                                                                                                                                                | **Publishable, not published.** Nothing is on any registry. `private: true` is a deliberate tripwire. The final package name is part of the publish step.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **A customer's configuration package survives an upgrade of ours** | Rehearsed 2026-10-07 on a throwaway server with `nuxeoctl mp-install` (NXSAT-312, A4): upgrading `nuxeo-agentic-ui` with two customer packages installed reinstalls them and serves byte-identical configuration (same ETags) | Say it for `nuxeoctl mp-install`, which is what was rehearsed. **Do not** say an edited `bootstrap.json` survives: since NXSAT-312 nothing is edited on the server and a file left there is not served — configuration comes only from packages, with no migration. The Admin Center path is unrehearsed. The `upgrade-rehearsal` gate is separate: it crosses a version boundary for the **npm package**.                                                                                                                                                          |
| **Rebrand with a byte-identical bundle**                           | Runbook Beat 3, `sha256` of `main-*.js` unchanged                                                                                                                                                                             | Verified pre-2026-08-25. **Re-verify before presenting.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Hiding an action is not a security control**                     | Manifest visibility vs. Nuxeo ACLs                                                                                                                                                                                            | Volunteer this rather than be caught by it. Demonstrate by typing a hidden route into the address bar — the page still loads.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **10 of 11 in-scope projects meet 90%**                            | `npm run beta:coverage -- --run`, 2026-09-22                                                                                                                                                                                  | **Was 10 of 10 until 2026-09-22 — do not present the older figure.** The denominator moved, not the code: `assets`, `tasks` and `shared-ai-client` had never been measured, and `shared-ai-client` came in at 15.98%, which reopened Phase 6 step 6. Also percentages of the **measured subset**: **6,137 in-scope lines are imported by no test at all**, contribute no statements, and cannot lower any percentage. Not the same claim as "the code is 90% tested".                                                                                               |
| **WCAG 2.1 AA met**                                                | Phase 6 step 3 — **RE-VERIFY OR DROP THIS CLAIM**                                                                                                                                                                             | **Do not present as-is.** Five consecutive `phase-6-a11y` captures since 2026-09-15 fail 3 checks — `button-name`, axe serious/critical, on browse, browse cards and the column panel. Undiagnosed as of 2026-09-23, so the claim is unverified rather than known false; the last passing capture is 2026-08-24. If it holds on a fresh run, the standing caveats still apply: 15 cases over 8 routes, **dialogs, upload, dark mode and the pre-auth login surface not covered**, and one upstream violation (`adf-core` `role="row"`) excluded on that step alone. |
| **3.56 MB initial bundle vs a 4 MB budget**                        | Runbook Part 5                                                                                                                                                                                                                | adf-core registers eleven root services, so it is **eager** — every user pays it, including users who never open an adf-hx route.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Template app: zero internal imports**                            | Runbook Beat 11                                                                                                                                                                                                               | Re-measure the line count and bundle size before quoting them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **18-gate pipeline**                                               | Commit `d781349`                                                                                                                                                                                                              | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 3. Claims that must NOT appear

| Do not say                                 | Why                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~"The marketplace package builds"~~       | **Now sayable** (F13 withdrawn 2026-09-26): built and published to preprod, live on the listing. "Installs" and "upgrades" are sayable only for `nuxeoctl mp-install` of a package with the NXSAT-317 fix (rehearsed 2026-10-07); not for the Admin Center, and not for earlier packages.   |
| "Published on npm"                         | It is publishable and dry-run verified. Nothing is on any registry.                                                                                                                                                                                                                         |
| ~~"You can change the logo"~~              | **Now sayable** (F1 withdrawn 2026-10-06): `branding.logo` in a bootstrap fragment replaces the Satori word mark in the header and the lockup on the login page. Do not extend it to the navigation-rail mark, the rail's "Content Innovation Cloud" title or the favicon — none has a key. |
| "90% of the code is tested"                | Says something the measurement does not support — see the coverage caveat above.                                                                                                                                                                                                            |
| "Phase 6 is complete"                      | `docs/adf-hx-beta-plan.md` says complete; `.ai/state/phases.json` still says `in-progress` with a stale `notCovered` block. **Unresolved repo inconsistency — resolve before quoting either.**                                                                                              |
| "Metadata is editable in the adf-hx panel" | Upstream does not export the cache service its metadata sidebar needs; the read-only properties panel renders instead.                                                                                                                                                                      |

---

## 3a. What the capture gates caught (Phases C–D)

The harness is `scripts/demo-deck/capture.mjs`. All three falsifiable gates were watched failing
before any output was trusted, and the first honest run then found five problems — **four of them in
my own harness, one in the app**. That ratio is the argument for the gates: none of these was
visible in a passing screenshot.

| Found                                          | Whose fault | Consequence had it shipped                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The route gate was tautological**            | harness     | It compared where it landed against where it had just been told to go — true by construction. A deliberate mis-route passed it; only the content gate caught it. This is the tautological path check this repo has already been burned by, reproduced exactly.                                                                                                          |
| **The console allowlist could never match**    | harness     | Playwright's message is "Failed to load resource: … 403" with **no URL in the text**, so URL-fragment matching matched nothing and the two documented-expected failures failed every run. The tempting fix — allowlist `Failed to load resource` — is the F8 postmortem's own recorded mistake. Split into failed-responses-by-URL and never-allowlisted JS exceptions. |
| **A false PASS from incidental text**          | harness     | `core-04-adfhx-list` asserted `'Workspaces'` and passed **while no document list existed at all** — it matched the domain-hint banner's sentence "Open Sections, Templates, or Workspaces…". An assertion satisfied by unrelated prose is not an assertion. Replaced with a structural predicate on `hxp-document-list adf-datatable [role=row]`.                       |
| **`.first()` matched the select-all checkbox** | harness     | Selected all five rows, so the panel correctly read "select a **single** document" — indistinguishable from a broken panel. The screenshot looked like an upstream defect and was not one.                                                                                                                                                                              |
| **A whole run authenticated as `Anonymous`**   | environment | The most expensive one. See below.                                                                                                                                                                                                                                                                                                                                      |

### The authentication trap, and a correction

Seeding `sessionStorage` is **not sufficient** on this deployment. This Nuxeo has anonymous
authentication enabled — a recorded verified fact — so `/me` answers `200` as `Anonymous` and the
app's SSO-detection path **adopts that session**, overwriting the seeded one. Measured: after seeding
Basic Administrator, `sessionStorage` held
`{"kind":"cookie","username":"Anonymous","isAdministrator":false}`.

The visible result was browse rendering **"Failed to load folder contents."** with `0 result(s)`.
**I initially read that as a functional regression in the runbook's strongest beat, and said so. That
was wrong**, and the check that settled it was cheap: on the identical path, an explicit Basic header
answers `200`. Anonymous simply cannot read the folder, and refusing it is correct behaviour.

The harness now clears cookies before seeding, and **Gate 0 aborts the run** if `/me` is not the
expected user — because a full run as Anonymous passes dedup, passes every route assertion, and
yields empty and error states throughout. Nothing looks wrong until it is on a slide captioned "real
repository".

### A fourth expected error, documented nowhere

`AuthService.clearStaleNuxeoCookieSession()` (`auth.service.ts:156-166`) GETs `/nuxeo/logout` to drop
a stale `JSESSIONID` and swallows failure with `catchError`. Measured against this Nuxeo:
`GET /nuxeo/logout` → **404**, `GET /nuxeo/logout?requestedUrl=/nuxeo/` → **302**. The call omits that
parameter, so **it very likely never clears the session it exists to clear**, and the `catchError`
hides that. It is the app's own defence against the anonymous-adoption trap above, and it is not
working. Allowlisted in the harness with the reason stated; **worth a look on its own merits, and out
of scope for the deck.**

### Verified captures

Five, all distinct by SHA-256, all asserting their own content, run exit 0. The properties shot was
read visually as well as gated: it shows `Q1 2026 Content Strategy Review` with **Created rendered as
`Apr 24, 2026` and Creator as `Administrator`** — the two fields that once rendered a raw ISO string
and `[object Object]`, so W11's `sys` pseudo-schema is visibly working.

> **Caveat for that slide:** `Creator` reads `Administrator` because that is the username. This is
> **D4** — Nuxeo carries only the username on the document, so a real deployment reads `jdoe`, not
> `Jane Doe`. Do not present this field as a display name.

---

## 3b. Appendix evidence (A2–A8)

Only A4 needed a screenshot. A2 and A3 are real captured CLI output — **not retyped**, saved under
`cli/` in the capture directory. A5–A8 are derived from source.

| Slide  | Evidence                                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A2** | `npm run beta:upgrade` exit 0, and `--break-slot toolbar` exit 1. Both runs captured verbatim.                                                                                           |
| **A3** | `npm run beta:customer-guardrails` exit 0, plus the same guardrail exit 1 against a throwaway copy carrying one deep import. The real library was untouched — confirmed by `git status`. |
| **A4** | The core-04 capture, annotated from live DOM bounding rects. All six callouts resolved.                                                                                                  |
| **A5** | 5 entry points (**from the guardrail's own output**, not asserted), 8 slots (from `extension-slots.ts`), 4 generators (from `generators.json`), 7 upstream + 13 ours.                    |
| **A6** | The coverage/a11y/security/browser rows in §2, each with its caveat.                                                                                                                     |
| **A7** | The Part 6 re-verification in §1, plus D4 and D5 from the workarounds register.                                                                                                          |
| **A8** | Layer structure from `libs/platform/package.json` (`private: true`, confirmed) and the bridge's location outside the package.                                                            |

### One claim I trimmed rather than made

The runbook says `--break-slot toolbar` "leaves the compile GREEN and only that check goes red — a
clean build and a broken customer". **The failing run does not demonstrate that.** It is 146 lines and
short-circuits from the negative-control notice straight to `FAIL`; the compile checks never run, so
no green compile is observed alongside the red check.

The mechanism is sound and is the gate's stated rationale — nothing type-checks JSON, so a renamed
slot is invisible to the build. But that is a _rationale_, not a jointly-demonstrated result, and the
slide says "this is the failure JSON cannot catch" rather than "we watched it compile clean".

### A third document/code mismatch, in the plan of record

`docs/adf-hx-beta-plan.md` said, in the present tense, "Nine slots are implemented; five are deferred
to GA". Both halves were wrong: source defines **eight**, and commit `7fd5e46` made the last four
live, so **none is deferred**. Confirmed independently by `beta:upgrade`, which prints the shipped set.
Corrected, with the correction noted inline.

Note the direction of the two errors: the plan **understated** the addressable surface while the
runbook's F6 **told a presenter four slots were inert**. The same staleness, read from opposite ends,
in the two documents a presenter would rely on.

### The dedup gate forced a better design

A separate `appx-a4-anatomy` capture was rejected as byte-identical to `core-04-adfhx-list` — same
route, same state, same pixels. The gate was right, and the correct response was not to defeat it: A4
needs that capture _annotated_, not duplicated. One capture, two presentations. A callout whose
selector matches nothing now fails the run, so an anatomy diagram cannot be silently missing a part.

---

## 4. Open item flagged for the presenter

**Phase 6 status is inconsistent in the repo.** The plan document records all seven steps done on
2026-08-31; `.ai/state/phases.json` still carries `"status": "in-progress"` and a `notCovered` list
naming figures the coverage work superseded ("3 of 15 measurable projects", "search 22.76%").

`npm run beta:state` is the machine-checked source and CLAUDE.md points at it, so the mismatch is
load-bearing rather than cosmetic. It is not a presentation problem to paper over — either the state
file is stale and should be updated, or the plan overstates. **Resolve it before a slide quotes
either number.** Not resolved as part of the deck work, because which one is right is a programme
decision, not a documentation one.
