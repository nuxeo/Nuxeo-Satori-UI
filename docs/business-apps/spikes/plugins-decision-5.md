# Spike: loading customer code at run time, for decision 5

Status, 25 November 2026: **a spike, which informs decision 5 and decides nothing.** Decision 5 in
the [decision log](../decisions.md) stays open, with its owners, product and engineering. Nothing
here ships to customers: the prototype, [`tools/plugin-spike`](../../../tools/plugin-spike/README.md),
is not wired into `apps/nuxeo-ui`, not exported from any library and not built into any artefact,
and two checks fail if it becomes so (section 9). Every key in it is generated for one run and
trusted nowhere.

This repository is public, so the report describes the prototype and the options. How the shell
holds its sign-in, and which headers its page sends today, are left to the independent security
review (section 8) and internal channels.

## The short version

- **Loading a signed, pinned plugin at run time works, and costs little.** The prototype's loader
  checks a manifest's signature against a trusted key, the deployment's pin, the URL and the hash
  of the bytes, then runs the bytes through a module `<script>` carrying the same `integrity`. In
  Playwright's Chromium 156 and WebKit 27.2 it loaded the good plugin and refused all seven bad
  variants (section 3), including bytes swapped after the check, which the browser itself refused.
  In Node, the checks take about 1.4 ms for a 2 MiB bundle.
- **It does not make customer code any safer than building it in.** In the host's page, the
  plugin read the stored session, the host's DOM and the host's client, sent requests with the
  user's session cookie, and captured the host's own `Authorization` header in flight. The checks
  decide which bytes run, not what they do. That is the same reach as code built into the app from
  the template today.
- **Isolation needs a sandboxed iframe, with limits.** The same bytes in
  `<iframe sandbox="allow-scripts">` reached none of that in either browser. But in WebKit the
  frame's request to the server still carried the `SameSite=Strict` session cookie; it only could
  not read the answer. A frame is also a box on the page, not a component in it.
- **An Angular component bundle loaded at run time is tied to the host's Angular version,**
  which removes the reason to load it at run time. A custom element is not tied to it.
- **Recommendation (section 10):** keep the template build as the route for customer code, as
  decision 5 recommends. Do not ship run-time loading until the prerequisites in section 10 hold. If
  it goes ahead, load custom elements only, pinned in the deployment's configuration package, with
  the signature checked at install and in the browser, and sandbox anything less trusted than the
  shell.

## 1. The question

Decision 5 asks whether customer code is loaded into the shipped app at run time or built into it
from the template. Its recommendation is to spike in phase 6 and keep the template build until
signed, pinned plugins are proven. The [development plan](../development-plan.md)'s phase 6 builds
"plugin loading, as decision 5 sets it" and is done when "plugin loading is chosen, signed and
pinned". The [architecture](../architecture.md) (section 9) asks that plugins be signed, pinned to
a version and fetched only from the server's plugin registry, and its section 17 lists run-time
loading with Angular 22 as not prototyped. This spike prototypes the loading, and checks what a
loaded plugin can reach.

## 2. The two options

**(a) Built in from the template, today.** A customer writes a Layer 2 library
([extension reference](../../extension-reference.md), section 14), usually generated with
`nx g ./tools/satori-generators:extension-library`, registers it with one provider, and builds a
fork of `apps/nuxeo-satori-template` with it. The library may import only the published
`@nuxeo/satori-platform` entry points, which `libs/platform/guardrails/check-extension-library.mjs`
checks. The customer's build is the app their users get.

**(b) Loaded at run time, signed and pinned.** One shell for everyone. A plugin is a bundle in a
plugin store with a manifest beside it. The deployment decides which plugins run, at which version
and hash; the shell fetches each, checks it, and runs it. The prototype models the manifest as
eight fields, `id`, `version`, `apiVersion`, `element`, `url`, `integrity`, `keyId` and
`signature`, and the deployment's policy as trusted public keys, pins, allowed URL prefixes and
the plugin API versions the shell serves. None of the policy comes from the manifest.

|                                    | (a) Template build                        | (b) Run-time plugin                                                                  |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Who builds the app                 | The customer, from a fork                 | Hyland, once; the customer builds only the plugin                                    |
| A platform release reaches users   | When each customer rebuilds and redeploys | When the deployment upgrades the shell; plugins keep working if the plugin API holds |
| What customer code can reach       | Everything the app can                    | The same, in the page (section 4.3); less in a sandboxed frame                       |
| New attack surface                 | None at run time                          | The store, the manifests, the signing keys and the pins                              |
| Type checking against the platform | At the customer's build                   | Only against a published plugin API, at the plugin's build                           |
| Operating it (section 8)           | A template and a published package        | A store, keys, pins, revocation, a compatibility matrix and review                   |

## 3. The prototype

[`tools/plugin-spike`](../../../tools/plugin-spike/README.md) holds the loader
(`src/plugin-loader.mjs`), a sample plugin (`sample/sample-plugin.js`, a custom element), a host
page (`host/`), and a demo server (`dev/serve.mjs`) on 127.0.0.1 that makes its keys when it starts.
The loader copies the manifest once, then runs its checks in this order; every check that needs
only the manifest runs before a byte is fetched:

1. the manifest has exactly the eight fields, each of its shape, and no line break in any;
2. the signing key is in the trust root, is an EC P-256 public key, and has no private half;
3. the ECDSA P-256 signature verifies over a fixed text naming every field but `url`;
4. the deployment pins this plugin at this version and this hash;
5. the shell serves the plugin API version the plugin targets;
6. the URL, once normalised, is under an allowed prefix, with no credentials, no query or fragment
   (not even an empty one), and no encoded `/`, `\` or `.` in its path;
7. nothing has defined the plugin's element yet, so the last step can tell who defined it;
8. the bytes are fetched;
9. the bytes hash to the signed `integrity` (SHA-384 or SHA-512 only);
10. a module `<script>` with that `integrity`, in CORS mode, runs them, so the browser checks the
    bytes it runs;
11. the element the manifest declares is defined.

The host page runs nine scenarios, each with the outcome it advertises, the refusals first, since
an element can be defined only once per page. All nine gave it in Chromium 156.0.8078.4 and WebKit
27.2:

| Scenario                                                     | Outcome                                    |
| ------------------------------------------------------------ | ------------------------------------------ |
| Signed, pinned, intact                                       | Loaded in the page                         |
| Tampered bundle (code appended)                              | `integrity-mismatch`                       |
| Tampered bundle, hash in the manifest updated, not re-signed | `bad-signature`                            |
| Signed by a key the deployment does not trust                | `untrusted-key`                            |
| Signed by another key under the trusted key's id             | `bad-signature`                            |
| An older version, validly signed: a rollback                 | `not-pinned`                               |
| A URL outside the plugin store                               | `url-not-allowed`                          |
| Good bytes for the check, tampered bytes for the run         | `execute-failed`: the browser refused them |
| Signed, pinned, intact, in a sandboxed iframe                | Loaded in the frame                        |

To run it:

```bash
node tools/plugin-spike/dev/serve.mjs            # then open http://127.0.0.1:4410/
npx nx test plugin-spike                        # the tests, section 9
node tools/plugin-spike/dev/browser-check.mjs   # needs Playwright installed with --no-save
node tools/plugin-spike/dev/measure.mjs         # section 6's figures
```

## 4. Security

### 4.1 What the checks buy, and what they do not

- **The signature says who made the bytes.** Changing any signed field, or the bytes' hash, without
  the key is refused.
- **The pin says which bytes this deployment chose.** A signature alone accepts every version the
  publisher ever signed, an old vulnerable one included; the pin refused a validly signed older
  version.
- **The integrity says these bytes and no others,** checked twice: by the loader, which gives a
  clear reason, and by the browser at execution, which closes the gap between the two. Bytes
  swapped between the check and the run were refused by the browser in both engines. The tests
  hold the executor to setting `integrity` and CORS mode on the script; the browser's refusal
  itself is seen only in the browser run (section 9).
- **None of them says what the code does.** A loaded plugin runs with the shell's origin and
  privileges (section 4.3).
- **Integrity covers one file.** A module the bundle imports in turn is not covered by the entry's
  `integrity`. The prototype's bundles are single files for that reason. An Angular build is many
  chunks, and covering them needs an import map's `integrity` entries for each chunk, which was not
  tried.
- **A URL is fetched once per page.** A module already in the page's module map is not fetched or
  checked again, so a store should give every version and hash a URL of its own.

### 4.2 The trust root

Where the trusted public key lives decides what the signature protects against.

- **In production the shell is served by Nuxeo,** from a Marketplace package, at
  `/nuxeo/agentic-ui/`. Whoever can install a Marketplace package or write the server's files can
  replace the shell, its configuration and any trust root shipped with them, together. A signature
  checked in the browser cannot protect against them, and neither can option (a).
- **What a browser-side signature does protect:** a plugin store that is not the shell's own
  install, such as documents in the repository, a CDN or an object store, where someone who may
  write plugins may not change the configuration. It also names a publisher for every byte that
  runs.
- **So the strongest check is at install, on the server.** The package pipeline already proposes
  keyless signing with Sigstore and verification at install
  ([package-pipeline.md](../package-pipeline.md), section 9.1). Verifying a Sigstore bundle in the
  browser was not tried; it needs the certificate chain, the transparency log proof and a trusted
  root, against one WebCrypto call for a plain key.
- **In the browser,** the pin (id, version and hash) in the deployment's configuration package is
  the control that matters, with a signature by a deployment key when the store is separate.
- **A host holds public keys only.** The loader refuses a trusted key with a private half, and the
  prototype's private keys are non-extractable and never written down.
- **The prototype's own trust root is weak on purpose.** The demo server serves it beside the
  plugins, which is the arrangement the first bullet describes.

### 4.3 What a plugin can reach, observed

The host page planted fake values, each starting `FAKE-`: a session in `sessionStorage`, a value
in `localStorage`, a readable cookie, a host-only element, a stand-in Nuxeo client on `window`, an
HttpOnly `SameSite=Strict` session cookie from the server, and its own XHR with an `Authorization`
header made after the plugin loaded. The sample plugin then tried for each. The browsers were
Playwright's builds of Chromium 156 and WebKit 27.2, on 127.0.0.1; not Safari, and not a real
domain. The answers were the same in both, except where marked.

| Probe                                                                             | In the host's page                                      | In `<iframe sandbox="allow-scripts">`                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Read the host's DOM                                                               | Reached                                                 | Stopped (`SecurityError`)                                                                                 |
| Read `sessionStorage` / `localStorage`                                            | Reached                                                 | Stopped (`SecurityError`)                                                                                 |
| Read a readable cookie                                                            | Reached                                                 | Stopped (`SecurityError`)                                                                                 |
| Read the HttpOnly session cookie                                                  | Stopped                                                 | Stopped                                                                                                   |
| Call the host's client object                                                     | Reached                                                 | Stopped: not in the frame's realm                                                                         |
| Send a request with the session cookie                                            | Reached: it acts as the user without reading the cookie | Chromium: sent without the cookie. **WebKit: sent with the cookie.** Neither could read the answer (CORS) |
| Capture the host's `Authorization` header in flight, by patching `XMLHttpRequest` | Reached                                                 | Stopped: it patched only its own realm                                                                    |
| Send to another origin                                                            | Stopped by CSP `connect-src`                            | Stopped by CSP `connect-src`                                                                              |
| Run an inline script, or compile a string to code                                 | Stopped by CSP                                          | Stopped by CSP                                                                                            |
| Define the host's own element name first                                          | Stopped: the host defined it first                      | Reached, in the frame's own registry only                                                                 |
| Define an element its manifest never declared                                     | Reached                                                 | Reached, in the frame only                                                                                |
| Replace `window.fetch`                                                            | Reached                                                 | Reached, in the frame only                                                                                |
| Navigate the page away                                                            | Not tried: CSP has no directive against it              | Not tried: the sandbox has no `allow-top-navigation`                                                      |

What that means for a shell, reasoned rather than run:

- **Whatever the shell keeps where its scripts can read it, an in-page plugin can read.** How the
  shell holds its sign-in is for the security review.
- **With a session cookie, a plugin cannot read the cookie but can call any Nuxeo API the user
  may,** by sending requests from the page.
- **Whatever the shell sends from JavaScript, an in-page plugin can capture,** as the XHR probe
  did. Token-based sign-in (decision F) changes what is stored, not this.
- **Whether a plugin can reach the shell's Angular services through Angular's internals was not
  tried.** Assume it can: nothing in the page separates the two.
- **The manifest's `element` is a declaration, not a limit.** The loader checks the element was
  not defined before and is defined after; it cannot stop the plugin defining others. Custom
  element names are first come, first served across the page.

### 4.4 Content-Security-Policy

- **What it did here:** with `script-src 'self'`, `connect-src 'self'` and no `unsafe-inline` or
  `unsafe-eval`, both browsers refused the plugin's request to another origin, its inline script and
  its string-to-code.
- **What it cannot do:** tell the plugin from the shell when both come from the same origin; stop a
  script navigating its own page; stop exfiltration through the shell's own server, such as writing
  to a document as the user.
- **Paths narrow it a little.** A source with a path, such as
  `script-src https://host/nuxeo/agentic-ui/ https://host/nuxeo/plugins/`, lets code run only from
  those paths. Browsers relax path matching after a redirect, so the store must not redirect.
- **A strict page CSP on the shell is a prerequisite for (b),** and would help (a) as much. As
  Nuxeo serves the shell, the header has to come from Nuxeo or a proxy in front of it.
- **Not tried:** Trusted Types, and the newer `Integrity-Policy` header, which asks the browser to
  refuse any script without `integrity`. Their browser support needs checking before either is
  relied on.

### 4.5 Sandboxing options and their limits

| Option                                                                   | Isolates the plugin from the shell                                                           | Limits                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| None: the plugin in the page, in a shadow root                           | No. Shadow DOM scopes styles, not access                                                     | Seen in section 4.3                                                                                                                                                                                                                                                                                                                                                        |
| `<iframe sandbox="allow-scripts">`, opaque origin, with a message broker | Yes, from the page's DOM, storage, cookies, realm and client                                 | A box on the page: layout, theme, focus and accessibility cross a frame boundary. No shared dependency injection, and a framework copy per frame. The broker is itself an attack surface: every capability it offers, a plugin can misuse. Requests are still sent: WebKit sent the session cookie with one. `allow-scripts` with `allow-same-origin` is no sandbox at all |
| The same frame, served from a separate site                              | Yes, and a `SameSite=Lax` or `Strict` session cookie stays off its requests in every browser | A second registrable domain per deployment, with its certificate: hard for on-premises customers. A `SameSite=None` cookie would still be sent. Not tried                                                                                                                                                                                                                  |
| A Web Worker                                                             | From the DOM, the page's realm, Web Storage and `document.cookie`                            | No UI. A same-origin worker still sends requests with the session cookie                                                                                                                                                                                                                                                                                                   |
| Hardened JavaScript (`lockdown()` and compartments)                      | In principle, in the page                                                                    | Freezes the page's built-ins, which Angular and zone.js, loaded by both apps, may not survive. Not in the lockfile. Not tried                                                                                                                                                                                                                                              |
| ShadowRealm                                                              | In principle                                                                                 | A TC39 proposal; not used here                                                                                                                                                                                                                                                                                                                                             |
| A separate app, or an embedded panel with token exchange (decision F)    | Yes                                                                                          | Not a plugin: a different product shape                                                                                                                                                                                                                                                                                                                                    |

### 4.6 Supply chain

- **(a)** A customer's dependencies enter at their own build, under their lockfile; this
  repository's dependency review does not see them. A platform fix reaches their users only when they
  rebuild.
- **(b)** adds four things to defend: the publisher's build, the signing key or identity, the store,
  and the process that changes pins. A stolen key with write access to the store runs code in the
  session of every user of every deployment that trusts the key and updates its pins to the new
  bytes; a pin held by the deployment stops one that does not. Rollback is stopped by the pin.
- **Revocation** is a pin removed per deployment. A signature has no revocation of its own: it
  needs a revocation list, or short-lived signatures as Sigstore issues.
- **A plugin's own dependencies are inside its bundle,** where the shell cannot see them, so each
  plugin needs a software bill of materials, and a third-party plugin a review before it is signed.
- **The loader itself is outside CodeQL's scan,** which `.github/codeql-config.yml` limits to
  `apps/` and `libs/`. Production loading code would live in `libs/`, and be scanned.

## 5. Upgrade compatibility across Angular versions

Angular ships a major release about every six months; this branch is on 22.2.3.

- **(a)** The customer rebuilds against each platform release, so an incompatibility is a compile
  error in their build, not a failure in production. Angular libraries are published partly
  compiled and linked at the app's build, which is what lets a library built with an earlier
  Angular run in a later app. The cost is a rebuild and a redeploy per customer per release, which
  `npm run beta:upgrade` rehearses.
- **(b), a custom element.** The contract is the DOM: attributes, properties and events, served
  the same by any Angular version the shell moves to. The plugin brings its own framework, or none,
  so only the plugin API's version (`apiVersion`) has to be kept. Both apps load zone.js, so a
  plugin built with Angular may run in that zone or be zoneless, but must not load zone.js again.
  `@angular/elements`, which builds an Angular component as a custom element, is not in the
  lockfile.
- **(b), an Angular component bundle sharing the shell's Angular.** Compiled Angular code calls the
  framework's private instructions, and nothing links it at run time, so a bundle must in practice
  be compiled with the same Angular version as the shell, and rebuilt for every shell release.
  Sharing the shell's Angular needs module federation (for example
  `@angular-architects/native-federation`, not in the lockfile), because the shell's chunk names
  change with every build (`outputHashing: all`). That is the cost of (a) without its compile-time
  checks. `checkSatoriComponentsFederationReadiness` keeps the `nxs-` library ready for
  federation, so the door stays open.

## 6. Performance

- **The checks are cheap.** `node tools/plugin-spike/dev/measure.mjs`, in Node 24 on one
  developer machine, with the fetch and the run faked: 0.19 ms for 64 KiB, 0.42 ms for 512 KiB,
  1.36 ms for 2 MiB and 5.0 ms for 8 MiB per load. Not measured in a browser.
- **The requests are not.** The prototype fetches a bundle twice, once to hash it and once to run
  it. The browser's own check at execution makes the first fetch optional, at the cost of a vaguer
  refusal (`execute-failed`). Either way a plugin is a request after the shell starts, and cannot be
  in the shell's initial chunks.
- **Size.** The template's production build on this branch is 676 kB raw, 164 kB estimated
  transfer, for its initial chunks. A plugin bundling its own Angular would add its own runtime,
  per plugin; how much was not measured. A plain custom element is small: the sample is 10 kB
  unminified.
- **A sandboxed frame is a document per instance,** with its own copies of everything it loads. Not
  measured.

## 7. Developer experience

- **(a)** Full Angular, the platform's typed entry points, the generators, the customer guardrails
  and `nx serve` against a local Nuxeo. The customer keeps a fork and a CI, and rebuilds for every
  release.
- **(b)** One shell to run against. A plugin author builds a single-file custom element against a
  published plugin API: its own types package, exposing no third-party types and none of our
  internals. Development needs a local trust root, as the prototype makes per run. A development
  switch that skips the checks is the usual hole, and must not exist in a production build. A
  sandboxed plugin is debugged across a frame boundary, and talks to the shell only through the
  broker's messages.

## 8. What Nuxeo and Hyland would need to operate (b)

- **A plugin store on the server:** an add-on serving plugin bytes under one fixed path, at a URL
  per version and hash, with no redirects, `X-Content-Type-Options: nosniff`, and CORS only for the
  sandbox's site. Whether it serves after sign-in, as app definitions are (decision E), is open.
- **Pins in configuration:** the deployment's configuration package carries each plugin's id,
  version and hash, so changing a plugin is a new package version, under the package pipeline's
  versions and approval ([package-pipeline.md](../package-pipeline.md), sections 8 and 9.2).
- **Keys:** keyless signing checked at install, or keys in a KMS: a Hyland key, customer
  publisher keys enrolled per deployment, or both. Rotation needs two trusted keys at once, which the
  prototype's list of trusted keys allows; revocation needs a list or short-lived signatures.
- **Verification at install,** by Nuxeo's package manager or the store, which is the platform
  team's question (package-pipeline.md, section 9.1).
- **A page CSP for the shell,** set by Nuxeo or a proxy, and a separate site for sandboxed frames if
  they are used.
- **A review of third-party plugins, a compatibility matrix per shell release, a bill of materials
  per plugin, and a log of refusals:** every refusal has a reason a deployment can count.
- **An independent security review** before plugins go live, as the architecture's section 16
  asks, which includes the shell's sign-in and page headers as a plugin would meet them.

## 9. Evidence

- **Tests:** `npx nx test plugin-spike`, 54 tests in two files. `src/plugin-loader.spec.ts` covers
  the acceptance, each refusal with a faked host, the snapshot of the manifest, and the browser
  executor's script attributes with a fake document; `src/demo-server.spec.ts` runs the demo
  server on 127.0.0.1 and every scenario the host page runs through the real loader over HTTP.
- **The tampered-bundle refusal, seen failing with its check removed:** with the loader's hash
  comparison disabled, three tests failed: both tampered-bundle tests, and the scenario test, where
  the tampered bundle then fell through to the stand-in for the browser's check. Restored, all
  passed.
- **Every other check, seen failing the same way:** removing the signature check failed 8 tests,
  the URL prefix 7, the pin's version and hash comparison 3, the unpinned-plugin check 1, the
  line-break rule 1, the private-half rule 1, the plugin API check 1, the encoded-separator rule 3,
  the query and fragment rule 3, the credentials rule 1, the already-defined rule 1, the snapshot 1,
  and the script's `integrity` or its CORS mode 1 each.
- **`checkPluginSpikeIsolated`** in `scripts/review-guardrails.mjs` has five halves: no file
  outside the spike but Markdown and its three guards names it or links into it; no asset
  directory in `angular.json`, a `project.json`, a Storybook `main` file or a Vite config holds it;
  its project is tagged `type:spike` alone and declares no target but `test`, `lint` and
  `typecheck`; no private key is in it; and it imports nothing but its own files, Node's built-ins
  and Vitest. The last covers its `.mjs` sources, which the module-boundary rule does not read. It
  fails too when the spike is gone. Its selftest has 21 negative controls and 2 positive ones; with
  each half broken in turn, that half's controls went red.
- **`npm run beta:module-boundaries`** holds 14 forbidden imports and 7 allowed ones, 8 of the
  forbidden ones about the spike: no app, experience, feature, module, engine, shared library or
  the published package may import it, and, in the files the rule reads, it may import nothing. It
  refuses to run unless
  `tools/plugin-spike/project.json` carries exactly the probe's tags, and it asks Nx for every
  target the project resolves, the inferred ones included (8 today, all tests, lint or the type
  check). Seen red with `type:spike` added to what an app may use, with a rule letting the spike use
  shared code, with a second tag on the real project, and with a `build` target on it. An empty
  allow-list for `type:spike` stayed green, correctly: Nx 23 reports a tagged target under an empty
  list.
- **Browsers:** `node tools/plugin-spike/dev/browser-check.mjs chromium,webkit`, with Playwright
  1.64.1 from a checkout that installed it with `--no-save`, gave every scenario's outcome and the
  answers in section 4.3. It is not a gate. Firefox would not start in this environment ("Could
  not find profile folder"), so it was not run.

## 10. Recommendation

1. **Keep the template build, (a), as the route for customer code,** as decision 5 recommends, at
   least to general availability. In the page, run-time loading gives customer code the same reach
   as (a) and adds a delivery channel to defend; what it buys is upgrades without a rebuild, not
   safety.
2. **Count signed, pinned plugins as proven only when these hold,** none of which this spike
   provides:
   - a strict page CSP on the shell, served by Nuxeo or its proxy;
   - the shell's sign-in reviewed against an in-page plugin's reach (section 4.3, decision F);
   - a versioned plugin API, published as its own types package;
   - a plugin store, with pins carried in the deployment's configuration package;
   - signatures verified at install on the server, and a key and revocation policy (section 8);
   - the server's protections against requests from a sandboxed frame confirmed (question 4);
   - the independent security review of section 8.
3. **If (b) goes ahead: custom elements only,** single files or chunks each covered by an
   integrity, loaded through the loader's checks in this order, with the browser's integrity check
   at execution. Treat an in-page plugin as code as trusted as the shell, and offer in-page loading
   only to publishers the deployment trusts that far.
4. **Anything less trusted runs in a sandboxed frame,** served from a separate site, behind a broker
   that offers a short list of capabilities, each checked by the shell and by Nuxeo's permissions.
5. **Do not build run-time loading of Angular component bundles.** It ties every plugin to the
   shell's Angular build and needs a federation dependency, for less than (a) already gives.

## 11. Open questions for the decision's owners

1. Who may publish a plugin that runs in the page: Hyland only, partners, or every customer?
   The answer decides the trust root.
2. Keyless signing checked at install, or keys held in a KMS, and whose: Hyland's, each
   customer's, or a Hyland key that certifies customer keys?
3. Is decision F's token-based sign-in a prerequisite for any run-time loading?
4. Which of the server's protections against cross-site requests apply to a request from a
   sandboxed frame, whose `Origin` is `null`, given WebKit sent the `SameSite=Strict` session
   cookie with one in this spike? For the security review; not checked here.
5. Is a separate site for sandboxed plugins acceptable for on-premises deployments?
6. What does the plugin API promise across shell releases, and who tests plugins against each
   release?
7. How fast must a revoked plugin stop running everywhere, and who removes its pin?
8. Will the independent security review take this report as its starting point?
9. Is Firefox, not run here, required in the support matrix before the decision?

## 12. Not checked

- Firefox, which would not start in this environment; and Safari, or any browser on a real domain.
- An Angular Elements plugin, and a federated Angular bundle: neither `@angular/elements` nor a
  federation package is in the lockfile.
- Bundles of several chunks with import-map `integrity`.
- Trusted Types and the `Integrity-Policy` header.
- Sigstore verification in a browser.
- The server's answer to requests from an opaque origin, and a page CSP for the shell on a real
  server.
- The checks' cost in a browser, a plugin's start-up cost, and a sandboxed frame's memory.
