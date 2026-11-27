---
name: studio-plugin
description: Turn one custom element of a customer's Nuxeo Studio package into a Layer 2 Angular plugin that follows this repository's conventions, with tests written from the element's observed behaviour, and hold it to harness check 9. Use as the Studio migration's Code agent (M3, docs/business-apps/studio-migration.md, section 5), when the migration report proposes a custom element as a plugin, or when asked to migrate a Polymer custom element from a Studio custom bundle.
---

# Turn a custom element into a plugin

You are the Code agent of the Studio migration (docs/business-apps/studio-migration.md, sections
4 and 5). You write a Layer 2 plugin, and its tests, for one custom element of a customer's
package. You never accept it: a person reviews it, places it and accepts it, once check 9 passes.

**You never put code into configuration.** No template, script, expression or markup of the
element goes into the conversion's app definition, a manifest, a layout's label or a component's
`inputs`. Configuration names the plugin's registered ID, and nothing else of it. Check 9 scans
the configuration for code and fails it.

Read first: `CLAUDE.md` (its conventions and "Third-party component types must never appear in our
public API"), `docs/extension-reference.md` section 14 (registering from your own library), and
the plugin's own `README.md`, which quotes the element.

## 1. Read what the element does

Never run the element, or anything else from the package. Everything you need was read for you:

```bash
npm run studio-migration -- inventory <package.zip>        # "Custom elements": each one's interface
npm run studio-migration -- inventory <package.zip> --json # the same, whole: inventory.customElements
```

For each element it gives its properties (an input each, unless `_`-prefixed state or computed),
its behaviours and the methods it calls on itself (`i18n`, `hasPermission`, `fire`…), the bindings
of its template, its conditions, its listeners, the events it fires, the operations it runs, its
texts and where the package uses it. The plugin's README quotes its template and script.

The **observed behaviour** is what the element shows on a set of records and what clicking it
asks the server (`studio-migration-observed/1`, `tools/studio-migration/src/observed.ts`). For a
real package it is recorded from Web UI on the migration server. Hold the plugin to it, never to
your reading of the script alone: where they disagree, the observed behaviour is right, and you
say so in the README.

## 2. Scaffold the library from the template

```bash
npm run studio-migration -- plugin <package.zip> <element> [--owner <prefix>]
```

It runs `nx g ./tools/satori-generators:extension-library`, the template every customer's Layer 2
library comes from, into `libs/extensions/<element>`, and writes over the generator's samples:

- `src/lib/<element>/<element>.ts`: the component, registered as `<owner>.components.<name>`,
  with the element's inputs and outputs;
- `src/lib/<element>/<element>.spec.ts`: an `it.todo` for each behaviour the inventory read;
- `src/lib/texts.ts`: the element's texts in the package's own language;
- `studio-plugin.json`: what the plugin is the plugin of. Leave it as it is written. Check 9 holds
  the plugin to it, and to the element's definition it names: if the element changes, the plugin
  is written again.

It refuses a library that is already there. Do not edit `tsconfig.base.json` beyond the one alias
line the generator adds; if the generator reorders the file, put the other lines back.

## 3. Write the component, in this repository's conventions

- **`standalone: true`, `templateUrl`, `ChangeDetectionStrategy.OnPush`.** No inline template.
- **`inject()` for every dependency**, never a constructor parameter.
- **`input()` and `output()`** for the element's interface: one input per property that is not
  its own state, one output per event, named in camel case (`claim-escalated` is
  `claimEscalated`). A property the element writes back, `notify: true`, is a `model()`, and a
  read-only one is no input. The element's state (`_running`) is a `signal()`; what it computes
  from its properties (`_outstanding(amount, reserve)`) is a `computed()`.
- **Every `.subscribe()` has `takeUntilDestroyed()`.**
- **Texts** come from `texts.ts` by the element's own keys, as Web UI's `i18n` did, the key itself
  where the package holds no text: `text('label.claim.escalate')` in a template, and
  `TEXTS.label.claim.escalateFailed` in code, which the type check holds to the texts. No other
  English in the template. Never write a key as a quoted string in TypeScript: the platform's
  customer guardrail takes `'label.claim.x'` for a registered ID, and check 9 runs that guardrail.
- **The server, through the app's services only.** An operation the element ran goes through a
  service of the plugin, `@Injectable({ providedIn: 'root' })`, that injects `NuxeoApiBase` from
  `@nuxeo/satori-platform/nuxeo-client` and posts `{ input, params, context: {} }` to
  `/nuxeo/api/v1/automation/<operation>`, the input as `doc:<uid>`. Never `HttpClient`, `fetch`,
  `XMLHttpRequest`, an interceptor, or another origin. The component injects the service, never
  `NuxeoApiBase`.
- **An event** is the output's `emit`, with the detail the element fired, `{}` for one it fired
  with none. **A slot that places the component binds none of its outputs**, so what Web UI did on
  an event the plugin does itself: `document-updated` is also `DocumentChangesService.notify()`, so
  the record page and its lists read again, and a `notify` message is shown in the plugin's own
  template, the template app having no toast. Say so in the README under "Shown differently".
- **A permission test** the element made with `hasPermission(document, 'Write')` reads
  `document.contextParameters.permissions`, as Web UI's does. It decides what the screen offers,
  never what the server allows: the server still refuses what the user may not do.
- **Imports** only from `@angular/*`, RxJS, the published `@nuxeo/satori-platform/*` entry points,
  and the library's own files under `src/`.
- **The public API** (`src/index.ts`) exports the provider and the ID list only, each with its
  type written: no component, no default export, and no type of any other package.
- **The registration** is `provideSatoriExtensions({ components: { … } })`, written out, in
  `src/lib/extensions.ts`, and nothing else: no rule, action or slot entry, no initializer, and no
  registry reached from anywhere else. Keep the template's `project.json`, `vite.config.mts`,
  `tsconfig*.json` and `src/test-setup.ts` as the generator wrote them.
- **No HTML from data, no code from text:** no `innerHTML`, `outerHTML`, `[innerHTML]`,
  `DomSanitizer` or `bypassSecurityTrust*`, no `eval`, `new Function` or string timers, no browser
  storage or cookies. An image or a file the element showed from Nuxeo is fetched through a
  service and shown as a blob URL, revoked on destroy, never a Nuxeo URL bound to `[src]`; no
  style `url()`, `new Image()`, `setAttribute('src', …)`, host binding or `@HostBinding` that loads
  something past the app's services; nothing that behaves otherwise in tests, such as `isDevMode`,
  `navigator` or `import.meta`.

Nothing of the element's code is copied: you rewrite what it does in Angular. The README already
quotes it for the reviewer.

## 4. Write the tests from the element's behaviour

Turn every `it.todo` into a test **of the same title**: check 9 holds the plugin to a passing
test of each behaviour's title, as Vitest ran it, and fails while one is left, skipped, empty or in
a file Vitest does not read. Every test asserts something: check 9 runs them with
`expect.hasAssertions()`. No `.skip`, `.only`, `.todo`, `xit` or `vi.mock`.

- **What it shows:** render the component with `TestBed` on records like the observed behaviour's,
  set `document` with `fixture.componentRef.setInput`, and assert the text the element shows, word
  for word, for each record: the values it computes, and what a condition hides.
- **What it asks the server:** with `provideHttpClient()`, `provideHttpClientTesting()` and
  `NUXEO_API_ORIGIN`, click the button and assert the one request: the operation's URL, its
  `input` and its `params`, as the observed click records them. `httpMock.verify()` after each.
- **What it fires:** subscribe to each output before the click, flush the answer the observed click
  gives (or its failure status), and assert the details emitted, in order.
- **The registration:** keep the generated spec that asserts the registry, so a plugin that
  registers nothing fails.

A behaviour you deliberately do not keep is a decision for a person: write it in the README under
"Not kept", with why, and do not leave its `it.todo`.

## 5. Build it into the app, and run check 9

Until decision 5's spike proves signed, pinned plugins loaded at run time, a plugin is built into
the customer's app from the template: add its provider to the providers of the fork's
`apps/nuxeo-satori-template/src/app/app.config.ts`, beside the other Layer 2 libraries. Then:

```bash
npx nx run-many -t lint test typecheck -p <element>
npm run studio-migration -- check <package.zip> <conversion> --run-plugins --observed <observed.json>
```

Check 9 runs the plugin's own tests, and lint, test, build and typecheck through Nx; scans it for
the unsafe patterns of section 3 and the configuration for code; and shows the plugin each record
of the observed behaviour, comparing what it shows, what it asks the server and emits as it is
drawn and when each button is pressed, and that every button it shows is one the element's
observed behaviour presses. It must pass. A finding is fixed in the plugin, never by changing the
observed behaviour, the conversion's report or `studio-plugin.json`. If the element itself has
changed, change the plugin to follow it, then `npm run studio-migration -- plugin <package.zip>
<element> --restamp` records the definition it now follows. The support playbook,
`docs/business-apps/studio-migration-support.md`, says what each finding means.

## 6. Hand it over

Report to the person who accepts it: the plugin's library and component ID, check 9's result, where
Web UI used the element and the slot you propose for it (`tabs`, `documentView`, `sidebar` or a
route: a toolbar draws actions, not components), and everything under "Not kept". Do not accept the
proposal yourself, and do not write a placement into configuration unless they ask: the person who
accepts it places it.
