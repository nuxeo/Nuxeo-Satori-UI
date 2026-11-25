# Plugin spike, for decision 5

A prototype that informs decision 5 ([the decision log](../../docs/business-apps/decisions.md)):
a host page that loads a sample custom element at run time only when it is signed by a trusted
key, pinned by the deployment, and its bytes match the signed hash, and that shows what the
element can and cannot reach. **The report is
[docs/business-apps/spikes/plugins-decision-5.md](../../docs/business-apps/spikes/plugins-decision-5.md).**

**It ships nothing.** No app imports it, no library exports it and nothing builds it. Two checks
fail if that changes: `checkPluginSpikeIsolated` in `scripts/review-guardrails.mjs`, and the
`type:spike` probes in `scripts/beta-harness/module-boundaries.mjs`. Its project has no `build`
target on purpose, and it imports nothing but its own files, Node's built-ins, Vitest, and
Playwright in the optional browser check.

**No key here is trusted anywhere.** The tests and the demo server generate their keys in memory
when they start, and none is ever written to disk. `checkPluginSpikeIsolated` fails on key
material in this directory. Every session value on the host page is a planted fake starting
`FAKE-`.

| Path                      | What it is                                                            |
| ------------------------- | --------------------------------------------------------------------- |
| `src/plugin-loader.mjs`   | The loader: the checks, in order, and the browser's half of the host  |
| `sample/sample-plugin.js` | The sample plugin, a custom element that probes what it can reach     |
| `host/`                   | The host page, and the page of the sandboxed iframe                   |
| `dev/sign.mjs`            | Makes a key and signs a manifest, for the tests and the demo only     |
| `dev/demo.mjs`            | The nine scenarios: one good plugin, and the ways of getting it wrong |
| `dev/serve.mjs`           | The demo server, on 127.0.0.1, with the page's CSP                    |
| `dev/browser-check.mjs`   | The host page in real browsers. Needs Playwright; not a gate          |
| `dev/measure.mjs`         | What the checks cost, by bundle size, in Node; not a gate             |

```bash
npx nx test plugin-spike                                # 74 tests, in Node
node tools/plugin-spike/dev/serve.mjs                   # then open http://127.0.0.1:4410/
node tools/plugin-spike/dev/browser-check.mjs chromium,webkit
```

The sources are plain ES modules with JSDoc types, because the host page loads them in a browser
as they are; `npx nx typecheck plugin-spike` checks them.
