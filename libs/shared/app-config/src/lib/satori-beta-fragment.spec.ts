import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_BOOTSTRAP_CONFIG, mergeBootstrapConfig } from './bootstrap-config';

/**
 * The hosted Beta's own configuration package, read through the merge the browser performs.
 *
 * The Beta served `/nuxeo/agentic-ui-config/bootstrap.json` with one fragment — our `defaults` —
 * for as long as no package was installed, and `bootstrap.defaults.json` has no `integrations` key
 * at all. So `ARENDER_CONFIG` kept its compiled-in `null` and the Annotations tab showed
 * "Annotations are not available for this document" while a healthy Nuxeo Enhanced Viewer was
 * deployed beside it. Everything else about that deployment was verified working; the viewer's
 * origin had simply never been contributed to the browser (NXSAT-301).
 *
 * This asserts the thing that was missing, not that the file exists: the fragment is merged by
 * `mergeBootstrapConfig`, the function the application itself uses, and the result must be an
 * enabled ARender configuration naming the deployed viewer. A fragment that is absent, names
 * another host, or puts the key anywhere the merge does not read fails here.
 *
 * `shared-app-config`'s `test` target names this file in its `inputs`, as it does the generator's
 * schema templates: there is no import edge to a JSON file read by path, so without that an edit
 * to the fragment would not select this target under `nx affected`.
 */
const FRAGMENT = resolve(
  __dirname,
  '../../../../../config-packages/satori-beta/bundle/agentic-ui-config/bootstrap.json',
);

/** The Nuxeo Enhanced Viewer deployed for the Beta. Changing the deployment changes both. */
const NEV_ORIGIN = 'https://nev-satori.beta.nuxeocloud.com';

describe("the satori-beta package's bootstrap fragment", () => {
  const fragment = JSON.parse(readFileSync(FRAGMENT, 'utf8')) as Record<string, unknown>;

  it('turns the annotation viewer on, which the packaged defaults leave off', () => {
    // The premise. If a later change gave the compiled defaults an ARender configuration, this
    // test would pass while asserting nothing about the fragment.
    expect(DEFAULT_APP_BOOTSTRAP_CONFIG.integrations.arender).toBeNull();

    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, fragment);

    expect(merged.integrations.arender).not.toBeNull();
    expect(merged.integrations.arender?.viewerOrigin).toBe(NEV_ORIGIN);
  });

  it('names the viewer as an origin ARenderService will accept', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, fragment);
    const url = new URL(merged.integrations.arender?.viewerOrigin ?? '');

    // `ARenderService` refuses a base carrying any of these, because the origin comparison it
    // performs on the server-supplied previewer URL discards them while still reporting a match —
    // so their effect would otherwise be invisible. `https:` because the Beta is served over it,
    // and a plaintext viewer framed in a secure page is the downgrade the rule exists to stop.
    expect(url.protocol).toBe('https:');
    expect([url.search, url.hash, url.username, url.password]).toEqual(['', '', '', '']);
    expect(url.pathname).toBe('/');
  });

  it('sets only keys the application actually reads, so a typo cannot be silent', () => {
    // This assertion used to be `toEqual(['integrations'])` — the fragment set the one deployment
    // fact and nothing else, because `branding` would then have been an accidental side effect of
    // enabling the viewer. The package now carries a deliberate customisation set for the hosted
    // Beta, so that guard no longer describes it.
    //
    // What is still worth guarding is the failure it was really protecting against: a key nothing
    // reads. `mergeBootstrapConfig` ignores an unknown top-level key silently, so a typo —
    // `brandings`, `sessions` — is invisible at runtime and looks like a customisation that did
    // not work. Every key here must be one the merge reads, or `presales`, which is read
    // separately by `readPresales` and so is absent from the merged shape.
    const presentKeys = Object.keys(fragment).filter((key) => key !== '$schema');
    const readKeys = [...Object.keys(DEFAULT_APP_BOOTSTRAP_CONFIG), 'presales'];

    expect(presentKeys.filter((key) => !readKeys.includes(key))).toEqual([]);
  });

  it('still carries the ARender deployment fact alongside the customisations', () => {
    // The customisation set must not displace the one key this package originally existed for.
    // Asserted on the raw fragment as well as the merge above, so a `branding` block that
    // accidentally swallowed `integrations` fails here rather than in the Annotations tab.
    expect(fragment['integrations']).toEqual({ arender: { viewerOrigin: NEV_ORIGIN } });
  });
});
