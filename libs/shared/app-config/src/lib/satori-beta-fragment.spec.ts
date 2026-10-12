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

  it('overrides nothing else, so the Beta keeps Satori’s own branding and navigation', () => {
    // A configuration package is where a deployment fact goes, and this deployment has exactly
    // one. The generator's starter fragment sets `branding`; shipping that would have renamed the
    // application as a side effect of enabling the viewer.
    expect(Object.keys(fragment).filter((key) => key !== '$schema')).toEqual(['integrations']);
    expect(fragment['integrations']).toEqual({ arender: { viewerOrigin: NEV_ORIGIN } });
  });
});
