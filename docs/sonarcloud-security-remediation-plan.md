# SonarCloud security remediation plan

**Scope:** the 34 issues with a `SECURITY` software-quality impact, status `OPEN` or `CONFIRMED`, on
`nuxeo_agentic-ui-poc` — the SonarCloud project key, which kept the repository's former name when
GitHub renamed `nuxeo/agentic-ui-poc` to `nuxeo/Nuxeo-Satori-UI` on 30 October 2026. Every
`componentKeys=` below is that key and is correct as written.
**Sonar effort estimate:** 1 000 minutes (16 h 40 m). That number is Sonar's per-rule default
(30 min × 32 + 5 + 5), not an estimate of this plan.

Sections 1–4 and 6–8 are the original analysis and recommendation. Section 5 described a harness
that has since been built; section 9 records what has actually landed.

---

## 0. Execution status — 2026-09-09

Read the table, not this line. **Landed: E, the harness, A, B part 1, B part 2 (the NONE-context
bug fix), C, and D.** Category C carries an accepted residual risk — see its section below before
reading "Done" as "closed".

| Category                                | Sites                  | Status                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E** — `S2245` `Math.random`           | 1                      | **Done.** `crypto.randomUUID()` in `kd-client.service.ts`. Spec updated to the UUID shape.                                                                                                                                                                                                                                       |
| **E** — `S5332` `http://` default       | 1 reported, **2 real** | **Done, at the second attempt.** See "The `S5332` fix was wrong first time" below. Open question 2 is still open — this removes the bad defaults but does not decide whether ARender is expected to work in a deployed build.                                                                                                    |
| **Harness**                             | —                      | **Done.** `sanitizer-audit.mjs` (5 checks + a budget ratchet), `sanitizer-allowlist.json`, and `sanitizer-audit.selftest.mjs` are wired into `verify-gate.mjs` and `review:preflight`; current counts are intentionally emitted by `npm run beta:sanitizers` and `npm run beta:sanitizers-selftest` rather than duplicated here. |
| **B part 2** — `Safe*` in NONE contexts | 6 bindings, 5 live     | **Done, and this was a live defect, not a lint finding.** See below. The sixth, `video[poster]`, is **dormant** — `posterUrl` is only ever set to `null`, so that binding cannot render a value today and its fix is pre-emptive. Counting it without that qualifier overstated the defect by one.                               |
| **B part 1** — `trustObjectUrl`         | 7                      | **Done.** The seven inline object-URL bypasses are centralized in `trustObjectUrl`, with scheme guarding and caller-owned provenance documented.                                                                                                                                                                                 |
| **A** — redundant bypasses              | 14                     | **Done.** Redundant object-URL bypasses on `img[src]` were deleted; the ratchet budget is now zero.                                                                                                                                                                                                                              |
| **C** — validate then bypass            | 2                      | **Done.** Both sites validated, failing closed. This was the highest actual risk in the set. See below.                                                                                                                                                                                                                          |
| **D** — centralise trusted HTML         | 6 entries / 8 calls    | **Done.** Sites are routed through `renderTrustedHtml`; the helper sanitizes first and enforces a restricted DOMPurify config surface before bypassing.                                                                                                                                                                          |

Bypass count and category budgets are now emitted by `beta:sanitizers` from `.ai/state/sanitizer-allowlist.json` to avoid stale hand-maintained totals in this document.

### The `S5332` fix was wrong first time — and the reason generalises

The first attempt changed `provide-app-config.ts` to `configured ?? null` and reported the issue
closed. It was reviewed and rejected, correctly, for two reasons.

**1. It put `null` into a non-nullable token.** `ARENDER_CONFIG` was
`InjectionToken<ARenderConfig>`, and `ARenderService` dereferenced it with no guard. Reproduced
first-hand with a spec providing exactly what the new factory returned:

| Method              | Behaviour with `null`                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `isAvailable()`     | `TypeError` raised **inside** the Observable subscriber → RxJS error notification → swallowed by `document-detail.ts`'s `error:` handler |
| `getPreviewerUrl()` | **threw synchronously** — no `error:` handler can catch it                                                                               |
| `getDiffUrl()`      | same                                                                                                                                     |

So the UI did reach "Annotations are not available", but by accident: via a swallowed type error,
and only because `isAvailable` errored first so `switchMap` never ran the method that throws
properly. Correct behaviour one refactor away from an unhandled exception.

**`typecheck` structurally cannot catch this.** Angular's `Provider` union types `useFactory` as
`(...args: any[]) => any`, so handing `null` to a non-nullable token compiles clean. No gate in the
repository could have caught it — the only thing that would is a test, and `ARenderService` had no
spec at all.

**2. The literals were still in the tree.** `arender.config.ts` held both of them in the token's own
default factory, so removing the fallback in the _consumer_ changed nothing about what an
unconfigured build uses.

Sonar never reported that file, because `sonar-project.properties` excludes every `*.config.ts`
(lines 25 and 64). **The exclusion is the finding.** A config filename is where hardcoded
endpoints, defaults and credentials are most likely to live, and it is excluded from the scan; the
one `S5332` that was reported landed on the consumer's copy, and only on
`http://nuxeo-auth-proxy/nuxeo` — `S5332` exempts `localhost`, which is why the `localhost:8180`
literal beside it was never flagged either. Reviewing that exclusion list is worth more than fixing
this one finding.

**A third defect, found while fixing the second.** `mergeIntegrations` in `bootstrap-config.ts:339`
carries the comment _"Both endpoints are required: half an ARender configuration is worse than
none"_ — and does not enforce it. A manifest naming only `viewerOrigin` yields
`{ viewerOrigin: '…', nuxeoInternalUrl: '' }`, because the missing half falls back to
`base.arender?.nuxeoInternalUrl ?? ''` and `base.arender` is `null`. A blank endpoint is worse than
`null`: `fetch('')` resolves against the _application's own_ origin, so `isAvailable()` would report
a viewer as present and `getPreviewerUrl` would build a same-origin `/?url=…` that then gets
trusted and loaded into an iframe. `ARenderService` then treated a blank endpoint as absent, which
made it correct regardless of that layer. **The comment/code mismatch in `bootstrap-config.ts` was
left unfixed** — it is Layer 0 manifest semantics and wanted a deliberate decision, not a drive-by.

> **Superseded by NXSAT-279.** That decision has now been taken, and it went the other way: only
> `viewerOrigin` is required. The client no longer builds a `?url=` from `nuxeoInternalUrl`, so the
> field is vestigial, and requiring it would have forced deployments that retired the auth-proxy
> sidecar to invent a dummy value. `completeARenderConfig` now returns `null` only on a blank
> `viewerOrigin`, and its comment says so — the mismatch is resolved by changing the comment's claim
> to match a deliberately chosen contract, not by enforcing the old one.

**What the fix is now:** `ARENDER_CONFIG` is `InjectionToken<ARenderConfig | null>` with a
`() => null` factory (both literals gone); `ARenderService` guards on absent _or incomplete_ config,
with `getPreviewerUrl`/`getDiffUrl` widened to `Observable<string | null>`; `provide-app-config.ts`
passes the manifest value straight through. New `arender.service.spec.ts`: 19 tests, characterising
the configured path as well as the two unconfigured ones. The 4 null-config tests were confirmed red
before the fix.

**The lesson worth keeping:** "remove the hardcoded default" is not the same change as "make the
unconfigured path work", and a green gate on the first without the second is exactly the kind of
overstated completion this programme keeps producing. Every phase so far self-reported green and
contained at least one such claim; this was one, and it was caught in review rather than by any
gate.

### Category C

> **Update (NXSAT-279).** The missing origin allow-list described in this section is **closed**.
> `ARenderService` no longer builds the viewer URL — it asks Nuxeo for it via
> `Document.ARenderGetPreviewerUrl` — so `viewerOrigin` is no longer needed to construct anything
> and now serves as `allowedOrigins` on the URL the server returns. Verified by negative control:
> removing the allow-list turns two tests red. A CSP `frame-src` is still not set, so that half of
> the residual risk stands.
> — the deliberate exposure, now closed

The Category E work removed the _accidental_ exposure (a compiled `http://localhost:8180` default)
and left the _deliberate_ one: `document-detail.ts` bypassed and navigated the ARender URL with no
scheme or origin check, so a manifest setting `viewerOrigin` to `javascript:alert(1)` reached the
iframe intact. A blank-endpoint check does not catch it, because `javascript:alert(1)` is not
blank — it is complete, well-formed, and `new URL()` parses it without complaint. That is the whole
difficulty of this category: the dangerous value looks exactly like a valid one.

**New helper:** `libs/shared/nuxeo-client/src/lib/utils/navigable-url.ts` — `navigableUrlOrNull`,
`originOf`. 43 tests, overwhelmingly negative cases.

It **resolves and compares origins** rather than testing string prefixes, and that is the
load-bearing design choice. The obvious same-origin test, `candidate.startsWith('/')`, accepts
`//evil.example/x` — protocol-relative, and a different origin. `new URL(candidate, base)` plus an
`origin` comparison gets that right with no special case, and `/\evil.example` too. Both are
regression-tested.

Two subtleties worth keeping:

- **`new URL('javascript:alert(1)')` does not throw.** `javascript:` is a valid scheme; the parse
  succeeds and yields `origin === 'null'`. So a scheme allow-list is required — an origin check
  alone would compare `'null'` against the allow-list and could match another opaque origin.
  `originOf` therefore maps `'null'` to `null` rather than returning it as a comparable string.
- **An allow-list that resolves to nothing rejects everything.** `NUXEO_API_ORIGIN` is `''` when the
  dev proxy is in use, so "no usable entries" is routine; treating it as "allow all" would turn a
  misconfiguration into an open redirect.

**Site 1 (ARender) is defended twice, both failing closed to `null`:**

1. `ARenderService.cfg` treats a `viewerOrigin` that is not an http(s) origin as _unconfigured_, so
   no URL is ever framed. `https:` is required unless the host page is itself plaintext — see
   `insecureAllowedForHost`.
2. `loadARenderUrl` re-validates before `bypassSecurityTrustResourceUrl`. A privilege boundary
   defended in exactly one place is one refactor away from being undefended.

Since NXSAT-279 the URL is no longer built here at all — `Document.ARenderGetPreviewerUrl` returns
it — so there is a third check between the two: `framableOrNull` validates the **response body**
against `allowedOrigins: [viewerOrigin]` before it reaches either.

`nuxeoInternalUrl` is no longer validated at all. It addressed the retired auth-proxy sidecar; NEV
2026's connector resolves blobs itself from `documentId` over OAuth2, so nothing reads the field and
checking it could only reject configurations that would have worked.

**Site 2 (Nuxeo preview)** is constrained to same-origin or the configured `NUXEO_API_ORIGIN`, and
dropped otherwise, falling through to the viewer's "Preview not available" placeholder.

#### ACCEPTED RESIDUAL RISK — the allow-list is itself customer-configured

"Category C mitigated" should not be read as more than it is, but note what changed: site 1 now
checks the origin as well as the scheme.

```ts
navigableUrlOrNull(url, {
  allowInsecure: insecureAllowedForHost(isDevMode()), // host-relative, not build-relative
  allowedOrigins: [cfg.viewerOrigin],                 // CLOSED by NXSAT-279
```

There **is** an origin allow-list on the ARender site as of NXSAT-279. It was absent while the
client built the viewer URL from configuration, because the only candidate for an allow-list was the
same value being concatenated and checking it against itself proved nothing. Now that the URL
arrives in a Nuxeo **response body**, `viewerOrigin` has something to constrain, and a compromised
server cannot redirect the iframe to an origin the deployment did not configure. Site 2 is
origin-checked against `NUXEO_API_ORIGIN` for the same reason — the answer is knowable.

So Category C closed the **privilege escalation** (`javascript:` in the manifest becoming script
execution in _our_ origin, with access to the session and the DOM) and, with it, the
server-controlled redirect. What remains is **inherent to the feature**: whoever can edit the
app-config manifest sets `viewerOrigin`, which is the allow-list, so they can still point that
iframe at any `https:` origin they like.

That residual is accepted on three grounds:

1. **It is not an escalation.** A third-party `https:` origin in an iframe is a separate browser
   origin — no access to our DOM, cookies, or `localStorage`. The `javascript:` case was categorically
   different, which is why it was worth a doubled guard.
2. **The manifest is already a trusted input.** Per `AGENTS/11-beta-program.md` it is a
   customer-owned Layer 0 surface that also sets themes, branding and slot wiring. Someone who can
   rewrite it can already change what the application does; an iframe destination is not the
   sharpest tool available to them.
3. **A CSP `frame-src` is the right control, not client-side validation.** The correct place to bound
   which origins may be framed is a response header, which holds regardless of what this TypeScript
   does and cannot be edited by whoever edits the manifest. **No `frame-src` is currently set** —
   that is worth a ticket, and it is the thing that would actually close this.

**Not accepted, and not claimed as covered:** anything that lets an _untrusted_ party write the
manifest. That would be a Layer 0 authorisation defect, and the scheme check would be the last line
rather than the first.

**Failing closed costs a feature, not a page.** `null` is the state the templates already render for
"ARender is not deployed" and "no preview available", so every rejection path was already exercised.

**Evidence.** 13 rejection tests were added at the service and component layers, plus the 43 on the
helper. The 8 component-level ones were confirmed **red** with both guards removed and green with
them restored. The `https`-in-production branch is exercised by clearing the `ngDevMode` global,
which drives Angular's real `isDevMode()` rather than mocking it — needed because `isDevMode()` is
`true` under Vitest, so the first version of that test was silently asserting the dev path.

### The Sonar quality gate cannot go green, and why that is not a defect

Worth writing down because it will confuse the next reader of PR #157, where the gate is red on one
condition: `new_security_rating` 5 (E) against a threshold of 1 (A). Everything else passes,
`new_coverage` included at 92.6%.

**All of the findings pre-exist on `main`.** Every one is `S6268` on a bypass already there; they
count as "new code" only because edits shifted their lines. Re-confirmed against the Sonar API for
both refs at `f865a85` — the count is **six**, not the five first recorded here, and every line
number has moved:

| On `main`                     | On the PR | Member                | Category |
| ----------------------------- | --------- | --------------------- | -------- |
| `case-file.ts:191`            | `:220`    | `loadPreview`         | B        |
| `document-detail.ts:2561`     | `:2594`   | `loadPreviewFallback` | C        |
| `document-detail.ts:2670`     | `:2723`   | `setBlobUrl`          | B        |
| `document-detail.ts:3424`     | `:3478`   | `previewMainBlob`     | B        |
| `document-detail.ts:3458`     | `:3526`   | `loadARenderUrl`      | C        |
| `tasks-page.component.ts:669` | `:729`    | `loadPreviewBlob`     | B        |

`previewMainBlob` is the sixth and is **not a new bypass** — the project-wide total is still 32 → 31.
A later commit on this branch edited its line, which is all it takes for Sonar to reclassify an
untouched call as new code. Worth stating plainly, because this number will drift again on the next
edit: it counts the lines this branch has touched, not the debt. All six are registered in
`sanitizer-allowlist.json`, which is the count that means something.

Two of the six (the Category C sites) went from unvalidated to validated-and-failing-closed. `S6268`
fires on the presence of the call, not on whether its input is guarded, so it cannot see that
difference.

**The rating cannot reach A by any amount of code work.** It requires _zero_ open vulnerabilities in
new code and one BLOCKER forces E, but Fact 4 in section 2 establishes that `iframe[src]` throws on a
raw string — a bypass is structurally required. Consolidating every bypass into one audited helper
still leaves that helper's own call, and a new file is entirely new code. **The floor is 1, and 1 is
still E.**

So the gate is accepted as red, which is what `sonarcloud.yml` already does via
`continue-on-error: true` — its comment records that this repository once had CI red for 16
consecutive runs over an unowned threshold and taught everyone to ignore it. It is not a required
status check. This is **not** a statement that the findings are acceptable: the endgame is to finish
A, B and D to reach the floor, then transition the residual issues to _Accepted_ with a justification
naming this document and the allowlist entry — which needs **Administer Issues** (open question 4).

Deliberately not done: `// NOSONAR`, a blanket `eslint-disable`, or an Accepted transition while the
code is unchanged and unguarded. Each clears the number and destroys the record of the reasoning at
the same time. What guards these instead is `sanitizer-audit.mjs`, which is stricter than `S6268` on
the axis that matters — registration with a justification, a shrink-only budget, and two defect
classes Sonar cannot see.

### What section 2 predicted, and what was found

Section 2 predicted in writing — before the tool existed — that a `Safe*`-in-NONE-context check run
against `main` "must go red on `document-viewer.component.html:38/41/50` and
`attachment-preview-dialog.ts:40/44`", and that `video[poster]` was "the same shape but dormant".

Check 4 reported **exactly** those five, at those line numbers, plus the dormant `video[poster]:35`.
A prediction made before the instrument existed, confirmed by the instrument, is the strongest
evidence in this document.

The defect was then reproduced first-hand. Reverting `<audio [src]>` to the wrapped value and
reading the rendered attribute back yields:

```text
src="SafeValue must use [property]=binding: blob:http://localhost/real-object-url (see https://angular.dev/...)"
```

So audio playback, the single-source video fallback, the transcoded-video source list, and video
and audio _attachment_ previews were all broken in the shipped code. Fixing `S6268` correctly made
the application work better, exactly as section 2 argued it would.

### What changed

- `DocumentViewerComponent` gained `rawBlobUrl: string | null`; `<source [src]>` and `<audio [src]>`
  now bind it. `blobUrl` stays `SafeResourceUrl` for `iframe[src]`, which conversely throws on a
  raw string.
- `VideoSource.url` and `posterUrl` widened from `SafeResourceUrl` to `string`. Both are
  NONE-context-only, so the previous type could not work for any non-null value.
- `fetchPreferredVideoSource`'s bypass was **deleted** — it fed `source[src]` only. 32 → 31.
- `document-detail`, `tasks-page` and the Satori `case-file` forward their raw object URL; each had
  it already, as a private field, and now holds it in a `signal` per the repo's own convention.
- `AttachmentPreviewData` gained `ownsRawUrl: boolean`. `rawUrl` was doing double duty as both "the
  URL to bind" and "the URL to revoke", and `previewMainBlob` passed `''` to mean "do not revoke",
  which also starved `<source [src]>` of the value it needed. Ownership is now stated separately, so
  the dialog still never revokes a URL the page behind it is using.

### Verification

`BETA_SKIP_CODE_SCANNING=1 npm run beta:gate` → **19 of 19 green**, on Node 20.

Two honest caveats:

- **`code-scanning` was skipped**, not passed. It needs `gh` plus a pushed ref, and it fails closed
  on an unanalysed branch by design. It asserts nothing here.
- **`api-surface` failed twice and was not overridden silently either time.** Both reshapes are
  customer-visible and both were accepted deliberately. `docs/api/platform.api.md` records them.
  **Together they are a breaking type change and want a major version:**

  | Export                                                 | Before                                 | After                                    |
  | ------------------------------------------------------ | -------------------------------------- | ---------------------------------------- |
  | `DocumentViewerComponent.rawBlobUrl`                   | —                                      | `InputSignal<string \| null>` (additive) |
  | `DocumentViewerComponent.posterUrl`                    | `InputSignal<SafeResourceUrl \| null>` | `InputSignal<string \| null>`            |
  | `VideoSource.url`                                      | `SafeResourceUrl`                      | `string`                                 |
  | `ARENDER_CONFIG`                                       | `InjectionToken<ARenderConfig>`        | `InjectionToken<ARenderConfig \| null>`  |
  | `ARenderService.getPreviewerUrl`                       | `Observable<string>`                   | `Observable<string \| null>`             |
  | `ARenderService.getDiffUrl`                            | `Observable<string>`                   | `Observable<string \| null>`             |
  | `navigableUrlOrNull`, `originOf`, `NavigableUrlPolicy` | —                                      | added (non-breaking)                     |

  In every case the old signature described behaviour the code did not have: the `Safe*` types could
  not work in a `NONE` context and their inner string cannot be read back out, the token could
  already hold `null`, and the two methods could already throw instead of returning a string. No
  working consumer can have depended on them.

New tests read the rendered DOM attribute rather than a component flag: 4 in
`document-viewer.component.spec.ts` and 4 in `attachment-preview-dialog.spec.ts`, each asserting the
attribute equals the raw URL _and_ does not contain `SafeValue must use`. Each was confirmed to fail
when its fix is reverted.

**A trap worth recording for whoever picks this up:** on Node 25, `npx nx test document-detail`
reports **71 failures** with `SecurityError: Cannot initialize local storage`. They are entirely the
wrong-runtime symptom `CLAUDE.md` warns about; on Node 20 the same suite is 540/540 green. Also
`npm run beta:gate` **exits 0 even when its verdict is FAIL** — read the verdict line, not `$?`.

---

---

## 1. How the list was obtained, and how to reproduce it

The SonarQube MCP server returned `Not authorized` for this project, so the list came from the public
REST API. The project is world-readable, so no token is needed to reproduce:

```bash
curl -s 'https://sonarcloud.io/api/issues/search?componentKeys=nuxeo_agentic-ui-poc&impactSoftwareQualities=SECURITY&issueStatuses=OPEN,CONFIRMED&ps=500' \
  | jq -r '.issues[] | [.rule, .severity, (.component | sub("^nuxeo_agentic-ui-poc:";"")), .line, .key] | @tsv'
```

Two facts worth recording before anything else:

- **Security hotspots: zero.** `GET /api/hotspots/search?projectKey=…&status=TO_REVIEW` returns
  `total: 0`. Everything below is classified as a `VULNERABILITY` issue, so it is resolved either by
  changing the code or by an explicit **Accepted / Won't fix** transition with a written
  justification — not by the hotspot review workflow.
- **All 34 issues come from three rules**, and 32 of them are the same rule.

| Rule               | Sonar severity | Count | Message                                                               |
| ------------------ | -------------- | ----- | --------------------------------------------------------------------- |
| `typescript:S6268` | BLOCKER        | 32    | Make sure disabling Angular built-in sanitization is safe here.       |
| `typescript:S5332` | MINOR          | 1     | Using http protocol is insecure. Use https instead.                   |
| `typescript:S2245` | MAJOR          | 1     | Make sure that using this pseudorandom number generator is safe here. |

`S6268` is a "make sure" rule: it fires on every `DomSanitizer.bypassSecurityTrust*` call and asks a
human to justify it. It cannot tell a bypass of a locally-created `blob:` URL from a bypass of an
attacker-controlled string. That is why the work below is mostly _removing bypasses that were never
needed_ and _concentrating the ones that are needed into a small number of audited places_ — not
sprinkling suppressions.

---

## 2. Verified facts about Angular's sanitizer (established first-hand, not from memory)

Everything in section 4 depends on which `SecurityContext` each binding lands in, and on what Angular
actually does with a `Safe*` value in each one. Both were established against the installed
`@angular/core@20.3.27` and `@angular/compiler@20.3.27`, not recalled.

**Still valid at 20.3.31, and checked rather than assumed.** The framework has since moved to
20.3.31 to clear two advisories, one of which is a **sanitization bypass in `@angular/core` and
`@angular/compiler`** — that is, a fix to the very component these facts describe, so it is exactly
the kind of change that could have invalidated them. It did not: `angular-security-context.spec.ts`
pins each of these contexts by observation rather than by assertion about the version, and it passes
under 20.3.31. The version numbers above are left as the provenance of the original reading, not
updated, because they record which source was actually opened.

**Fact 1 — the URL allow-pattern accepts `blob:`.**
`node_modules/@angular/core/fesm2022/debug_node.mjs:5550`:

```js
const SAFE_URL_PATTERN = /^(?!javascript:)(?:[a-z0-9+.-]+:|[^&:\/?#]*(?:[\/?#]|$))/i;
```

`blob:http://localhost:4200/…` matches the `[a-z0-9+.-]+:` branch, so a raw object-URL string passes
`SecurityContext.URL` untouched. **No bypass is required to put an object URL in `img[src]`.**

**Fact 2 — the DOM security schema.**
`node_modules/@angular/compiler/fesm2022/compiler.mjs:448–511`. Only these are URL or resource-URL
contexts; everything else is `SecurityContext.NONE`, meaning _no sanitizer runs at all_:

| Context        | Members relevant here                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| `URL`          | `img[src]`, `video[src]`, `a[href]`, `area[href]`, `form[action]`, `*[formAction]`    |
| `RESOURCE_URL` | `iframe[src]`, `embed[src]`, `frame[src]`, `object[data]`, `base[href]`, `link[href]` |
| `HTML`         | `*[innerHTML]`, `*[outerHTML]`, `iframe[srcdoc]`                                      |
| **`NONE`**     | **`source[src]`, `audio[src]`, `video[poster]`**                                      |

**Fact 3 — a `Safe*` value is only unwrapped when a sanitizer runs.**
`unwrapSafeValue` appears in the runtime only inside the five sanitizer functions and in the styling
path. There is no unwrap in the plain DOM-property write path, so a `Safe*` object bound into a
`NONE` context is assigned to the DOM property and coerced by `toString()`.

This was confirmed by rendering a real `bypassSecurityTrustResourceUrl('blob:http://localhost:4200/abc-123')`
into each context in a throwaway TestBed spec (`nx test ui`, Node 20) and reading back the DOM
attribute. The spec has been deleted; the results are the load-bearing part:

| Binding         | Rendered `src` / `poster`                                  |
| --------------- | ---------------------------------------------------------- |
| `img[src]`      | `blob:http://localhost:4200/abc-123` ✅                    |
| `video[src]`    | `blob:http://localhost:4200/abc-123` ✅                    |
| `iframe[src]`   | `blob:http://localhost:4200/abc-123` ✅                    |
| `audio[src]`    | `SafeValue must use [property]=binding: blob:… (see …)` ❌ |
| `source[src]`   | `SafeValue must use [property]=binding: blob:… (see …)` ❌ |
| `video[poster]` | `SafeValue must use [property]=binding: blob:… (see …)` ❌ |

A second run confirmed that a **raw string** renders correctly in all of `video[src]`, `audio[src]`
and `source[src]`, and that a `SafeUrl` (not `SafeResourceUrl`) renders correctly in `img[src]` —
Angular's `allowSanitizationBypassAndThrow` has an explicit carve-out accepting a resource-URL where
a URL is required, which is why the existing `SafeResourceUrl`-in-`img` bindings work.

**Fact 4 — `iframe[src]` cannot be fed a raw string.** `RESOURCE_URL` sanitization throws unless the
value carries the resource-URL bypass marker. Every bypass feeding an `iframe` is therefore
structurally required and can only be _justified_, never removed.

### Consequence: two live defects, independent of Sonar

Fact 3 means these are broken **today**, and neither is covered by a test:

1. **`libs/shared/ui/document-viewer.component.html:41` and `:50`** — `<source [src]="blobUrl()">`
   and `<audio [src]="blobUrl()">` receive the `SafeResourceUrl` from
   `document-detail.ts:2670`. Audio playback, and the single-source video fallback, write the
   `"SafeValue must use [property]=binding: …"` string into `src`.
2. **`libs/shared/ui/document-viewer.component.html:38`** — `<source [src]="src.url">` receives the
   `SafeResourceUrl` from `document-detail.ts:2216`, so the transcoded-video source list is broken
   the same way.
3. **`attachment-preview-dialog.ts:40` and `:44`** — the same pattern, so video and audio
   _attachment_ previews are broken. The dialog's spec asserts `isVideo` / `isAudio` flags but never
   reads the rendered `src`, which is why it passes.

`video[poster]` is the same shape but dormant: `document-detail.ts` only ever calls
`posterUrl.set(null)` (line 2575), so nothing reaches that binding.

**This is the strongest argument for the plan in section 4.** Two of these three defects disappear as
a side effect of removing bypasses that were never needed. Fixing S6268 correctly makes the app work
_better_, not merely quieter.

---

## 3. Categorisation

The 32 `S6268` sites are not 32 problems. They are five patterns.

| Cat.  | Pattern                                          | Sites | Real risk today                       | Fix type                                       |
| ----- | ------------------------------------------------ | ----- | ------------------------------------- | ---------------------------------------------- |
| **A** | Locally-created object URL → `img[src]` only     | 14    | **None.** The bypass is redundant.    | Delete the bypass                              |
| **B** | Locally-created object URL → `iframe` (or mixed) | 8     | **None**, but the bypass is required  | Centralise into one audited helper             |
| **C** | Server- or config-supplied URL → `iframe`        | 2     | **Real.** Trust follows configuration | Validate, then bypass                          |
| **D** | Already-sanitised HTML → `innerHTML`             | 8     | **None**, but safety is a _pairing_   | Centralise + strengthen the existing guardrail |
| **E** | Not sanitiser-related (`S5332`, `S2245`)         | 2     | One real config defect                | Independent, trivial                           |

Net effect if executed in full: **34 → 3 flagged sites** (one per category B, C, D), each a single
place with a written justification, resolved in SonarCloud as _Accepted_ with a comment pointing at
this document and at the gate that keeps it true.

---

## 4. Category detail and recommended fix

### Category A — 14 redundant bypasses (delete them)

Every one of these creates an object URL from a blob **we just fetched ourselves**, wraps it, and
binds it to `<img [src]>` and nothing else. By Fact 1 the wrap changes nothing; by Fact 3 it makes
the underlying string unreadable, which is the sole reason the `thumbnailBlobUrls[]` shadow arrays
exist — several files carry a comment saying exactly that.

| #   | Site                                                                                      | Signal                              | Sonar key              |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------- |
| 1   | `libs/features/browse/src/lib/browse/browse.ts:878`                                       | `thumbnailMap`                      | `AaB8mU_GUIm8e9uDh3q8` |
| 2   | `libs/features/collections/src/lib/collection-detail/collection-detail.ts:360`            | `thumbnailMap`                      | `AaB8mVDDUIm8e9uDh3sk` |
| 3   | `libs/features/search/src/lib/search/search.ts:1058`                                      | `thumbnailMap`                      | `AaB8mVBoUIm8e9uDh3sO` |
| 4   | `libs/features/search/src/lib/search-queue/search-queue.component.ts:75`                  | `thumbnailMap`                      | `AaB8mVCwUIm8e9uDh3sh` |
| 5   | `libs/features/assets/src/lib/assets-queue/assets-queue.component.ts:65`                  | `thumbnailMap`                      | `AaB8mU8yUIm8e9uDh3qX` |
| 6   | `libs/features/assets/src/lib/asset-search-results/asset-search-results.component.ts:928` | `thumbnailMap`                      | `AaB8mU8bUIm8e9uDh3qS` |
| 7   | `libs/features/trash/src/lib/trash/trash.component.ts:633`                                | `thumbnailMap` + `resultThumbnails` | `AaB8mU-IUIm8e9uDh3qw` |
| 8   | `libs/features/tasks/src/lib/task-detail/task-detail.component.ts:336`                    | `docPreviewUrl`                     | `AaB8mU5BUIm8e9uDh3og` |
| 9   | `libs/features/document-detail/src/lib/note-editor/note-image-picker-dialog.ts:264`       | `thumbnailMap`                      | `AaB8mU7tUIm8e9uDh3qA` |
| 10  | `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.ts:321`                         | `thumbnailMap`                      | `AaB8mVSkUIm8e9uDh3wd` |
| 11  | `apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.ts:1184`                     | `thumbnailMap` (clipboard)          | `AaB8mVRqUIm8e9uDh3wE` |
| 12  | `apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.ts:1327`                     | `thumbnailMap` (favourites)         | `AaB8mVRqUIm8e9uDh3wF` |
| 13  | `libs/features/document-detail/src/lib/document-detail/document-detail.ts:2325`           | `storyboard[].thumbnailUrl`         | `AaB8mU6TUIm8e9uDh3pC` |
| 14  | `libs/features/document-detail/src/lib/document-detail/document-detail.ts:2446`           | `storyboard[].thumbnailUrl`         | `AaB8mU6TUIm8e9uDh3pE` |

**Recommended fix.** Drop the call and widen the type to `string`:

```ts
// before
[doc.uid]: this.sanitizer.bypassSecurityTrustUrl(url),
// after — Angular's URL sanitizer accepts blob:, and the raw string stays readable
[doc.uid]: url,
```

`readonly thumbnailMap = signal<Record<string, SafeUrl>>({})` becomes `Record<string, string>`, and
the `DomSanitizer` injection goes with it wherever it becomes unused (an explicit rule in
`.cursor/rules/angular-conventions.mdc`).

**Blast radius — this is the one thing to get right.** These maps do not all stop at the component.
Three shared consumers are typed on the value and must change in the same commit:

- `SelectionService` preview map → `libs/shared/ui/selection-topbar.component.html:66`
- `TrashFilterService.resultThumbnails` → `trash-filters-drawer.component.html:205`
- `libs/shared/adf-hx-bridge` → `hxp-document-cards.component.html:15`,
  `hxp-browse-trash.component.html:28`

`adf-hx-bridge` is public API surface. Confirm with `npm run beta:api` that widening `SafeUrl` to
`string` there is an allowed change, or keep the bridge's signature and convert at its boundary.

**Follow-on cleanup, once the raw string is readable again.** The `thumbnailBlobUrls: string[]`
shadow arrays in `browse.ts`, `collection-detail.ts`, `dashboard-page.component.ts` and
`nav-drawer.component.ts` exist _only_ because `SafeUrl` is opaque. They can go, with revocation
derived from the map. **Do this as a separate PR.** `review-guardrails.mjs:356` fails any file that
calls `URL.createObjectURL` without a `URL.revokeObjectURL` in the same file, and that gate must stay
green throughout — a leak here is a worse regression than the Sonar finding.

**Risk:** low. **Verification:** section 6, group A.

---

### Category B — 8 required bypasses (centralise into one helper)

These feed `iframe[src]`, so by Fact 4 the bypass cannot be removed. The input is always a `blob:`
URL this code created from a blob it fetched over the authenticated `HttpClient`.

| #   | Site                                            | Consumer                                                          | Sonar key              |
| --- | ----------------------------------------------- | ----------------------------------------------------------------- | ---------------------- |
| 1   | `document-detail.ts:2670` (`setBlobUrl`)        | `document-viewer` — img / video / **audio** / **source** / iframe | `AaB8mU6TUIm8e9uDh3pL` |
| 2   | `document-detail.ts:2216` (video source list)   | `document-viewer` — **`source[src]`**                             | `AaB8mU6TUIm8e9uDh3pB` |
| 3   | `document-detail.ts:3424` (`previewMainBlob`)   | `attachment-preview-dialog` — img / iframe / **source**           | `AaB8mU6TUIm8e9uDh3pP` |
| 4   | `document-detail.ts:3868` (`previewAttachment`) | same dialog                                                       | `AaB8mU6TUIm8e9uDh3pS` |
| 5   | `tasks-page.component.ts:669`                   | `document-viewer` via `previewUrl()`                              | `AaB8mU5eUIm8e9uDh3ol` |
| 6   | `apps/nuxeo-satori-template/…/case-file.ts:191` | `document-viewer`                                                 | `AaB8mVTiUIm8e9uDh3wv` |
| 7   | `kd-citation-dialog.ts:253` (`setBlobPreview`)  | iframe (pdf) or img (image)                                       | `AaB8mU9GUIm8e9uDh3qa` |
| 8   | `kd-citation-dialog.ts:265` (`updatePdfPage`)   | iframe                                                            | `AaB8mU9GUIm8e9uDh3qc` |

**Recommended fix — two parts, and part 2 is a bug fix, not cosmetics.**

_Part 1: one audited factory._ Add to `libs/shared/nuxeo-client` (or a small `libs/shared/security`):

```ts
/**
 * The single place in the application permitted to bypass RESOURCE_URL sanitization.
 * Callers must pass a URL from `URL.createObjectURL` on a blob fetched over HttpClient.
 * The `blob:` guard is what makes the bypass narrow: a same-origin, opaque, non-navigable
 * URL minted by this document, not a string that reached us from anywhere else.
 */
export function trustObjectUrl(sanitizer: DomSanitizer, objectUrl: string): SafeResourceUrl {
  if (!objectUrl.startsWith('blob:')) {
    throw new Error(`trustObjectUrl requires a blob: URL, received "${objectUrl.slice(0, 32)}…"`);
  }
  return sanitizer.bypassSecurityTrustResourceUrl(objectUrl);
}
```

Eight call sites become eight calls to this, and Sonar sees one `S6268` — resolvable as _Accepted_
because a reviewer can check the whole justification in one place. Include a unit test for the
rejection path (`javascript:`, `http://evil`, `''`); the repo requires an error-path test for every
new method, and an unexercised `throw` is not a control.

_Part 2: stop sending `Safe*` values into `NONE` contexts._ Independent of Sonar, and the reason the
audio and transcoded-video paths are broken. Carry the raw string alongside the safe value and bind
the raw one where no sanitizer runs:

- `document-viewer.component.ts` — add `rawBlobUrl = input<string | null>(null)`; bind it in
  `<source [src]>` (line 41), `<audio [src]>` (line 50) and, if it is ever populated,
  `<video [poster]>` (line 35). Change `VideoSource.url` to `string`.
- `attachment-preview-dialog.ts` — the `AttachmentPreviewData` already carries `rawUrl`; bind
  `data.rawUrl` in both `<source [src]>` bindings (lines 40, 44).

Keep `SafeResourceUrl` for `iframe[src]` and leave `img[src]` on whichever it already has.

**Risk:** medium — it touches the shared viewer used by document-detail, tasks, KD and the Satori
template. It is also the change most likely to _restore_ function. **Verification:** section 6,
group B, and it needs a test that reads the rendered attribute, not a component flag.

---

### Category C — 2 genuine trust decisions (validate, then bypass)

The only two sites where the trusted string does **not** originate in this code.

| #   | Site                                              | Source of the string                                                                                                                  | Sonar key              |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | `document-detail.ts:3458` (`arenderUrl`)          | `ArenderService.getPreviewerUrl` → `` `${cfg.viewerOrigin}/?url=…` `` where `viewerOrigin` comes from the runtime app-config manifest | `AaB8mU6TUIm8e9uDh3pQ` |
| 2   | `document-detail.ts:2561` (`loadPreviewFallback`) | `doc.contextParameters['preview'].url` from the Nuxeo REST response                                                                   | `AaB8mU6TUIm8e9uDh3pI` |

**Site 1 is the highest actual risk in the whole set.** `viewerOrigin` is read from a manifest
(`bootstrap-config.ts:343`), string-concatenated into a URL, bypassed, and navigated in an `iframe`.
A manifest that sets `viewerOrigin` to `javascript:…` turns a configuration value into script
execution in the app's origin. Per `.cursor/rules/beta-program.mdc`, that manifest is a
_customer-editable_ surface, which makes this a privilege boundary and not a theoretical one.

**Recommended fix.** Validate at the point of trust, and fail closed:

```ts
// in ArenderService, or a shared urlOrigin helper
const parsed = new URL(viewerUrl); // throws on a non-URL
if (parsed.protocol !== 'https:' && !isDevMode()) return null; // no plaintext viewer in prod
if (parsed.origin !== new URL(this.cfg.viewerOrigin).origin) return null;
```

`javascript:` URLs have no origin and fail the check; a relative or malformed value throws. Only then
call `bypassSecurityTrustResourceUrl`. **Fail closed means returning `null`**, which the template
already handles — `@if (showARenderViewer())` degrades to "Annotations are not available", the same
path taken when ARender is not deployed. (As planned, this leaned on `bootstrap-config.ts` refusing
half an ARender configuration. **Superseded by NXSAT-279:** only `viewerOrigin` is required there
now, which is also the only endpoint this check reads, so the check is unaffected.)

For site 2, assert the preview URL's origin equals the Nuxeo API origin (`NUXEO_API_ORIGIN`) or is
same-origin-relative, and drop the preview otherwise.

**Risk:** low functionally, high value. **Verification:** section 6, group C. The negative cases are
the point — assert that a `javascript:` and a cross-origin `viewerOrigin` are both rejected.

---

### Category D — 8 sanitised-HTML bypasses (centralise; the pairing already has a gate)

Every one of these is currently safe, and the pairing is enforced: a `bypassSecurityTrustHtml` with no
`DOMPurify.sanitize()` / `escapeHtml()` beside it fails the gate. The stake is that `note:note` is
authored by any user with write access, so an unpaired render path is stored XSS, and
`.ai/state/supply-chain-allowlist.json` accepts a known Quill XSS advisory _on the grounds that_
every render path sanitises.

**Updated 2026-09-11, and scoped: only the enforcement claim above was corrected, not the table
below.** This section named `scripts/review-guardrails.mjs:909–969` as the enforcing check. That is
stale twice over. The check moved to `sanitizer-audit.mjs` check 5, which walks the AST rather than
matching a regex; `review-guardrails.mjs:909` is now the comment recording its removal. And the Quill
acceptance does **not** rest on it alone — check 5 fires on the presence of `bypassSecurityTrustHtml`,
so it cannot see `readQuillHtml()`, which sanitises and returns a plain string on the path that saves
the note. That half is covered by a test in `note-editor.spec.ts`.

The table below is the **as-analysed inventory**, kept as the record the Sonar keys were raised
against; its line numbers have drifted since and are not maintained. The two that get cited elsewhere
are now `document-detail.ts:1862` (row 1) and `:3394` (row 2), and row 4's `htmlReadonlyView` is now
`note-editor.ts:118-120`. Row 4 is the one that matters for the Quill advisory: rows 1 and 2 are the
**markdown** branches, so they never render the `text/html` a Quill note produces. That distinction
was got wrong in the supply-chain allowlist and corrected on the same date; if you cite a row from
here, check which content type it handles first.

| #   | Site                                           | Sanitiser in the same member                              | Sonar key              |
| --- | ---------------------------------------------- | --------------------------------------------------------- | ---------------------- |
| 1   | `document-detail.ts:1842` (load markdown note) | `DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] })`       | `AaB8mU6TUIm8e9uDh3o_` |
| 2   | `document-detail.ts:3327` (save markdown note) | same                                                      | `AaB8mU6TUIm8e9uDh3pO` |
| 3   | `note-editor.ts:113` (`markdownHtml`)          | `DOMPurify.sanitize(raw, { ADD_ATTR: ['target','rel'] })` | `AaB8mU7aUIm8e9uDh3p6` |
| 4   | `note-editor.ts:119` (`htmlReadonlyView`)      | same                                                      | `AaB8mU7aUIm8e9uDh3p7` |
| 5   | `kd-citation-dialog.ts:284`                    | `escapeHtml` (escapes `& < > " '`)                        | `AaB8mU9GUIm8e9uDh3qd` |
| 6   | `kd-citation-dialog.ts:289`                    | same                                                      | `AaB8mU9GUIm8e9uDh3qe` |
| 7   | `kd-citation-dialog.ts:295`                    | every segment escaped, only `<mark>` added                | `AaB8mU9GUIm8e9uDh3qf` |
| 8   | `ai-markdown.pipe.ts:29`                       | `escapeHtml` then regex-built tags                        | `AaB8mVTDUIm8e9uDh3wo` |

**Recommended fix.** A shared `renderTrustedHtml(sanitizer, dirty, opts)` in `libs/shared/ui` that
runs `DOMPurify.sanitize` and then the single bypass. Sites 1–4 collapse into it directly. Sites 5–7
keep their escape-and-build logic but pass the result through the same helper, which is
belt-and-braces rather than redundant: the helper is what a reviewer audits.

**Site 8 deserves a real change, not just a move.** `ai-markdown.pipe.ts` escapes `& < > "` — note
`'` is _not_ escaped — and then builds `<strong>`, `<li value="N">`, `<ol>`, `<ul>` and `<br>` by
regex. It is currently safe: after escaping, no `<` can come from input, so no attacker tag can
appear, and the only interpolated attribute is `value="$1"` where `$1` is `(\d+)`. But that safety
rests on six chained regexes staying exactly as they are, which is not a property anything checks.
Route its output through `DOMPurify.sanitize` with an allowlist of the six tags it generates. The
input is AI-generated text derived from document content, so it is not trusted.

**Risk:** low. **Verification:** section 6, group D. Extend the existing guardrail rather than
replacing it, and keep it able to see through the helper (assert on the helper, not on
`DOMPurify.sanitize` appearing at the call site).

---

### Category E — the two non-sanitiser issues

**`S5332` — `apps/nuxeo-ui/src/app/config/provide-app-config.ts:87` (`AaB8mVSHUIm8e9uDh3wN`).**
Sonar flags the `http://` literal. Reading it in context, the real problem is larger than the scheme:

```ts
const configured = inject(AppConfigService).bootstrap().integrations.arender;
return (
  configured ?? {
    viewerOrigin: 'http://localhost:8180',
    nuxeoInternalUrl: 'http://nuxeo-auth-proxy/nuxeo',
  }
);
```

`bootstrap-config.ts:196` defaults `integrations.arender` to `null`, and **no manifest in the
repository sets it** (`rg -il arender --glob '*.json'` → nothing). So this fallback is not a dev
convenience that production overrides; it is what production uses unless a server-side manifest
supplies the value. A shipped build points the annotation viewer at the _user's own_ `localhost:8180`.
It is also a hardcoded-config-default of exactly the kind `.cursor/rules/security.mdc` prohibits.

Recommended fix, in order of preference:

1. Return `null` when unconfigured and let the existing "annotations not available" path handle it;
   supply the two values from the dev app-config manifest so local ARender keeps working.
2. If a compiled default must stay, gate it behind `isDevMode()` so it cannot reach a production
   bundle, and pair it with the origin validation from Category C site 1.

Marking this MINOR issue _Accepted_ is the wrong outcome — it is pointing at something real.

**`S2245` — `libs/shared/kd-client/src/lib/kd-client.service.ts:345` (`AaB8mVPyUIm8e9uDh3vb`).**

```ts
`kd-${request.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```

A client-side correlation id for a KD answer with no server-side `questionId`. It is not a token, not
a nonce and grants nothing, so there is no vulnerability — but it costs nothing to remove the finding
and `Math.random` collides more often than the code implies (six base-36 chars).

Recommended fix: `crypto.randomUUID()`, available in every supported browser and in Node 20, so
Vitest/jsdom is fine. One line, no behavioural change beyond id shape. If any test asserts the id
format, update it.

---

## 5. The AI harness

The point of the harness is not to find these 34 — Sonar already did. It is to make the _reasoning_
in section 4 durable, so a future agent cannot silently undo it. The repo has learned this lesson
already; `review-guardrails.mjs` exists because "safety is a pairing, not a property of either half,
and nothing enforced it".

Build it as one new gate script in the existing shape, not a new framework.

### 5.1 `scripts/beta-harness/sanitizer-audit.mjs` — the gate

Registered in `scripts/beta-harness/verify-gate.mjs` `ALL_GATES` next to `guardrails` (cheap, no
network, runs before `lint`), and added to `npm run review:preflight`.

It enumerates every `bypassSecurityTrust*` call under `apps/` and `libs/` (excluding `*.spec.ts`) and
fails on:

1. **An unregistered bypass.** Every call must have an entry in
   `.ai/state/sanitizer-allowlist.json`. A new bypass is a red build until someone writes down why.
2. **A stale entry.** An allowlist entry whose file or enclosing member no longer exists — otherwise
   the allowlist rots into a list of assertions about code that is gone.
3. **A Category-A regression.** `bypassSecurityTrustUrl` / `…ResourceUrl` reappearing on a value
   that is a `URL.createObjectURL` result in the same member, outside `trustObjectUrl`.
4. **A `Safe*` value in a `NONE` context.** The template half. For each `.html`, find
   `[src]` on `source` / `audio`, `[poster]` on `video`, and fail if the bound expression resolves to
   a member typed `Safe*`. Regex-and-heuristic is acceptable here _provided_ it is paired with 5.3 —
   a template check that cannot see through an alias is a check that will be trusted wrongly.
5. **Category D pairing** — move the existing `review-guardrails.mjs:909` check in, taught about
   `renderTrustedHtml`.

Key each entry by `file` + enclosing member + category, never by line number: line numbers churn on
every edit above them and would make the allowlist noise.

```jsonc
// .ai/state/sanitizer-allowlist.json
{
  "libs/shared/security/src/lib/trust-object-url.ts": [
    {
      "member": "trustObjectUrl",
      "category": "B",
      "sonarKey": "…",
      "justification": "Only bypass of RESOURCE_URL in the app. Guarded to blob: URLs minted by this document from HttpClient-fetched blobs. Rejection path tested in trust-object-url.spec.ts.",
      "boundTo": ["iframe[src]"],
    },
  ],
}
```

### 5.2 Prove the gate fails before trusting it

Non-negotiable, and the most expensive lesson in `CLAUDE.md`: _a gate is not evidence until you have
seen it fail on purpose._ Three gates in this programme were green while the thing they guarded was
broken. For each of the five checks above, break it deliberately, capture the red output, restore,
and record both in the PR. A check whose failure has never been observed is decoration.

The natural test case is already available: check 4, run against `main` **before** any Category B
fix, must go red on `document-viewer.component.html:38/41/50` and
`attachment-preview-dialog.ts:40/44`. If it does not, check 4 is wrong. That is a genuinely
independent validation and it costs nothing — do it first.

### 5.3 A rendered-attribute test, because the static check cannot be sufficient

Add to `libs/shared/ui` and to the attachment dialog: render each media branch with a **real**
`DomSanitizer` value and assert the DOM attribute:

```ts
expect(el.querySelector('source')!.getAttribute('src')).toBe(rawUrl);
expect(el.querySelector('source')!.getAttribute('src')).not.toContain('SafeValue must use');
```

Two existing specs illustrate why both halves are needed. `document-viewer.dispatch.spec.ts:36`
substitutes `{ toString: () => value }` for a real safe value — a fake that behaves _correctly_ in
precisely the context where the real one breaks. `attachment-preview-dialog.spec.ts` does use a real
sanitizer value, on purpose and with a comment saying why, but only ever asserts `isVideo` /
`isAudio` flags, never the rendered `src`. Between them they render every broken binding and catch
none of them.

### 5.4 Agent-facing rules

The harness is only half of it; the other half is stopping the pattern being reintroduced by an agent
that has not read this document. Add to `.cursor/rules/security.mdc`:

- Never call `DomSanitizer.bypassSecurityTrust*` directly. Use `trustObjectUrl` (resource URLs) or
  `renderTrustedHtml` (HTML). A new bypass needs a `.ai/state/sanitizer-allowlist.json` entry and a
  reviewer.
- An object URL bound only to `img[src]` needs no bypass — Angular's URL sanitizer accepts `blob:`.
- `source[src]`, `audio[src]` and `video[poster]` are `SecurityContext.NONE`. Bind the **raw string**
  there; a `Safe*` value stringifies to `"SafeValue must use [property]=binding: …"` and silently
  breaks playback.

---

## 6. Verification — "must not break the application"

Sonar-clean and functionally intact are different claims and need different evidence. Nothing here is
complete on the strength of a green gate alone.

### Gates, on every commit

```bash
npm run beta:gate -- --gates guardrails,lint          # fast inner loop
npm run beta:gate                                     # full, before every push
```

Two traps from `CLAUDE.md` that apply directly to this work:

- **`test` does not typecheck.** Vitest strips types through esbuild. Category A changes signal types
  across four shared consumers, so the errors will be `TS` errors that only `build`, `typecheck` and
  `spec-types` catch — and those run last. A green `test` here means nothing.
- **Nothing but the `lockfile` gate reads `package-lock.json`.** No dependency changes are expected;
  if one appears, do not run a bare `npm install`.

Also relevant: `beta:api` (Category A touches `adf-hx-bridge` public API), `beta:coverage` (new
helpers need tests), `a11y` (Category B edits templates).

### Per-category functional evidence

Capture with the Playwright phase harness (`capture-phase-evidence` skill), before **and** after, in
one run so the pair is comparable. Every step asserts something and ends with
`expectNoConsoleErrors()`; a screenshot with no assertion behind it proves only that a page rendered.

| Group | Surfaces to exercise                                                                                                                                                                                                        | Assertion, not just a screenshot                                                                                                                                                                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | `/#/browse` (grid, list, card), `/#/search` (3 layouts), `/#/documents`, `/#/trash` (3 layouts) + filter drawer, `/#/collections`, dashboard (3 rails), nav drawer (clipboard + favourites), task detail, note image picker | For each, `img.src` starts with `blob:`; `naturalWidth > 0` (an unwrapped-but-broken URL still yields a `blob:` attribute — decoded pixels are the real proof); thumbnail count equals row count                                                         |
| **A** | Same pages, then navigate away                                                                                                                                                                                              | Object URLs revoked — no growth in `performance.memory` proxies; `review-guardrails` blob check still green                                                                                                                                              |
| **B** | doc-detail for image / pdf / **audio** / **video with transcodes** / markdown / html / text; attachment preview for each; `/#/tasks` preview; KD citation dialog pdf + image + page change; Satori template case file       | `iframe.src` / `video.currentSrc` / `audio.currentSrc` start with `blob:` and **do not contain `SafeValue must use`**; `HTMLMediaElement.readyState >= 1`. Audio and transcoded video are expected to go **from broken to working** — capture the before |
| **C** | doc-detail Annotations tab with ARender up; with ARender down; with `viewerOrigin` set to `javascript:alert(1)`; with a cross-origin `viewerOrigin`                                                                         | Valid config → iframe loads. All three invalid → the "Annotations are not available" placeholder, **no iframe in the DOM**, no navigation attempt in the network log                                                                                     |
| **D** | markdown note render + save round-trip; html note read-only; KD citation excerpt highlight; AI chat panel markdown                                                                                                          | A note body containing `<img src=x onerror=alert(1)>`, `<script>`, `javascript:` href and `'` renders as inert text; `<mark>` still appears for a legitimate excerpt; no `onerror` attribute survives in the DOM                                         |
| **E** | App boot with `integrations.arender` absent, present, and malformed                                                                                                                                                         | Unconfigured → no ARender affordance and no `http://localhost:8180` anywhere in the built bundle (`rg` the `dist/` output, not the source). KD answer ids unique across 1 000 calls                                                                      |

### Sequencing

Five PRs, smallest blast radius first, each independently green and revertable. Do not batch.

| PR  | Contents                                                                                                                                                      | Why here                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Category E (`crypto.randomUUID`, ARender config default) + the `S5332`/`S2245` half of the harness                                                            | Two lines of behaviour change; proves the gate wiring on the cheapest possible case                                                              |
| 2   | Harness: `sanitizer-audit.mjs` + allowlist recording **today's** 32 sites unchanged + the 5.2 break-it-on-purpose evidence + the 5.3 rendered-attribute tests | **Zero behaviour change, and it goes red on the section 2 defects before any fix.** That red is the independent proof that checks 4 and 5.3 work |
| 3   | Category D — `renderTrustedHtml`, `ai-markdown.pipe` through DOMPurify, guardrail moved                                                                       | Self-contained; the pairing gate already covers it                                                                                               |
| 4   | Category B — `trustObjectUrl` + the `NONE`-context bug fix                                                                                                    | Largest functional change; lands with PR 2's tests already in place to prove it                                                                  |
| 5   | Category A — delete 14 bypasses, widen types across the four shared consumers                                                                                 | Widest type churn; benefits from everything above being settled. Shadow-array cleanup is a **separate** PR 6                                     |

At the end, transition the three remaining `S6268` issues (one per category B, C, D) to _Accepted_ in
SonarCloud with a comment naming this document and the allowlist entry. The `change_sonar_issue_status`
MCP tool is the mechanism, but that server currently returns `Not authorized` for this project — the
token needs _Administer Issues_ on `nuxeo_agentic-ui-poc` before that step can run.

---

## 6a. The harness as built

Section 5 was the design. This is what exists, and where it differs.

```bash
npm run beta:sanitizers            # the gate
npm run beta:sanitizers-selftest   # the negative controls — prove the gate can fail. The runner
                                   # prints the three counts by kind; do not restate them here, a
                                   # hardcoded copy of that number has already gone stale twice.
npm run beta:gate -- --gates sanitizer-audit
node scripts/beta-harness/sanitizer-audit.mjs --print      # dump every bypass as JSON
node scripts/beta-harness/sanitizer-audit.mjs --only 4     # one check, for evidence capture
```

**It parses TypeScript rather than grepping it.** The first cut used regexes for "enclosing member"
and emitted 100+ findings naming `of`, `pipe`, `subscribe` and `if` as members — unreadable, and an
unreadable gate gets switched off. It now uses the compiler API (`typescript` is already a
dependency, so this cost no install). The corroboration that this was right: the AST pass finds
**exactly 32** bypass calls at exactly the line numbers in the section 4 tables, reconciling with
Sonar's 32 `S6268` findings without being told what to look for.

Check 4 is where this mattered most. Deciding whether `<source [src]="src.url">` is affected means
resolving `src` to a `@for` loop variable, the loop to `videoSources()`, that to `VideoSource[]`, the
element to `VideoSource`, and finally `.url` — four hops. Section 5.1 warned that "a template check
that cannot see through an alias is a check that will be trusted wrongly".

**It was trusted wrongly, for five rounds.** The resolver was syntactic — annotation text,
declarations gathered by name, alias expansion, no `TypeChecker` — so `type MediaUrl = SafeResourceUrl`
reduced to the text `MediaUrl` and passed, as did an imported interface, a _lowercase_ alias and
`input.required<T>()`. Each round closed one spelling and the next round found another, because "does
this text look like a Safe type" is not the question the check needs answered.

**Check 4 now asks the compiler.** `createTypeProgram` builds a real `ts.Program` over `apps/` and
`libs/`, and `resolveTemplateType` resolves each binding through its `TypeChecker`
(`sanitizer-audit.mjs`, the "the type checker" section). Aliases, imports, re-exports, generics and
inference all reduce identically and by construction, which retires that class of evasion rather than
deflecting its next instance. It costs about 2.5s over ~350 files, against a gate that was 0.7s. The
syntactic resolver was **deleted**, not left dormant: keeping the superseded security implementation
beside the live one is how the wrong half ends up maintained, and its comments already contradicted
what ran.

**Templates are parsed with Angular's own `parseTemplate`, for the same reason.** The scanner was a
regex asking for `[src]="…"`, which matched one spelling of a binding. `bind-src="…"` is the canonical
form the bracket syntax desugars to and reaches the identical `SecurityContext.NONE` property;
`[attr.src]="…"` reaches the same attribute. `<audio bind-src="blobUrl()">` therefore bound a
`SafeResourceUrl` into a NONE context while check 4 stayed green — verified against the pre-fix script
on this repository. Enumerating the bindings the compiler found closes the class instead of adding an
alternation. A template that will not parse is **reported**, since no bindings and unreadable are
otherwise indistinguishable.

**And template discovery no longer depends on how the decorator is spelled.** It matched the
decorator's callee text against `Component`, which was fail-open on every other spelling:
`import { Component as NgComponent }; @NgComponent({ … })` produced no template entry at all, so
check 4 returned `PASS` on a `SafeResourceUrl` bound to `video[poster]`, and `@ngCore.Component({ … })`
was invisible the same way. Resolving the identifier to Angular's `Component` through the checker
closes both and leaves the hole one step further out — a decorator that merely _refers_ to `Component`
resolves to the referrer. So discovery does not establish the decorator's identity at all:
`template`/`templateUrl` inside a decorator argument is the evidence, and any decorator qualifies.
That is inclusive rather than fail-open, on the asymmetry check 4 trades on everywhere else — a
template scanned that nothing compiles costs at most one finding on a dormant binding, and there is
no import left to rename to switch the check off. Establishing identity is the right tool for
check 5, where the question is "is this the reviewed sanitiser"; it is the wrong tool here.

**And it reads the template's _value_, not only a literal.** `templatesFor` accepted a literal
`template`/`templateUrl` and nothing else, while Angular's compiler statically evaluates more — so
moving a template to a module constant removed the component from the audit entirely and returned
check 4 to `PASS` on a `SafeResourceUrl` bound to `video[poster]`. The value now resolves through the
checker as a string-literal type, covering a `const`, an `as const`, and an imported or re-exported
constant; a value that does not resolve is **reported**, so a template the audit could not read is
never mistaken for a component that has none.

**Discovery was fail-open four times, and that is the pattern worth remembering.** The binding
syntax, the decorator, the template value, and finally the metadata _key_ — `n.name.getText()`
returns `'templateUrl'` with the quotes, so a quoted key skipped the component outright. Each time,
discovery recognised the shape this repository happens to use and treated everything else as "no
template here", which is indistinguishable in the output from "no defect here". Each was closed by
handing the question to something that already answers it properly: Angular's parser, the class the
decorator sits on, and the checker — the key now goes through `assignmentPropertyName`, the resolver
the bypass collector already uses for the same question.

**None of that is what makes check 4 trustworthy. It fails closed.** A NONE-context binding whose type
cannot be resolved is _reported_, and `any`, `unknown` and the error type count as unresolved rather
than as answers — they are the checker declining, not answering. That reverses what this section once
claimed, that where the resolver cannot tell it stays silent and "under-reports rather than crying
wolf". Silence was the defect: every documented evasion surfaced as _unresolvable_ rather than as
resolving to something benign, so under-reporting was indistinguishable from passing. With six such
bindings in the whole repository, a false positive costs one allowlist line and a false negative is a
shipped defect.

The consequence worth keeping in mind is unchanged by the checker: the guarantee rests on the
fail-closed default, not on the resolver being complete. The checker shrank the set of bindings that
must be reported; it did not change what makes the check sound.

**Additions to the design:**

- **Check 4 resolves against the component that owns the template.** It used to try every class in
  the file and keep the first that resolved the expression, which one valid file defeats: declare a
  class ahead of the component with a same-named member of a plain type and the component's own
  `SafeResourceUrl` member is never consulted. Reproduced with a `PosterDecoy` exposing
  `posterUrl(): string | null`, and the audit printed PASS on a live defect. `templatesFor` now
  carries the decorated class through.
- **The bypass collector names a member however the call spells it.** Checks 1, 3 and 5, the category
  budgets and the per-member ratchet are all driven from one list of bypass sites, so anything absent
  from that list is unregistered, unbudgeted and unchecked at once — while the allowlist header goes
  on promising that every `bypassSecurityTrust*` call appears in it. Four spellings were absent:
  `sanitizer['bypassSecurityTrustHtml'](raw)` and its template-literal form, both now read directly;
  `const M = 'bypassSecurityTrustHtml'; sanitizer[M](raw)`, resolved through the `TypeChecker` to a
  string-literal type, because a _constant_ index is the next spelling along and asking the compiler
  is what closed the equivalent class in check 4; and `{ 'bypassSecurityTrustHtml': trust }`, where a
  quoted destructured property name made the identifier-only test read the local alias instead. Each
  was verified silent first: with raw user markdown passed to it, the pre-fix gate printed
  `PASS — 31 bypass call(s), all accounted for` — the count not merely wrong but unchanged.

  Element access and computed destructuring resolve their key through **one** shared function, which
  is the durable half of this. They previously had a copy each, so teaching the element-access one to
  resolve a constant left `const key = 'bypass…' as const; const { [key]: trust } = sanitizer` open —
  the identical evasion one syntax along, found by the next review round.

  Naming cannot reach every case, so there is a backstop rather than a gap: `let key = 'bypass…'`
  widens to `string`, leaving no literal type to resolve, and an element access on a `DomSanitizer`
  whose member does not resolve is **reported**. "It would not compile" is not available as a
  defence, because `createTypeProgram` loads `tsconfig.base.json`, which sets neither `strict` nor
  `noImplicitAny` — the libraries enable `strict` in their own tsconfigs — so that index is an error
  to `nx build` and not an error to this audit's own checker.

- **Check 5's provenance walk resolves a variable by symbol, and sees every assignment.** Two
  fail-open paths, both reproduced silent on this repository with attacker-authored markdown reaching
  `bypassSecurityTrustHtml`. Sources were gathered by identifier _text_ across the whole member, so
  any same-named declaration counted: a parameter contributes no source at all, so for
  `trustShadowed(clean: string)` an inner `const clean = DOMPurify.sanitize(…)` in a branch that
  never runs was the only source collected, and "every source is sanitised" was satisfied by a value
  that never reaches the bypass. And only `EqualsToken` was recorded, so `clean += raw` was not a
  source at all. Sources now match by checker symbol, and every assignment operator counts — `+=`
  puts its right-hand side in the independent set, the same treatment `clean = clean + raw` already
  got. "The arithmetic operators cannot produce a string in practice" is deliberately not relied on;
  that shape of reasoning is what produced the hole.
- **The reviewed-sanitiser registry carries its own review.** `sanitisers` is the entire basis on
  which check 5 admits anything — five rounds established that "this function escapes HTML" cannot be
  proven from syntax, so a human reviews each helper once and records _why_, and that written
  rationale is the control. Bypass entries have enforced a trimmed 40-character floor since the gate
  was written; this list only tested `typeof justification === 'string'`, so `""` satisfied it while
  the comment at the call site claimed unexplained entries were dropped. Blanking
  `kd-citation-dialog::escapeHtml`'s justification, and separately reducing it to `"safe"`, left
  checks 1 _and_ 5 green with the helper still admitted. Both registries now apply the same floor,
  and a rejected entry is **reported at the entry** as well as dropped — dropping alone is
  fail-closed but reports the wrong thing, at the call site rather than at the malformed record.
- **A budget ratchet.** `budgets` in the allowlist caps bypass **calls** per category — calls, not
  entries, so one member cannot absorb more without moving a number. It already worked once: deleting
  `fetchPreferredVideoSource`'s bypass made its entry stale, check 2 said so, and B ratcheted 8 → 7 in
  the same commit.

  "Debt can only shrink" was prose before it was code, and review found three ways round it. Both
  halves of the comparison lived in the same editable file, so raising a budget in the change that
  needed the headroom passed; deleting the `budgets` key turned the ceiling off entirely, because
  `Object.entries(raw.budgets ?? {})` iterated nothing; and leaving a budget above the count after a
  removal left slack for a later change to refill. Two of those three now fail on any run: a missing
  `budgets` object or a non-numeric category is a finding, and stale headroom is a finding, so a
  removal and its budget reduction must land together. Both have negative controls.

  **The third — comparing against the merge base — is written but has never executed, and this
  document previously claimed it as enforcing.** `allowlistAtBase()` reads the allowlist through
  `git show <merge-base>:…`, and the allowlist **does not exist** at `b46853a` because this branch is
  the change that introduces it. So the two merge-base invariants (a budget that rose since the base,
  and a member whose declared `calls` rose since the base) are inert here; the audit says as much on
  every run — _"could not read budgets at the merge base, so only the current ceiling was
  enforced"_ — and that note is the honest reading of what the ratchet currently is.

  Measured rather than inferred: instrumenting both comparisons and running the audit plus all 58
  selftest assertions produced **zero** executions of either. So neither has been observed red on
  purpose, and every existing ratchet control fails for a _current-tree_ reason (headroom, or count
  over budget) — deleting the merge-base code entirely would leave the suite green. They should
  begin working once this PR lands and a later branch has an allowlist at its merge base, but
  "should" is the word that this gate exists to eliminate.

  **Not fixed here, and it wants its own change.** Proving them needs either a git fixture (a
  temporary commit or worktree carrying a base allowlist) or extracting the two comparisons into a
  pure function the selftest can drive directly with a synthetic base. The second is the better
  design — no runtime seam in a security gate, real red-on-purpose coverage — and it is a refactor
  with a decision in it, not a patch.

- **`sanitizer-audit.selftest.mjs`** turns "break it on purpose" into repeatable controls rather than
  one red run pasted into a PR. It reports **58 assertions, of which only 51 are negative controls** —
  each perturbing the tree, asserting the audit goes red _for the expected reason_, and restoring from
  the original bytes. The other 7 are **5 green baselines** (so a red cannot be pre-existing noise) and
  **2 silence assertions**: check 4 must stay quiet while walking its longest path to an alias that
  resolves to a plain `string` — which distinguishes "keys on what the type resolves to" from
  "resolved a type reference" — and check 1 must stay quiet for an object literal used as a _value_
  rather than as a destructuring pattern, which is the false-failure direction of the assignment-form
  fix. Those 7 assert
  green and are **not** evidence that a check can fail, so the runner labels every row by kind and
  reports the three counts separately.

  **"For the expected reason" has to be specific enough to distinguish two findings.** Four check 4
  controls expected only `document-viewer.component.html`, which appears in
  `[4] Safe* value in a NONE context` _and_ in `[4] unresolvable type in a NONE context` — so each
  passed whether the resolver resolved the type or gave up on it, while claiming the former. One of
  them was in fact passing through the fail-closed path: it added a cross-file alias to
  `navigable-url.ts` but never exported it from the barrel the package alias points at, so the import
  resolved to the error type. All four now name the finding they mean, and putting the barrel export
  back only in that control's perturbation is what turns it from red-for-the-wrong-reason into a pass
  — verified by removing it again and watching the control fail with `matched: false`.

  This distinction is here because the count was previously misreported, twice. The summary said
  "13 controls, every check observed failing on purpose" while 5 of the 13 asserted green, and this
  document claimed 12 negative controls when there were 7. It then said 10 in two places while the
  selftest ran 23 and this section said 23 — three statements of one number, drifting apart. That is
  precisely the failure `CLAUDE.md` names — _"evidence must assert the claim, not the pulse … state
  which checks are load-bearing and which are negative, so a total is not read as all meaningful"_ —
  committed twice in the file whose whole job is to stop it. Caught in review both times, not by any
  gate. **The runner's own output is the count that cannot drift; the numbers above are dated to the
  commit that last touched them.**

  It also carries a vacuity guard that fails if a perturbation changes nothing, which is how it caught
  its own staleness once the code was fixed, and SIGINT/SIGTERM/SIGHUP handlers because `finally` does
  not run on a signal. SIGKILL remains uncatchable; the header says so.

**Not yet built** (they belong with the categories they serve): the `renderTrustedHtml` and
`trustObjectUrl` helpers. `APPROVED_HELPERS` is consequently **empty**, not pre-populated with the
two paths they will occupy — pre-registering them granted an unreviewed exemption to whatever later
appeared at those paths, and left checks 3 and 5 carrying branches nothing exercised. Also not built:
the `.cursor/rules/security.mdc` agent-facing rules from section 5.4.

---

## 7. What not to do

Each of these would close the Sonar issues and leave the codebase worse.

- **Do not add `// NOSONAR` or a blanket `eslint-disable`.** It removes the finding and the record of
  the reasoning at once, and it is what the harness in section 5 exists to make unnecessary.
- **Do not mark issues _Accepted_ while the code is unchanged and unguarded.** In Category A the
  bypass is genuinely unnecessary; accepting it institutionalises redundant code and keeps the
  `SafeUrl`-is-opaque tax that forced the shadow arrays.
- **Do not "fix" Category B by deleting the bypass.** `iframe[src]` throws on a raw string
  (Fact 4). This is the one place the wrap is load-bearing.
- **Do not swap `DOMPurify` for `DomSanitizer.sanitize(SecurityContext.HTML, …)` in Category D.**
  Angular's HTML sanitizer strips more than the note editor needs — `target`, `rel` and Quill's class
  attributes among them — so it would silently degrade note rendering.
- **Do not report a phase complete on gate output alone.** Every phase in this programme so far
  self-reported green and contained at least one overstated claim. Category B in particular changes
  media playback, and no gate in the repository watches a video play.

---

## 8. Open questions for a human

1. **`adf-hx-bridge` public API.** Category A widens `SafeUrl` to `string` in
   `hxp-document-cards` and `hxp-browse-trash`. Is that an acceptable Beta-contract change, or should
   the bridge keep `SafeUrl` and convert at its boundary? `npm run beta:api` will have an opinion;
   the contract owner should have the deciding one.
2. **ARender in production.** Is `integrations.arender` expected to arrive from a server-side
   manifest today? If yes, the compiled `localhost:8180` fallback can simply go. If no, ARender is
   already non-functional in any deployed build and Category E site 1 is a live defect rather than a
   lint finding.
3. **Has anyone noticed audio and transcoded video being broken?** Section 2 establishes that those
   paths write a `"SafeValue must use…"` string into `src`; the coercion is spec'd DOM behaviour, so
   this is not a jsdom artefact. The open question is a product one: if nobody has reported it, these
   branches are effectively unused, which changes how much of section 6 group B is worth building and
   whether the fix belongs in PR 4 or a bug ticket of its own.
4. **Sonar token.** Resolving the three residual issues needs _Administer Issues_ on the project.
   Who grants it, and should it live in CI or stay a human action?
5. **`sonar.exclusions` hides the files most likely to hold findings.** `**/*.config.ts` (lines 25
   and 64 of `sonar-project.properties`) meant the two hardcoded `http://` endpoints in
   `arender.config.ts` were never scanned; they were found only because a reviewer read the file.
   `**/scripts/**` and `**/tools/**` are excluded on the same grounds. The rationale — "configuration
   and tooling" is not product code — is reasonable for _maintainability_ rules and wrong for
   _security_ rules, which is precisely where hardcoded endpoints and credentials live. Worth
   narrowing the exclusion to the non-security rule set, and expecting new findings when it is.
6. ~~**Does `mergeIntegrations` mean what its comment says?**~~ **Answered by NXSAT-279.** It claimed
   both ARender endpoints were required and enforced neither. Rather than enforce both, the Layer 0
   semantics decision was to require only `viewerOrigin`: `nuxeoInternalUrl` became vestigial when
   the client stopped building `?url=` values, so gating on it could only reject configurations that
   would have worked. `completeARenderConfig` and its comment now agree on that contract.
