# Known Bug Patterns

When reading or modifying any file, scan for these patterns. Fix them proactively —
they are the most common causes of memory leaks, auth failures, and user-visible bugs.

---

## 1. Observable subscription without cleanup (memory leak)

```typescript
// BAD ❌ — subscription never cleaned up, component leaks
ngOnInit(): void {
  this.service.getData().subscribe(data => this.data.set(data));
}

// GOOD ✅ — automatically unsubscribed when component is destroyed
constructor() {
  this.service.getData()
    .pipe(takeUntilDestroyed())
    .subscribe(data => this.data.set(data));
}
```

---

## 2. Blob URL never revoked (memory leak)

```typescript
// BAD ❌ — object URL is never freed
loadThumbnail(uid: string): void {
  this.service.fetchThumbnail(uid).subscribe(blob => {
    this.thumbnailUrl.set(URL.createObjectURL(blob));
  });
}

// GOOD ✅ — tracked and revoked on destroy
private readonly blobUrls: string[] = [];

loadThumbnail(uid: string): void {
  this.service.fetchThumbnail(uid).subscribe(blob => {
    const url = URL.createObjectURL(blob);
    this.blobUrls.push(url);
    this.thumbnailUrl.set(url);
  });
}

ngOnDestroy(): void {
  this.blobUrls.forEach(url => URL.revokeObjectURL(url));
}
```

---

## 3. Direct `<img>` binding to Nuxeo URL (auth failure)

```html
<!-- BAD ❌ — browser fetches directly, no Authorization header → 401 -->
<img [src]="doc.contextParameters['thumbnail']?.url" />
<img [src]="doc.properties['file:content']?.data" />

<!-- GOOD ✅ — fetch via HttpClient, interceptor adds auth, use blob URL -->
<img [src]="thumbnailUrl()" />
```

```typescript
// Fetch via service — interceptor handles auth
this.documentDetailService
  .fetchThumbnail(doc.uid)
  .pipe(takeUntilDestroyed())
  .subscribe((blob) => this.thumbnailUrl.set(URL.createObjectURL(blob)));
```

---

## 4. State not reset on route parameter change

```typescript
// BAD ❌ — if uid changes, old data stays visible while new data loads
readonly docUid = input.required<string>();

ngOnInit(): void {
  this.loadDocument(this.docUid());
}

// GOOD ✅ — effect() reacts to every uid change and resets state first
constructor() {
  effect(() => {
    const uid = this.docUid();
    // Reset all state signals before loading
    this.doc.set(null);
    this.loading.set(true);
    this.error.set(null);
    this.loadDocument(uid);
  });
}
```

---

## 5. Loading flag not reset on error (user cannot retry)

```typescript
// BAD ❌ — loading stays true on error, UI appears stuck
this.service.getData().subscribe({
  next: (data) => {
    this.data.set(data);
    this.loading.set(false);
  },
  error: () => {
    this.error.set('Failed');
  }, // loading still true!
});

// GOOD ✅ — always reset loading in both paths
this.service.getData().subscribe({
  next: (data) => {
    this.data.set(data);
    this.loading.set(false);
  },
  error: () => {
    this.error.set('Failed');
    this.loading.set(false);
  },
});
```

---

## 6. `fetch()` instead of `HttpClient` for Nuxeo URLs

```typescript
// BAD ❌ — bypasses Angular auth interceptor, no Authorization header
const response = await fetch(`/nuxeo/api/v1/id/${uid}`);

// GOOD ✅ — interceptor automatically adds auth header
this.api.get<NuxeoDocument>(`/nuxeo/api/v1/id/${uid}`);
```

---

## 7. Hardcoded credentials

```typescript
// BAD ❌ — will trigger GitHub Secret Scanning alert
//   Placeholders shown below (<user>, <password>) so this doc file itself
//   does not trip the scanner. In real BAD code these would be literal
//   credential strings inlined into source.
const auth = btoa('<user>:<password>');
export const config = { nuxeoAuth: '<user>:<password>' };

// GOOD ✅
const auth = process.env['NUXEO_AUTH'] ?? '';
```

---

## 8. Cross-feature import (Nx boundary violation)

```typescript
// BAD ❌ — feature importing from sibling feature — Nx lint will fail
import { SearchComponent } from '@agentic-ui/feature-search';

// GOOD ✅ — move shared logic to libs/shared/ first
import { SearchService } from '@nuxeo/satori-platform/nuxeo-client';
```

---

## 9. Constructor parameter injection

```typescript
// BAD ❌ — old Angular pattern, not consistent with codebase
constructor(private readonly service: DocumentDetailService) {}

// GOOD ✅
private readonly service = inject(DocumentDetailService);
```

---

## 10. Inline template

```typescript
// BAD ❌ — project convention requires external templates
@Component({
  template: `<div>{{ title }}</div>`,  // inline
})

// GOOD ✅
@Component({
  templateUrl: './my-component.html',  // external
})
```

---

## 11. `route.snapshot` for reactive UI state (stale value on reuse)

```typescript
// BAD ❌ — snapshot is read once at construction; if the router reuses this
// component instance and only the query params change (the default reuse
// strategy does exactly that for same-route navigation), the signal never
// updates and the UI is stuck on the initial value.
readonly debugMode = signal(
  this.route.snapshot.queryParamMap.get('debug') === '1',
);

// GOOD ✅ — derive the signal from the observable so query-param changes
// propagate without a full component re-instantiation.
readonly debugMode = toSignal(
  this.route.queryParamMap.pipe(map((qm) => qm.get('debug') === '1')),
  { requireSync: true },
);
```

Use `snapshot` only for values you genuinely want frozen at construction time
(e.g. a one-shot resolver-loaded id you'll never refresh in place).

---

## 12. Always-on data capture behind an opt-in UI gate

```typescript
// BAD ❌ — captures and retains the full HTTP error body on every failure,
// even for users who never opted in via `?debug=1`. The body can be a multi-MB
// JSON payload or an entire HTML login page; keeping it in a signal means
// it lives for the component's lifetime for no benefit to the user.
error: (err) => {
  this.agentsError.set('Failed to load agents.');
  this.agentsErrorDetail.set(this.captureError('listAgents', err));
  this.loading.set(false);
},

// GOOD ✅ — capture only when the rendering branch will actually consume it.
error: (err) => {
  this.agentsError.set('Failed to load agents.');
  if (this.debugMode()) {
    this.agentsErrorDetail.set(this.captureError('listAgents', err));
  }
  this.loading.set(false);
},
```

Rule of thumb: if a piece of data is only rendered behind a feature flag, the
_capture_ should be behind the same flag — not just the render.

---

## 13. Markdown inline code spans split across newlines

```markdown
<!-- BAD ❌ — the backtick span wraps to the next line, the renderer breaks
     the code formatting, and continuation text is under-indented inside a
     list item, so the bullet collapses. -->

- **KE needs its own External App.** The Discovery SA's External App is bound to `Application = Content Intelligence
Connector` and mints tokens with `appkey: "insight"`.

<!-- GOOD ✅ — keep the whole backticked phrase on one line; indent
     continuation lines two spaces under the list bullet. -->

- **KE needs its own External App.** The Discovery SA's External App is bound to
  `Application = Content Intelligence Connector` and mints tokens with
  `appkey: "insight"`.
```

Markdown code spans (single-backtick) cannot contain a newline. Long
backticked phrases must stay on one line even if the surrounding prose wraps.

---

## 14. AI free-form output written to a vocabulary-bound field (HTTP 422)

```typescript
// BAD ❌ — the candidate list is hardcoded and TitleCase, and the LLM's
// reply is written straight to `dc:nature`. Two failure modes:
//   1. The LLM returns the sentinel "not_from_provided_classes" when no
//      candidate matches — Nuxeo rejects it with 422 because it isn't in
//      the `nature` vocabulary.
//   2. Even when the LLM picks a candidate ("Contract"), the actual
//      vocabulary id is camelCase ("contract"), so the PUT still 422s.
const KE_TEXT_CLASSIFICATION_CLASSES = ['Contract', 'Invoice', /* ... */];

runTextClassification(): void {
  this.keClient
    .enrich(blob, { actions: ['text-classification'], classes: KE_TEXT_CLASSIFICATION_CLASSES })
    .subscribe((res) => {
      // Writes "not_from_provided_classes" or "Contract" — both invalid.
      this.browseService.updateDocument(uid, { 'dc:nature': res.textClassification?.result });
    });
}

// GOOD ✅ — source candidates from the live vocabulary, then validate the
// model's response before writing. The vocabulary call is cached by
// DirectoryService, so the cost is paid once per session.
private readonly natureVocabulary = signal<DirectoryEntry[]>([]);

ngOnInit(): void {
  this.directoryService
    .getEntries('nature')
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((entries) => this.natureVocabulary.set(entries));
}

runTextClassification(): void {
  const candidates = this.natureVocabulary().map((e) => e.id);
  if (!candidates.length) { /* surface a UX error, do not call KE */ return; }
  this.keClient
    .enrich(blob, { actions: ['text-classification'], classes: candidates })
    .subscribe((res) => {
      const raw = res.textClassification?.result?.trim();
      if (!raw || raw === 'not_from_provided_classes') {
        this.toast('Knowledge Enrichment could not match this document.');
        return;
      }
      const id = this.natureVocabulary().find(
        (e) => e.id.toLowerCase() === raw.toLowerCase()
            || e.displayLabel.toLowerCase() === raw.toLowerCase(),
      )?.id;
      if (!id) { this.toast(`"${raw}" is not in the nature vocabulary.`); return; }
      this.browseService.updateDocument(uid, { 'dc:nature': id });
    });
}
```

Rule of thumb: any Nuxeo property that is backed by a directory/vocabulary
(`dc:nature`, `dc:coverage`, `dc:language`, ...) MUST be written using a value
sourced from `DirectoryService.getEntries(<vocab>)`. Never trust a string that
came from an LLM, a free-text input, or a hardcoded constant list. Always
guard against the two LLM failure modes: the sentinel ("no match") and the
hallucinated label.

---

## 15. `<mat-spinner>` inside a `mat-button` (broken layout)

`<mat-spinner>` (alias for `<mat-progress-spinner>`) renders as a block-level
element with its own intrinsic dimensions. Dropping it into a Material button
that already contains a leading `<mat-icon>` makes the button's flex content
wrap: the spinner gets one line, the label gets another, and the button
visibly grows/reflows whenever an async action toggles state.

```html
<!-- BAD ❌ — spinner is a block-level element, button content stacks vertically -->
<button mat-stroked-button class="ke-action-btn" [disabled]="loading()">
  @if (loading()) {
  <mat-spinner diameter="16" />
  } @else {
  <mat-icon>category</mat-icon>
  } Classify Document
</button>

<!-- GOOD ✅ — swap to a spinning <mat-icon>: same element, same layout,
     just a CSS rotate animation. Idle and loading states share one box.
     Use `autorenew` (or `sync`/`refresh`/`cached`/`loop`) — these all
     exist in the LEGACY "Material Icons" font that apps/nuxeo-ui loads
     (apps/nuxeo-ui/src/index.html). Do NOT use `progress_activity`: it
     only ships in the newer Material Symbols set and will render as an
     EMPTY BOX in this app. -->
<button mat-stroked-button class="ke-action-btn" [disabled]="loading()">
  @if (loading()) {
  <mat-icon class="ke-spinning">autorenew</mat-icon>
  } @else {
  <mat-icon>category</mat-icon>
  } Classify Document
</button>
```

```scss
.ke-action-btn mat-icon.ke-spinning {
  animation: ke-spin 1s linear infinite;
}
@keyframes ke-spin {
  to {
    transform: rotate(360deg);
  }
}
```

Why this works: a CSS `transform` animation is a paint-time-only operation
that cannot change the box model, so the loading-state button is byte-for-byte
identical to the idle-state button in layout. Trying to "tame" `mat-spinner`
with `!important` width/height overrides is whack-a-mole; the underlying
display mode is wrong for an inline icon slot. Reach for a spinning
`<mat-icon>` whenever the spinner needs to sit inline with text inside a
button, chip, list item, or table cell.

Rule of thumb: if you find yourself writing `display: inline-block !important`
on a `<mat-spinner>` to stop it from breaking a parent's layout, you are
fighting the wrong primitive — use a spinning `<mat-icon>` instead.

Regression test pattern: render the idle and loading buttons side by side in
a vitest TestBed test and assert (a) the loading-state element's tag is
`mat-icon`, not `mat-progress-spinner`, and (b) the loading icon's parent
element matches the idle icon's parent element. Same parent = same layout
guarantee. See `libs/features/document-detail/src/lib/document-detail/ke-action-button-layout.spec.ts`.

---

## 16. Vendor focus ring left on its fallback token (WCAG 1.4.11)

Satori components draw their own focus ring through a custom property we are expected to set:

```css
/* @hylandsoftware/satori-ui, platform-nav */
sat-platform-nav .sat-platform-nav-item:focus-visible {
  outline: 2px solid var(--sat-platform-nav-outline, var(--mat-sys-outline-variant, #c8c6d0));
  outline-offset: -2px;
}
```

Set nothing and the colour falls through to `--mat-sys-outline-variant` — a **low-emphasis
divider** token, chosen to be barely visible. On a saturated panel that lands right on the
3:1 line WCAG 2.1 SC 1.4.11 asks of a focus indicator, which is why IBM Equal Access reports
`style_focus_visible` as **"Needs review"** rather than a violation: the ratio decides it, and
the tool cannot compute it.

Two things make the measurement easy to get wrong, and both were measured on NXENG-758:

- **The negative `outline-offset` changes what the ring is adjacent to.** At `-2px` the ring is
  painted _inside_ the item's box, so it must contrast with the item's own fill, not the panel.
- **The current item has a different fill.** Satori lightens it with
  `rgba(255, 255, 255, .12)`. Measured on the default theme: **3.80:1** on a plain item but
  **2.87:1** on the current one — a pass and a fail from the same ring colour.

```scss
// BAD ❌ — nothing sets the token, so a divider colour is the focus indicator
// (no code at all: the defect is the absence)

// GOOD ✅ — declare the default on html so Layer 0 root-token overrides still win,
// while the value still points at the component's own foreground across every theme
html {
  --sat-platform-nav-outline: var(
    --agentic-nav-focus-outline-color,
    var(--sat-platform-nav-on-background, var(--mat-sys-on-primary, #fff))
  );
}
```

Do not reach for a fixed colour or a per-theme map. The vendor's own foreground token tracks
the panel across every palette; measured 4.87:1 to 8.30:1 over the four packaged themes and
both route states, against 2.87:1 before.

Leave `outline-offset` alone. `.sat-platform-nav-list` sets `overflow-x: hidden`, so a ring
drawn outside the item's box is clipped at the rail edges.

IBM Equal Access's `style_focus_visible` still reads `:focus` only (Issue 1307118137). Satori's
rule is `:focus-visible`-only, so mirror the same outline on a **standalone**
`sat-platform-nav .sat-platform-nav-item:focus` selector in `styles.scss` — not a comma list with
`:focus-visible`. See NXENG-794 and `nav-focus-ring-contrast.spec.ts`.

**Axe will not catch this**, and neither will the template `a11y-scan`: axe has no focus-ring
contrast rule, and the scan reads templates, not computed CSS. A green
`expectNoA11yViolations()` is not evidence about a focus indicator.

Regression test pattern: measure it. `nuxeo-ui` specs run in real Chrome under Karma with
`styles.scss` loaded, so the spec can render the vendor component, focus it, read
`getComputedStyle`, and assert the computed ratio per theme — no colour of ours written down,
so a palette change or a vendor rename turns it red. Put the declaration in the **global**
`styles.scss` rather than a component stylesheet, or the spec has to instantiate the whole
shell to see it. See `apps/nuxeo-ui/src/app/shell/nav-focus-ring-contrast.spec.ts` (NXENG-758).

---

## 17. `outline: none` with no replacement, and a focus ring on a non-focusable wrapper

`outline: none` on a control with no focus style anywhere is WCAG 2.1 failure technique F78 and
an SC 2.4.7 violation. It is easy to miss because nothing looks broken until you stop using the
mouse: the header global search input — the **first Tab stop on every page in this app** —
changed **zero of the 19312 pixels** in its box when it received keyboard focus. There is no
global `:focus-visible` fallback in `apps/nuxeo-ui/src/styles.scss` to catch this, so every
control is on its own.

```scss
// BAD ❌ — the browser's ring removed and nothing put back. F78.
.header-search-input {
  border: none;
  outline: none;
}

// VALID BUT AVOID ⚠️ — a real, clearly visible ring, just on the wrapper <div>. This does
// satisfy SC 2.4.7: WCAG does not require the outline to be declared on the focused node.
// Two practical costs, neither of them a WCAG failure. Every tool that inspects the focused
// element still reports no indicator, so the finding never closes and the next author has
// no way to tell a real gap from a scanner blind spot. And the ring is stuck with the
// wrapper's box, so it cannot follow the control it belongs to. Prefer the focused element;
// reach for the ancestor when the focusable element genuinely has no box of its own.
.header-search-input-wrap:focus-within {
  outline: 2px solid var(--mat-sys-primary);
}

// GOOD ✅ — the ring belongs to the element that takes focus. Give it the border and the
// radius so it has a box worth outlining, and let its colour track the same theme as the
// surface behind it — see the offset trap below.
.header-search-input {
  box-sizing: border-box;
  border: 1px solid var(--mat-sys-outline-variant);
  border-radius: 20px;
  outline: none;
}

.header-search-input:focus {
  outline: 2px solid var(--mat-sys-primary);
  outline-offset: 2px;
}
```

Three traps, each of which cost a measurement to find:

- **A positive `outline-offset` means the element's own background is not what the ring
  contrasts with.** The ring is painted outside the border box and the offset gap shows what is
  _behind_ the element, so both of the ring's adjacent colours are the ancestor surface. This
  cost two wrong conclusions in a row: first a contrast assertion that compared the ring to the
  field's pinned white, which the ring never touches; then a "fix" for the number that assertion
  produced — `color-scheme: light` on the field, to stop `light-dark(#5654ac, #c3c0ff)` flipping
  to the pale value on white. Measured against the surface the ring actually touches, that pin
  made it **2.65:1 on a dark header**, worse than doing nothing. Sample the rendered pixel just
  outside the ring, or walk up to the nearest non-transparent ancestor background, and compare
  against that. Then let the ring track the same theme as the surface behind it: 5.80–10.11:1
  across the four packaged themes (`DEFAULT_APP_THEMES` in
  `libs/shared/app-config/src/lib/bootstrap-config.ts`) and both OS colour schemes.
- **IBM Equal Access's `style_focus_visible` reads `:focus` only.** It collects `:focus-visible`
  and `:focus-within` into an array and then only ever reads index 0. A `:focus-visible`-only
  ring is invisible to it, and its lookup does not resolve **selector lists** either — writing
  `&:focus, &:focus-visible` reports the control as unindicated again. `:focus` costs nothing on
  a control that accepts keyboard input: it matches `:focus-visible` whenever focused anyway.
- **`outline-color` computes to `currentColor` even when `outline-style: none`.** A test that
  reads `outline-color` and checks the contrast ratio passes on completely unfixed code, because
  it measures the text colour. Assert `outline-style !== 'none'` and a non-zero width _before_
  measuring the colour.

Regression test pattern: `nuxeo-ui` runs its specs in real Chrome (`ng test nuxeo-ui` is the
Karma builder, and its `styles` option loads the app's global stylesheet), so assert the
_rendered_ cascade — pull the real component stylesheet in with `styleUrls`, call `focus()`, and
read the ring back out of `getComputedStyle`. Grepping the SCSS cannot tell a rule that applies
from one that is overridden. See
`apps/nuxeo-ui/src/app/shell/header-search-focus-ring.spec.ts` (NXENG-775, NXENG-909).

---

## 18. Unlabelled vendor `<svg>` inside a labelled link (WCAG 1.1.1)

A third-party logo or icon component draws a bare `<svg>` with no `<title>` and no
`aria-label`. Placed inside a link that already has an accessible name, each graphic is still
announced as an unnamed image — a WCAG 2.1 1.1.1 Non-text Content violation at level A, reported
by IBM Equal Access as `svg_graphics_labelled`.

**Axe does not catch this one.** Measured on the login page before the fix: IBM reported two
violations, axe at WCAG 2.1 AA reported zero. Axe's `svg-img-alt` only applies to an `<svg>` that
carries an explicit `role`, and a bare vendor `<svg>` has none — so an axe-clean surface can still
hold this violation, and a green `expectNoA11yViolations()` is not evidence against it.

The trap is that **an ARIA attribute on the host element does not reach the `<svg>`**. The rule
reads the `<svg>` node, and the markup belongs to the dependency — `@hylandsoftware/satori-ui`
ships its logo components with `ViewEncapsulation.None` and no `<title>` — so nothing in this
repo can label it.

```html
<!-- BAD ❌ — the link is named, but each vendor <svg> is an unnamed image -->
<a routerLink="/login" aria-label="Hyland">
  <sat-logo direction="horizontal">
    <sat-h-mark-logo />
    <sat-word-mark-logo />
  </sat-logo>
</a>

<!-- ALSO BAD ❌ — aria-label on the host never reaches the <svg>; measured, still 2 violations -->
<sat-word-mark-logo aria-label="Hyland" />

<!-- GOOD ✅ — the link carries the name, so the lockup is decorative and hidden as a whole -->
<a routerLink="/login" aria-label="Hyland">
  <sat-logo direction="horizontal" aria-hidden="true">
    <sat-h-mark-logo />
    <sat-word-mark-logo />
  </sat-logo>
</a>
```

Hide the wrapper rather than each mark: it is the lockup that is decorative, and a mark added
later stays covered. Two conditions before reaching for `aria-hidden`, and both belong in the
test rather than in the PR description:

- **The accessible name must already exist elsewhere**, and must stay exposed. Hiding the only
  thing that conveys the meaning replaces one violation with a worse one.
- **Nothing inside the subtree may be focusable** — `aria-hidden` over focusable content is
  itself a violation (`aria_hidden_focus_misuse`). A vendor release that adds a focusable element
  inside the lockup reintroduces it, so assert it rather than checking once by hand.

`aria-hidden` is not `display: none`: the graphic still renders and still has a layout box, so
visual assertions and Playwright's `expectVisible` keep passing.

Regression test pattern: assert the guarantee, not the attribute's location — every `<svg>`
inside the link has an `aria-hidden="true"` ancestor, the link itself has none, and no hidden
subtree contains a focusable element. A test for the attribute on one element passes while a
newly added mark goes unhidden. See
`apps/nuxeo-ui/src/app/login/login-page.component.spec.ts` (NXENG-743).

---

## 19. A configuration token resolved before the configuration loads

```typescript
// BAD ❌ — runs in an environment initializer / APP_INITIALIZER factory, before
// `AppConfigService.load()` has finished. Constructing AuthService resolves
// NUXEO_API_ORIGIN and the SSO tokens; their factories read `bootstrap()` once,
// Angular keeps that first value, and every package-contributed setting is ignored.
provideSatoriExtensions(() => {
  const auth = inject(AuthService);
  return { rules: { 'app.rules.isPowerUser': () => auth.isPowerUser() } };
});

// GOOD ✅ — look the service up when the rule is evaluated, after startup.
provideSatoriExtensions(() => {
  const injector = inject(Injector);
  return { rules: { 'app.rules.isPowerUser': () => injector.get(AuthService).isPowerUser() } };
});

// GOOD ✅ — or, in an initializer, wait for the configuration first.
return async () => {
  await config.load(); // runs once; every caller shares the first load
  const auth = injector.get(AuthService);
  /* … */
};
```

The tokens provided in `apps/nuxeo-ui/src/app/config/provide-app-config.ts` are one-shot reads,
so the hazard is anything that **constructs** a reader early: `AuthService`, `SessionTimeoutService`,
any `NuxeoApiBase` service (`SelectionService` included), and the auth interceptor — which is why
`AppConfigService` sends its own requests without interceptors. It fails silently: the app starts,
signs in and works, on the packaged defaults. All three of an SSO button, an idle timeout and a
Nuxeo origin from a configuration package were lost this way (NXSAT-312).

Regression test pattern: boot the real `appConfig.providers`, answer the configuration requests
with package values, and assert the tokens — `apps/nuxeo-ui/src/app/config/configuration-at-startup.spec.ts`.
A spec of one service with the token provided by hand passes whatever the startup order is.

---

## 20. A file the app ships, referenced from the server root

```typescript
// BAD ❌ — resolves to the server root. The Marketplace package serves the app from
// /nuxeo/agentic-ui/, so this is http://host/images/… → 404 on every packaged install.
protected readonly heroImagePath = '/images/Login-background.svg';

// GOOD ✅ — relative, so the browser resolves it against <base href>:
// /nuxeo/agentic-ui/images/… when packaged, /images/… on the dev server.
protected readonly heroImagePath = 'images/Login-background.svg';
```

The same holds for anything under `apps/nuxeo-ui/public/` or an `assets` `output` in
`angular.json` — `src`, `href`, `url()` in a stylesheet, an `HttpClient` URL. It is invisible
everywhere except a packaged install: the dev server, the unit tests and the e2e suite all use
base href `/`, where the two forms are the same URL. The login page's background art was a
broken image on every Marketplace install that way (NXSAT-318).

Not the same as a server path. `/nuxeo/api/...`, `/nuxeo/icons/...` and
`/nuxeo/agentic-ui-config/...` are Nuxeo's, not the app's, and are server-absolute on purpose.

`checkNoRootAbsoluteShippedAssetPaths` in `scripts/review-guardrails.mjs` rejects the root-absolute
form, reading what ships from `angular.json`. Regression test pattern: resolve the value against
the packaged base, `new URL(src, 'http://host/nuxeo/agentic-ui/').pathname` — see
`apps/nuxeo-ui/src/app/login/login-page.component.spec.ts`.

---

## 21. Selecting a version restores it, and a version looks writable

```html
<!-- BAD ❌ — choosing an entry in a list performs the destructive operation. One misclick
     replaced the live document's content and discarded its unversioned changes. -->
<button (click)="restoreVersion(v)">{{ versionString(v) }}</button>

<!-- GOOD ✅ — choosing opens the version read-only; restore is a separate, confirmed action -->
<button (click)="openVersion(v)">{{ versionString(v) }}</button>
```

Three facts about a Nuxeo version, each measured on the local server (NXSAT-332):

- **Its `permissions` enricher repeats the live document's** — `Write`, `Remove`, `WriteSecurity`
  — while the server refuses a `PUT` (500) and a trash (403, even for Administrator). Gate edit
  affordances on `doc.isVersion`, or on the `Immutable` facet it carries, not on the enricher.
- **`Document.RestoreVersion` checks `WriteVersion`**, not `Write`, and another user's lock
  removes it (403). Administrator bypasses the lock.
- **`checkout: true` leaves the restored document checked out** — it reads `0.2+` after
  restoring `0.1`, as if the user had unversioned changes. Web UI sends `checkout: false`; the
  document stays editable, because Nuxeo checks it out on the next save.

Regression test pattern: click the rendered list entry and assert no restore request — a test
that calls `restoreVersion()` directly asserts the defect. See
`libs/features/document-detail/src/lib/document-detail/document-detail.versions.spec.ts`.

---

## 22. A border token used as a text colour (WCAG 1.4.3)

`--mat-sys-outline` is Material's **non-text** role: borders, dividers, the edge of an unfilled
control. WCAG grades those under 1.4.11 at **3:1**, and the token is built to clear exactly that.
Text is 1.4.3 at **4.5:1**, so the token is a quarter of a point short — close enough to look
deliberate on screen, and far enough to be a violation.

Measured in this application's light theme, where `--mat-sys-outline` is `rgb(119, 118, 131)`,
on `--mat-sys-surface` (`rgb(249, 249, 252)`):

| Token                          | Ratio      | 1.4.11 (3:1) | 1.4.3 (4.5:1) |
| ------------------------------ | ---------- | ------------ | ------------- |
| `--mat-sys-outline`            | **4.25:1** | pass         | **fail**      |
| `--mat-sys-on-surface-variant` | 8.93:1     | pass         | pass          |

Check the background you are actually on before quoting a ratio. Both nodes axe reported for
`.task-due-prefix` sat on that one surface — `.task-item.active` looks like a different
background and is not, because it differs only by an inset `box-shadow`.

```scss
// BAD ❌ — a non-text token on 12px body text
.task-due-prefix {
  color: var(--mat-sys-outline);
}

// GOOD ✅ — the text-weight equivalent of the same role
.task-due-prefix {
  color: var(--mat-sys-on-surface-variant);
}

// ALSO GOOD ✅ — genuinely non-text, and it says so, so the guardrail allows it
.empty-icon {
  font-size: 32px;
  color: var(--mat-sys-outline); /* non-text: a 32px decorative glyph, so 1.4.11's 3:1 applies */
}
```

What makes this one worth cataloguing is **how it resists being fixed by the symptom**. Four
measured instances reached `integration/nxsat-308`, and three further text uses are still
untriaged (`docs/accessibility.md` gap 7). A sweep driven by an axe run found and fixed two of
the four —
the tasks hint at 4.46:1 and `.rv-sep` at 4.24:1 — and left the other two standing, because axe
only judges what is rendered while it is scanning: `.task-due-prefix` needs a task with a due
date on screen, and `.expired-sep` lives in a drawer panel that `phase-6-a11y` never opens. So
do not fix this by searching for the violation; search for the **token**, and note that the
fallback form hides from a naive search — `var(--mat-sys-outline, #777683)` is the same defect
as `var(--mat-sys-outline)`:

```bash
# grep -E, not rg: Rust's regex engine has no lookbehind, and the lookbehind is what keeps
# `border-color`, `background-color` and `text-decoration-color` out of the results.
grep -rnE '(^|[^-[:alnum:]_])color[[:space:]]*:[[:space:]]*var\(--mat-sys-outline' \
  --include='*.scss' --include='*.html' libs apps
```

There is **no static gate for this yet.** One was written under NXSAT-647 and withdrawn: over
seven review rounds it produced ten valid findings, all in its text matching, ending at SCSS
property nesting — where `border: { color: … }` _is_ `border-color`, a correct non-text use it
called a violation. A rule for this needs a real Sass parser rather than a regex, tracked as
**NXSAT-709**; `docs/accessibility.md` records the ten cases so a second attempt does not
restart from zero.
Until then this pattern is the check: search for the token, not for the symptom.

---

## 23. Configuration-time validation read as proof the asset will render

```html
<!-- BAD ❌ — the branch is decided by the config alone, so the @else is unreachable
     for the life of the page however the request goes. A 404, a text/html body, a
     cross-origin response with no Access-Control-Allow-Origin, or a 0x0 SVG all leave
     a zero-width <img> and no fallback. -->
@if (brandLogo(); as logo) {
<img [src]="logo.url" alt="" crossorigin="anonymous" />
} @else {
<sat-word-mark-logo aria-hidden="true" />
}

<!-- GOOD ✅ — the element reports the outcome back to the state the branch reads. -->
@if (brandLogo(); as logo) {
<img [src]="logo.url" alt="" crossorigin="anonymous" appBrandLogoFallback />
} @else {
<sat-word-mark-logo aria-hidden="true" />
}
```

A configured URL passes two checks before anything is fetched — the string as written, and where
the resolved URL points — and **neither is a liveness check**. The second one looks like one
because it is thorough and security-critical, which is exactly why it gets trusted too far. Only
the element that loaded the asset knows whether the browser could show it, so the fallback has to
be driven from an `error` handler, with the result kept in the state the template branches on
rather than in the component that happens to own the element (NXSAT-721: the header and the login
page read one signal, so the image, the packaged mark **and** the brand link's accessible name
cannot disagree — the first fix sketch cleared the image and left the link announcing "Acme").

Two traps in the handler itself:

- **`error` does not cover everything.** An image that decodes and draws nothing — a 0x0 SVG —
  fires `load`, not `error`. Measure `naturalWidth`/`naturalHeight` after `load` as well.
  Verified in Chrome: a 0x0 SVG reports 0, while a `viewBox`-only SVG reports the 300x150 default
  corrected to its aspect ratio, so the measurement does not reject a logo that would have
  rendered.
- **A failed fetch is not a reason to drop `crossorigin="anonymous"`.** The resolved-URL check
  cannot see a _redirect_ to a Nuxeo URL, and that attribute is the only thing keeping the session
  cookie off the follow-up request. The cost — a remote asset needs `Access-Control-Allow-Origin`
  — is the intended trade; say so in the diagnostic instead of removing the attribute. Fetching
  it through `HttpClient` into a blob URL does not help either: XHR is more CORS-restricted than
  `<img>`, not less.

Regression test pattern: assert the fallback after dispatching `error`, and drive the zero-size
path with a real `data:image/svg+xml` 0x0 URI so the `load` measurement is exercised rather than
simulated — `apps/nuxeo-ui/src/app/shell/app-shell-brand-logo.spec.ts`.

---

## 24. A blank string accepted as a configured value

```typescript
// BAD ❌ — "" is a string, so it overrides the packaged default. An empty field in a
// configuration tool is the usual way one arrives, and the result is a blank browser tab
// title and a brand link a screen reader announces as just "link".
applicationTitle: readString(branding, 'applicationTitle', base.branding.applicationTitle),

// GOOD ✅ — blank and whitespace-only keep the fallback.
applicationTitle: readNonBlankString(branding, 'applicationTitle', base.branding.applicationTitle),
```

Ask of every configured string whether the empty string is a value a customer could **mean**. For
anything always shown to someone — a product name, a tab title, an accessible name — it is not:
`""` is not a quieter choice, it is an absent one. This repo already took that view elsewhere and
branding was the inconsistency: `readStringRecord` requires `entry.trim() !== ''` for manifest
operation ids, `readStringArray` requires a non-empty result, and the ARender config requires a
non-blank `viewerOrigin`.

**The expensive half is the merge, not the default.** Configuration arrives as ordered fragments,
so the question is not only "what does a blank give me" but "what does a blank do to a value an
earlier package set correctly". It wiped it out: `{documentTitle: 'Acme Portal'}` followed by
`{documentTitle: ''}` left the tab with no title at all, which is worse than the reported symptom
and was not in the ticket (NXSAT-722). Assert the layering, not just the single value.

Fix at the config-read layer rather than at each consumer: the readers are the one place that
knows the packaged fallback, and a guard there fixes every consumer — including other apps on the
same shared library — at once.

---

## 25. A reactive effect scoped to a component that does not mount on every route

```typescript
// BAD ❌ — in AppShellComponent's constructor. The effect is right: the configuration load is
// asynchronous, so a reactive reader is what re-runs when it lands. The SCOPE is wrong — the
// shell only mounts on authenticated routes, so the sign-in page never got the configured title.
effect(() => {
  document.title = this.appConfig.bootstrap().branding.documentTitle;
});

// GOOD ✅ — at application scope, where there is no route that escapes it.
export function syncDocumentTitle(config, document, injector): void {
  effect(
    () => {
      document.title = config.bootstrap().branding.documentTitle;
    },
    { injector },
  );
}
```

A global concern — the tab title, `<html lang>`, a theme class on `<html>` — belongs at
application scope. Putting it in the shell makes it quietly conditional on being signed in, and
the gap is invisible from inside the shell because everything looks right there. The sign-in page
is the case to check: it is the first page a customer sees and the one that reaches their history
and bookmarks.

Two details that bite:

- **`effect()` needs an injection context.** An `APP_INITIALIZER`'s returned closure runs after
  provider resolution, so pass the `Injector` in (`{ injector }`) exactly as the neighbouring
  `syncDocumentLanguage` takes a `DestroyRef`.
- **Check the prose while you are there.** `index.html` claimed "AppShellComponent replaces it
  from Layer 0 `branding.documentTitle`", which is what made the gap easy to miss for everyone who
  read it. A comment asserting a guarantee nothing enforces is the `stale-prose` class the
  pre-PR review skill exists for.

---

## 26. A security rule stated about hosts, compared as strings — and a refusal that says nothing

```typescript
// BAD ❌ — the rule is "any host that serves Nuxeo is refused", but this compares the
// hostname the URL parser happened to produce. The parser normalises case and every IPv4
// form, which hides how much it does NOT normalise: `localhost.` is the FQDN form of
// `localhost`, shares its cookie jar, and compares unequal. Returning a bare `null` then
// loses the reason, so nobody can tell a refusal from "nothing was configured".
const nuxeoHosts = origins.map((o) => parseUrl(o)?.hostname);
if (nuxeoHosts.includes(url.hostname)) return null;

// GOOD ✅ — compare on a canonical form, and make the reason the return value.
if (nuxeoHosts.some((host) => isSameHost(host, url.hostname))) {
  return { refused: 'it names a host that serves Nuxeo, where an <img> would carry the cookie' };
}
```

Two defects that travel together (NXSAT-724), both worth checking for separately.

**A rule written about a concept, enforced on a representation.** `url.hostname` is already
canonical for case and for IPv4 (`127.1` and `0x7f.0.0.1` both arrive as `127.0.0.1`) — which is
exactly what makes this one hard to see: the partial normalisation reads as full normalisation.
It keeps a trailing dot, and it cannot know `localhost`, `127.0.0.0/8` and `[::1]` are one
machine. Before trusting a parser's output as canonical, **print the forms you care about and
look**, rather than reasoning about what it ought to do:

```bash
node -e "for (const h of ['localhost','localhost.','127.1','[::1]']) console.log(h, new URL('https://'+h).hostname)"
```

Note where it must stop: resolving a name to an address needs DNS, which a browser does not
expose. State the residual gap rather than implying the rule is total.

**And check the other address family.** The first fix of this covered `localhost`, `127.0.0.0/8`
and `[::1]`, and the reviewer found `[::ffff:127.0.0.1]` straight through it — IPv6 can embed an
IPv4 address three ways, and the parser canonicalises each into a different shape
(`[::ffff:7f00:1]`, `[::7f00:1]`, `[::ffff:0:7f00:1]`). Decode the embedded address for each of
those three prefixes **and only those**.

The first attempt generalised instead, accepting any address whose upper groups were `0` or
`ffff` on the reasoning that an enumerated list "is incomplete the moment a fourth embedding
exists". That reasoning is wrong here, and the next round of review caught it: the
generalisation was **unsound**, not merely broad. It read an IPv4 address out of hosts that embed
none, so `[::ffff:ffff:7f00:1]` was treated as loopback, and `[::ffff:0:0:0:1]` and
`[::ffff:0:1]` — two distinct addresses — collapsed onto one key. Both refused logos that should
have loaded.

The distinction worth carrying: enumerating is right when the set is **defined by a
specification** (three IPv4-in-IPv6 embeddings, which change only when a standard changes) and
wrong when it is defined by an open-ended implementation (which elements a browser makes
focusable). An incomplete list fails closed on something it has not heard of; an unsound
generalisation fails _open_ in both directions, and in a host-equivalence rule that means
refusing a customer's logo.

**A guard added for diagnostics must not become a new failure mode.** The same review found that
reporting the refusal parsed the configuration URL unguarded, inside a method documented to
never reject because it runs as an `APP_INITIALIZER`. A malformed override turned a _tolerated_
load failure into a failed startup — the reporting was worse than the silence it replaced. When
you add a pass over configuration to explain it, the pass inherits that contract.

**Say only what you know.** The first message read `refused, keeping the Satori marks`, which is
false whenever an earlier layer set a valid value: a refusal falls back to `base`, not to the
packaged default. Report what was refused and why; do not narrate the merged outcome from one
contribution's point of view.

**Never canonicalise to a sentinel drawn from the value space.** The second review round found
that mapping every loopback spelling to the string `'loopback'` made a third-party server
_actually named_ `loopback` compare equal to `localhost`, so its logo was refused. A sentinel
only works where it cannot be a real value, and `'loopback'` is a legal DNS name. Express the
equivalence as a predicate on both sides instead:

```typescript
// BAD ❌ — the key is itself a possible hostname.
const key = (h: string) => (isLoopback(h) ? 'loopback' : h);
return key(a) === key(b);

// GOOD ✅ — no key, so nothing to collide with.
if (isLoopback(a) && isLoopback(b)) return true;
return a === b;
```

The same round found the narrower equivalence twice more: `*.localhost` resolves to loopback
(RFC 6761) and was missed, and the embedded-IPv4 decode was applied only to loopback, so a
deployment on `10.0.0.5` still accepted `[::ffff:10.0.0.5]`. **Decide the equivalence once, for
all values**, rather than special-casing the one address you were looking at. Each fix needs a
negative control — `mylocalhost` and `localhost.example.com` must stay allowed — because the
failure mode of an over-broad host rule is a customer's logo silently refused.

**A refusal with no reason is indistinguishable from no configuration.** A function returning
`null` for "refused" throws the reason away at the moment it is known. Return the reason and
derive the boolean from it — `isAccepted = describeRefusal(x) === null` — so the verdict and the
explanation are one implementation and cannot disagree. Two functions that must agree, with
nothing comparing them, is the `proxy-check` class the pre-PR review keeps finding. Then log it
from the service, **once per load**, not from a `computed` that re-runs.

**One reason per cause, not per rule.** A predicate that returns `false` for several unrelated
reasons gives one message for all of them, and that message is then wrong for most of them. On
this fix a path refused because the _server_ would re-read `;` or `%` was reported as pointing
outside the configuration directory — untrue for a file named `acme;v=1.svg`, which is inside it,
and it sends the administrator looking in the wrong place. Likewise `javascript:` and `http:`
shared "must use https:". When a boolean predicate covers several causes, return the reason and
let the boolean be `reason === null`.

Regression test pattern: a table of every refused form asserting the message names the value, the
contributing package and the reason, plus one accepted value asserting silence — that negative
control is what proves the reporting is not unconditional
(`libs/shared/app-config/src/lib/app-config.service.spec.ts`). Add one assertion that **no two
causes share a message**: it is a single test over the table, and it is what caught both
collisions above (`bootstrap-config.spec.ts`, `describeBrandingLogoRefusal`).

---

## 27. A calendar day anchored in one zone and read in another

**Found in:** NXSAT-727 — a date picked in the Edit dialog was saved as local midnight, and the
layout row, which formats in UTC, showed the previous day for every user ahead of UTC. Two rows of
the same panel disagreed about the same property.

**The pattern, not the instance.** A calendar day ("6 March") and an instant ("2024-03-06T05:00Z")
are different kinds, and JavaScript gives you one type for both. Every bug in this family is the
same mistake: a day is turned into an instant in one zone and turned back into a day in another.
It has now been hit at least five times in this repo — the ACE begin/end dates
(`permission-timeframe.utils.ts`, `permissions-model.ts`), the version-compare rows
(`formatCompareDate`), the layout `date` renderer (`field-view.ts`) and the metadata editor.

```ts
// WRONG — the instant depends on the writer's zone, so the same picked day is five
// different values across five zones, and only a reader in the writer's zone agrees.
return pickedDay.toISOString(); // local midnight

// WRONG, the mirror image — reads the day in the reader's zone
const day = new Date(property).getDate();

// RIGHT — one anchor, used on both sides
return utcMidnightOf(pickedDay); // Date.UTC(y, m, d) from the picker's own y/m/d
const day = new Date(property).getUTCDate();
```

**The rule:** pick UTC as the anchor for a day, write it there, read it there, and format it there.
UTC because that is what Nuxeo stores for a day-only write (`2024-03-06` →
`2024-03-06T00:00:00.000Z`), which makes it the one anchor the server, the client and another
client all already agree on. Do not anchor a day locally "because the user is local" — the user
who reads it is not always the user who wrote it.

**Do not "recover" the day with a rounding heuristic** in general-purpose code. `dayToDate` in
`permissions-model.ts` snaps an instant to the nearest UTC midnight and is correct _there_, because
an ACE date really is midnight in some zone. Applied to a field that renders arbitrary `date`
properties it is wrong for every timestamp after 12:00 UTC, which it reports as the next day.
Narrow correctness does not generalise; check what the values actually are.

**A real instant is not a calendar day and must not be converted.** In one panel,
`dc:created`/`dc:modified` are server stamps and belong in the reader's zone, while `dc:expired` is
a picked day and belongs in UTC. Formatting them alike is a second bug wearing consistency's
clothes.

Regression test pattern — and this is the part that is easy to get wrong:

- **In UTC, local anchoring and UTC anchoring are byte-identical, so no assertion can tell them
  apart.** CI runners are UTC. A date test that does not control the zone asserts nothing about
  this family of bugs, which is how NXSAT-727 passed a 1 652-case suite. `satori-components`
  pins `process.env['TZ']` in its `vite.config.mts` for exactly this reason.
- **Setting `process.env.TZ` inside a case does not work** under `pool: 'threads'` (this repo's
  default): Node reads the zone once at startup, so the assignment is accepted and ignored. A
  four-zone loop written that way ran the host zone four times and read as though it proved four.
  Verify with `Intl.DateTimeFormat().resolvedOptions().timeZone` before trusting any such loop.
- Assert **literals** (`'2024-03-06T00:00:00.000Z'`), never `new Date(y, m, d).toISOString()` —
  the derived form is the buggy behaviour restated, so it passes either way.
- Use an instant whose UTC and local days actually differ (`20:00Z` at +05:30, `00:00Z` west of
  UTC). `09:00Z` is the same day in most zones and proves nothing.
- Angular's `DatePipe` memoises on (value, pattern, timezone, locale). Re-asserting a value an
  earlier render in the same file used returns the cached string and passes unfixed.

---

## Copilot Flags These on PRs

If you write any of the above, GitHub Copilot will leave a review comment.
Fix proactively to avoid a review cycle:

- "Missing unsubscribe" → add `takeUntilDestroyed()`
- "Potential XSS" → use Angular template binding
- "Hardcoded credential" → move to environment variable
- "Race condition" → add stale-check before setting signal after async operation
- "Snapshot won't reflect changes" → `toSignal(route.queryParamMap.pipe(map(...)))`
- "Captured even when feature is off" → wrap the capture in the feature flag
- "Code span split across newlines" → keep the whole backticked phrase on one line
- "Writing AI output to a vocabulary field without validation" → source candidates from the vocabulary and validate the response
- "`<mat-spinner>` inside a button" → use a spinning `<mat-icon class="ke-spinning">progress_activity</mat-icon>` to preserve inline layout
- "SVG has no accessible name" → if the link around it is already named, mark the graphic decorative with `aria-hidden="true"` on the wrapper; an `aria-label` on the host element does not reach the `<svg>`
- "Focus indicator may not be visible" → set the vendor's focus-outline custom property to its own foreground token; left unset it falls back to a low-emphasis divider colour and misses 3:1
- "Absolute path to a bundled asset" → drop the leading `/` so it resolves against `<base href>`; the packaged app lives under `/nuxeo/agentic-ui/`
- "Low contrast text" → if the colour is `var(--mat-sys-outline)`, that is a border token graded at 3:1; use `var(--mat-sys-on-surface-variant)` for text. If the use really is non-text (an icon, a divider), say so in a comment with the measured ratio
- "No fallback if the image fails to load" → bind `(error)` and clear the state the template branches on, not a flag local to one component; and measure `naturalWidth` after `load` too, because an image that draws nothing fires no `error`
- "Host comparison may be bypassed by equivalent forms" → canonicalise before comparing (strip a trailing dot, alias the loopback spellings); the URL parser normalises case and IPv4 but not those
- "Silent rejection" → return the reason and derive the boolean from it, then log it once from the service; a bare `null` makes a refusal look like nothing was configured
