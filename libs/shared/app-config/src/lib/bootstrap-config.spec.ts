import { describe, expect, it } from 'vitest';

import {
  DEFAULT_APP_BOOTSTRAP_CONFIG,
  mergeBootstrapConfig,
  nuxeoOriginsOf,
  resolveBrandingLogoUrl,
  resolveTheme,
} from './bootstrap-config';

describe('branding.logo', () => {
  const logoOf = (logo: unknown) =>
    mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, { branding: { logo } }).branding.logo;

  it('ships with no logo, so the Satori marks render', () => {
    expect(DEFAULT_APP_BOOTSTRAP_CONFIG.branding.logo).toBeNull();
  });

  it.each([
    ['a file beside bootstrap.json', 'acme-logo.svg'],
    ['a relative path below it', 'brand/acme.png'],
    ['an https URL', 'https://cdn.example.com/acme.svg'],
    ['a data:image URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['an inline SVG data URI', 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['a file name with a query and a fragment', 'acme-logo.svg?v=2#mark'],
  ])('accepts %s', (_label, src) => {
    expect(logoOf({ src, alt: 'Acme' })).toEqual({ src, alt: 'Acme' });
  });

  it.each([
    ['an absolute Nuxeo REST path', '/nuxeo/api/v1/id/abc/@blob/file:content'],
    ['a protocol-relative URL', '//evil.example/logo.svg'],
    ['a parent-directory segment', '../agentic-ui/assets/logo.svg'],
    ['an encoded parent-directory segment', '%2e%2e/api/v1/me'],
    ['a mixed-case encoded parent segment', 'brand/.%2E/api/v1/me'],
    ['a backslash path', '..\\secret.svg'],
    ['an http URL', 'http://cdn.example.com/acme.svg'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a non-image data URI', 'data:text/html,<script>alert(1)</script>'],
    ['an unparseable https URL', 'https://exa mple.com/logo.svg'],
    ['a blank src', '   '],
    // These resolve to bootstrap.json itself.
    ['a query alone', '?v=1'],
    ['a fragment alone', '#logo'],
    // The URL parser deletes tabs and newlines and strips leading control characters, so each
    // of these resolves to something the string as written does not look like.
    ['a tab hidden in a parent segment', '.\t./api/v1/me'],
    ['a newline hidden in an http scheme', 'h\nttp://cdn.example/logo.svg'],
    ['a leading control character before an absolute path', '\u0001/nuxeo/api/v1/me'],
    ['an empty data:image URI', 'data:image/'],
    ['a data:image URI with no payload', 'data:image/png;base64,'],
    ['a data:image URI with no subtype', 'data:image/,iVBORw0KGgo='],
    ['a data:image URI whose payload is only a fragment', 'data:image/png,#logo'],
    ['a base64 data:image URI whose payload is only a fragment', 'data:image/png;base64,#logo'],
  ])('rejects %s and keeps the Satori marks', (_label, src) => {
    expect(logoOf({ src, alt: 'Acme' })).toBeNull();
  });

  it.each([
    ['absent', undefined],
    ['a string instead of an object', 'acme-logo.svg'],
    ['an object without src', { alt: 'Acme' }],
    ['a non-string src', { src: 42 }],
  ])('treats %s as not configured', (_label, logo) => {
    expect(logoOf(logo)).toBeNull();
  });

  it('trims src and alt, and defaults a missing or non-string alt to empty', () => {
    expect(logoOf({ src: '  acme.svg ', alt: ' Acme ' })).toEqual({ src: 'acme.svg', alt: 'Acme' });
    expect(logoOf({ src: 'acme.svg' })).toEqual({ src: 'acme.svg', alt: '' });
    expect(logoOf({ src: 'acme.svg', alt: 7 })).toEqual({ src: 'acme.svg', alt: '' });
  });

  it('keeps a logo an earlier layer set when this one omits or garbles it, and clears it on null', () => {
    const base = {
      ...DEFAULT_APP_BOOTSTRAP_CONFIG,
      branding: { ...DEFAULT_APP_BOOTSTRAP_CONFIG.branding, logo: { src: 'a.svg', alt: 'A' } },
    };

    expect(
      mergeBootstrapConfig(base, { branding: { logo: { src: '/nuxeo/api' } } }).branding.logo,
    ).toEqual({ src: 'a.svg', alt: 'A' });
    expect(
      mergeBootstrapConfig(base, { branding: { applicationTitle: 'X' } }).branding.logo,
    ).toEqual({ src: 'a.svg', alt: 'A' });
    expect(mergeBootstrapConfig(base, { branding: { logo: null } }).branding.logo).toBeNull();
  });

  it('resolves a relative src against the configuration directory, not the bundle', () => {
    const configUrl = 'https://nuxeo.example/nuxeo/agentic-ui-config/bootstrap.json';

    expect(resolveBrandingLogoUrl('acme-logo.svg', configUrl)).toBe(
      'https://nuxeo.example/nuxeo/agentic-ui-config/acme-logo.svg',
    );
    expect(resolveBrandingLogoUrl('https://cdn.example.com/a.svg', configUrl)).toBe(
      'https://cdn.example.com/a.svg',
    );
  });
});

describe('resolveBrandingLogoUrl — the check on the URL the browser loads', () => {
  const configUrl = 'https://app.example/nuxeo/agentic-ui-config/bootstrap.json';

  it('refuses a same-origin URL outside the configuration directory', () => {
    expect(
      resolveBrandingLogoUrl('https://app.example/nuxeo/api/v1/id/x/@blob/file:content', configUrl),
    ).toBeNull();
    expect(
      resolveBrandingLogoUrl(
        'https://app.example/nuxeo/agentic-ui-config/brand/acme.svg',
        configUrl,
      ),
    ).toBe('https://app.example/nuxeo/agentic-ui-config/brand/acme.svg');
  });

  it('refuses any URL on another origin that serves Nuxeo', () => {
    expect(
      resolveBrandingLogoUrl('https://api.example/static/acme.svg', configUrl, [
        'https://api.example',
      ]),
    ).toBeNull();
  });

  // Cookies are scoped by host, not by scheme or port, so these still carry the Nuxeo session.
  it('refuses another scheme or port on a host that serves Nuxeo', () => {
    expect(
      resolveBrandingLogoUrl('https://app.example:8443/nuxeo/api/v1/me', configUrl),
    ).toBeNull();
    expect(
      resolveBrandingLogoUrl('https://api.example/nuxeo/api/v1/me', configUrl, [
        'http://api.example',
      ]),
    ).toBeNull();
  });

  it('allows https on a third-party origin, and nothing else there', () => {
    expect(resolveBrandingLogoUrl('https://cdn.example/acme.svg', configUrl)).toBe(
      'https://cdn.example/acme.svg',
    );
    expect(resolveBrandingLogoUrl('http://cdn.example/acme.svg', configUrl)).toBeNull();
  });

  /**
   * NXSAT-724. The rule above is stated in terms of the host, but it compared the host as the URL
   * parser left it. The parser canonicalises case and every IPv4 form (`127.1` and `0x7f.0.0.1`
   * both become `127.0.0.1`), so those were never gaps — but it **keeps a trailing dot**, which is
   * the FQDN form of the very same host and so shares its cookie jar.
   */
  it.each([
    ['a trailing dot on the configuration host', 'https://app.example./nuxeo/api/v1/me'],
    ['a trailing dot with an explicit port', 'https://app.example.:8443/nuxeo/api/v1/me'],
    ['a trailing dot on the path of the configuration directory', 'https://app.example./x.svg'],
  ])('refuses %s', (_label, src) => {
    expect(resolveBrandingLogoUrl(src, configUrl)).toBeNull();
  });

  it('refuses a trailing dot on another configured Nuxeo origin', () => {
    expect(
      resolveBrandingLogoUrl('https://api.example./static/acme.svg', configUrl, [
        'https://api.example',
      ]),
    ).toBeNull();
  });

  /**
   * The documented side effect of normalising the host but matching the same-origin exception on
   * the origin as written: a trailing dot takes a path that really is inside the configuration
   * directory out of the exception, and the host rule then refuses it. Pinned here because the
   * extensibility contract states it, and a stated guarantee with no test is not a guarantee.
   */
  it('refuses the configuration directory itself when the host carries a trailing dot', () => {
    expect(
      resolveBrandingLogoUrl('https://app.example./nuxeo/agentic-ui-config/acme.svg', configUrl),
    ).toBeNull();
    // Written the way the application is served, the same path is accepted.
    expect(
      resolveBrandingLogoUrl('https://app.example/nuxeo/agentic-ui-config/acme.svg', configUrl),
    ).toBe('https://app.example/nuxeo/agentic-ui-config/acme.svg');
  });

  /**
   * NXSAT-724 cases B and C as reported, against a dev deployment on loopback. `localhost`,
   * `127.0.0.0/8` and `[::1]` all name this machine, so a logo at any of them reaches the same
   * server the configuration came from.
   */
  it.each([
    [
      'the host written exactly (the control, already refused)',
      'https://localhost:4200/nuxeo/icons/x.png',
    ],
    ['a trailing dot', 'https://localhost.:4200/nuxeo/icons/x.png'],
    ['the IPv4 loopback address', 'https://127.0.0.1:4200/nuxeo/icons/x.png'],
    ['a short IPv4 loopback form', 'https://127.1:4200/nuxeo/icons/x.png'],
    ['another address in 127.0.0.0/8', 'https://127.0.0.2:4200/nuxeo/icons/x.png'],
    ['the IPv6 loopback address', 'https://[::1]:4200/nuxeo/icons/x.png'],
  ])('refuses a loopback Nuxeo host written as %s', (_label, src) => {
    expect(
      resolveBrandingLogoUrl(src, 'http://localhost:4200/agentic-ui-config/bootstrap.json'),
    ).toBeNull();
  });

  it('still allows a third-party https logo when the deployment is on loopback', () => {
    expect(
      resolveBrandingLogoUrl(
        'https://cdn.example/acme.svg',
        'http://localhost:4200/agentic-ui-config/bootstrap.json',
      ),
    ).toBe('https://cdn.example/acme.svg');
  });

  // Defence in depth: these are also refused when the configuration is read, but the resolved
  // check must hold on its own.
  it.each([
    ['a tab hidden in a parent segment', '.\t./api/v1/me'],
    ['an encoded parent segment', '%2e%2e/api/v1/me'],
    ['a leading control character', '\u0001/nuxeo/api/v1/me'],
    ['a backslash traversal', '..\\..\\api\\v1\\me'],
  ])('refuses %s even when called directly', (_label, src) => {
    expect(resolveBrandingLogoUrl(src, configUrl)).toBeNull();
  });

  // Tomcat drops `;` path parameters from each segment before it collapses dot segments, so `..;x`
  // is an ordinary segment to the browser and a parent directory to the server.
  it.each([
    ['a path-parameter parent segment', '..;x/api/v1/me'],
    ['an empty path parameter', '..;/login.jsp'],
    ['an encoded parent with a path parameter', '%2e%2e;x/api/v1/me'],
    [
      'the same as an absolute https URL',
      'https://app.example/nuxeo/agentic-ui-config/..;/api/v1/me',
    ],
    ['an encoded semicolon, for a proxy that decodes first', '..%3b/api/v1/me'],
    ['an encoded slash', '..%2fapi/v1/me'],
    ['a double-encoded parent segment', '%252e%252e/api/v1/me'],
    [
      'a double-encoded parent as an absolute https URL',
      'https://app.example/nuxeo/agentic-ui-config/%252e%252e/api/v1/me',
    ],
    ['a malformed percent escape', 'acme%e0.svg'],
  ])('refuses %s on the configuration origin', (_label, src) => {
    expect(resolveBrandingLogoUrl(src, configUrl)).toBeNull();
  });

  it('still allows a file name the URL parser percent-encodes', () => {
    expect(resolveBrandingLogoUrl('Acme logo.svg', configUrl)).toBe(
      'https://app.example/nuxeo/agentic-ui-config/Acme%20logo.svg',
    );
  });

  it('refuses an unparseable URL', () => {
    expect(resolveBrandingLogoUrl('https://exa mple.com/acme.svg', configUrl)).toBeNull();
  });
});

describe('nuxeoOriginsOf', () => {
  it('collects the application, API and server origins, skipping unset and unparseable ones', () => {
    const config = {
      ...DEFAULT_APP_BOOTSTRAP_CONFIG,
      nuxeoApiOrigin: 'https://api.example',
      nuxeoServerUrl: 'https://server.example/nuxeo',
    };

    expect(nuxeoOriginsOf(config, 'https://app.example/nuxeo/agentic-ui/')).toEqual([
      'https://app.example',
      'https://api.example',
      'https://server.example',
    ]);
    expect(nuxeoOriginsOf(DEFAULT_APP_BOOTSTRAP_CONFIG, 'https://app.example/')).toEqual([
      'https://app.example',
    ]);
    expect(
      nuxeoOriginsOf(
        { ...DEFAULT_APP_BOOTSTRAP_CONFIG, nuxeoApiOrigin: 'not a url' },
        'https://a.example/',
      ),
    ).toEqual(['https://a.example']);
    expect(
      nuxeoOriginsOf(
        { ...DEFAULT_APP_BOOTSTRAP_CONFIG, nuxeoServerUrl: 'https://exa mple.com' },
        'https://a.example/',
      ),
    ).toEqual(['https://a.example']);
  });

  it('resolves protocol-relative origins against the application, as API requests do', () => {
    const config = {
      ...DEFAULT_APP_BOOTSTRAP_CONFIG,
      nuxeoApiOrigin: '//api.example',
      nuxeoServerUrl: '//server.example/nuxeo',
    };

    expect(nuxeoOriginsOf(config, 'https://app.example/')).toEqual([
      'https://app.example',
      'https://api.example',
      'https://server.example',
    ]);
  });
});

describe('mergeBootstrapConfig', () => {
  it('returns the packaged defaults when nothing is configured', () => {
    expect(mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, undefined)).toEqual(
      DEFAULT_APP_BOOTSTRAP_CONFIG,
    );
  });

  it('overlays only the keys the customer set', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      branding: { applicationTitle: 'Acme Content' },
    });

    expect(merged.branding.applicationTitle).toBe('Acme Content');
    expect(merged.branding.documentTitle).toBe(DEFAULT_APP_BOOTSTRAP_CONFIG.branding.documentTitle);
    expect(merged.aiBackendUrl).toBe(DEFAULT_APP_BOOTSTRAP_CONFIG.aiBackendUrl);
  });

  /**
   * NXSAT-722. A product name and a browser tab title are always shown to someone, so the empty
   * string is not a value a customer can mean: it is a blank tab title, and an unnamed brand link
   * where `applicationTitle` is the accessible name.
   */
  describe('blank branding titles', () => {
    const branding = (patch: Record<string, unknown>) =>
      mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, { branding: patch }).branding;
    const packaged = DEFAULT_APP_BOOTSTRAP_CONFIG.branding;

    it('keeps the packaged documentTitle for an empty string', () => {
      expect(branding({ documentTitle: '' }).documentTitle).toBe(packaged.documentTitle);
    });

    it('keeps the packaged documentTitle for a whitespace-only value', () => {
      expect(branding({ documentTitle: '   ' }).documentTitle).toBe(packaged.documentTitle);
      expect(branding({ documentTitle: '\t\n' }).documentTitle).toBe(packaged.documentTitle);
    });

    it('keeps the packaged applicationTitle for an empty or whitespace-only value', () => {
      expect(branding({ applicationTitle: '' }).applicationTitle).toBe(packaged.applicationTitle);
      expect(branding({ applicationTitle: '  ' }).applicationTitle).toBe(packaged.applicationTitle);
    });

    it('still applies a non-blank title, and one that merely has padding', () => {
      expect(branding({ documentTitle: 'Acme Portal' }).documentTitle).toBe('Acme Portal');
      expect(branding({ applicationTitle: ' Acme Insurance ' }).applicationTitle).toBe(
        ' Acme Insurance ',
      );
    });

    it('does not let a later blank fragment wipe out a title an earlier package set', () => {
      const configured = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
        branding: { documentTitle: 'Acme Portal', applicationTitle: 'Acme Insurance' },
      });

      const merged = mergeBootstrapConfig(configured, {
        branding: { documentTitle: '', applicationTitle: '   ' },
      });

      expect(merged.branding.documentTitle).toBe('Acme Portal');
      expect(merged.branding.applicationTitle).toBe('Acme Insurance');
    });

    it('leaves the logo and the other settings alone', () => {
      const merged = branding({ documentTitle: '', logo: { src: 'acme.svg', alt: 'Acme' } });

      expect(merged.logo).toEqual({ src: 'acme.svg', alt: 'Acme' });
      expect(merged.documentTitle).toBe(packaged.documentTitle);
    });
  });

  it('distinguishes an explicit null server URL from an absent one', () => {
    expect(
      mergeBootstrapConfig(
        { ...DEFAULT_APP_BOOTSTRAP_CONFIG, nuxeoServerUrl: 'https://nuxeo.example' },
        { nuxeoServerUrl: null },
      ).nuxeoServerUrl,
    ).toBeNull();

    expect(
      mergeBootstrapConfig(
        { ...DEFAULT_APP_BOOTSTRAP_CONFIG, nuxeoServerUrl: 'https://nuxeo.example' },
        {},
      ).nuxeoServerUrl,
    ).toBe('https://nuxeo.example');
  });

  it('restyles a packaged theme without restating the others', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      themes: [{ id: 'nuxeo', label: 'Acme', tokens: { '--mat-sys-primary': 'rebeccapurple' } }],
    });

    expect(merged.themes).toHaveLength(DEFAULT_APP_BOOTSTRAP_CONFIG.themes.length);
    const nuxeo = merged.themes.find((theme) => theme.id === 'nuxeo');
    expect(nuxeo?.label).toBe('Acme');
    expect(nuxeo?.tokens['--mat-sys-primary']).toBe('rebeccapurple');
    expect(merged.themes.find((theme) => theme.id === 'dark')?.label).toBe('Dark');
  });

  it('names the packaged themes by catalogue key, with the English as fallback', () => {
    for (const theme of DEFAULT_APP_BOOTSTRAP_CONFIG.themes) {
      expect(theme.labelKey, theme.id).toBe(`settings.themes.name.${theme.id}`);
    }
  });

  it('drops the packaged key when a customer relabels a theme, so their name shows as written', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      themes: [{ id: 'nuxeo', label: 'Acme' }],
    });

    const nuxeo = merged.themes.find((theme) => theme.id === 'nuxeo');
    expect(nuxeo?.label).toBe('Acme');
    expect(nuxeo?.labelKey).toBeUndefined();
    expect(merged.themes.find((theme) => theme.id === 'dark')?.labelKey).toBe(
      'settings.themes.name.dark',
    );
  });

  it('keeps the packaged key when a customer restyles a theme without renaming it', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      themes: [{ id: 'dark', tokens: { '--mat-sys-primary': 'teal' } }],
    });

    expect(merged.themes.find((theme) => theme.id === 'dark')?.labelKey).toBe(
      'settings.themes.name.dark',
    );
  });

  it('accepts a customer-supplied labelKey for their own theme', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      themes: [{ id: 'acme', label: 'Acme', labelKey: 'acme.theme' }],
    });

    expect(merged.themes.find((theme) => theme.id === 'acme')?.labelKey).toBe('acme.theme');
  });

  it('appends an entirely new theme and defaults its palette base', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      themes: [{ id: 'acme', label: 'Acme', tokens: { '--mat-sys-primary': 'teal' } }],
    });

    const acme = merged.themes.find((theme) => theme.id === 'acme');
    expect(acme?.base).toBe('nuxeo');
    expect(acme?.tokens['--mat-sys-primary']).toBe('teal');
  });

  // Error paths: a customer who saves nonsense must still get a working application.
  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['an array', [1, 2, 3]],
    ['a number', 42],
  ])('ignores a configuration document that is %s', (_label, patch) => {
    expect(mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, patch)).toEqual(
      DEFAULT_APP_BOOTSTRAP_CONFIG,
    );
  });

  it('ignores fields whose type is wrong rather than adopting them', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      nuxeoApiOrigin: 12,
      aiBackendUrl: { url: '/nuxeo' },
      availableLanguages: 'en',
      themes: 'all of them',
      branding: 'Acme',
    });

    expect(merged).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG);
  });

  it('drops theme entries with no usable id and non-string token values', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      themes: [
        { label: 'no id at all' },
        { id: '   ' },
        'not an object',
        { id: 'acme', tokens: { '--good': 'red', '--bad': { nested: true } } },
      ],
    });

    expect(merged.themes.map((theme) => theme.id)).toEqual([
      'nuxeo',
      'dark',
      'kawaii',
      'light',
      'acme',
    ]);
    expect(merged.themes.find((theme) => theme.id === 'acme')?.tokens).toEqual({ '--good': 'red' });
  });

  it('overlays only the integration operations the customer renamed', () => {
    const base = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: {
        knowledgeDiscoveryOperations: { getAllAgents: 'Acme.Agents', invoke: 'Acme.Invoke' },
      },
    });
    const merged = mergeBootstrapConfig(base, {
      integrations: { knowledgeDiscoveryOperations: { invoke: 'Acme.Invoke2' } },
    });

    expect(merged.integrations.knowledgeDiscoveryOperations).toEqual({
      getAllAgents: 'Acme.Agents',
      invoke: 'Acme.Invoke2',
    });
  });

  it('reads both ARender endpoints together', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: {
        arender: {
          viewerOrigin: 'https://arender.example',
          nuxeoInternalUrl: 'http://nuxeo/nuxeo',
        },
      },
    });

    expect(merged.integrations.arender).toEqual({
      viewerOrigin: 'https://arender.example',
      nuxeoInternalUrl: 'http://nuxeo/nuxeo',
    });
  });

  // Only `viewerOrigin` is required. A blank one is worse than `null`, because `fetch('')` resolves
  // against the application's own origin, so an availability probe reports a viewer that is not
  // deployed and that origin lands on the allow-list the server-supplied URL is checked against.
  it.each([
    ['only nuxeoInternalUrl', { nuxeoInternalUrl: 'http://nuxeo/nuxeo' }],
    ['a blank viewerOrigin', { viewerOrigin: '   ', nuxeoInternalUrl: 'http://nuxeo/nuxeo' }],
    ['neither endpoint', {}],
  ])('yields null for a manifest naming %s', (_label, arender) => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: { arender },
    });

    expect(merged.integrations.arender).toBeNull();
  });

  // `nuxeoInternalUrl` is vestigial under NEV 2026 — the connector resolves blobs itself from
  // `documentId` over OAuth2, so nothing reads it. Requiring it would force a deployment that
  // retired the nginx sidecar to invent a dummy value, or be silently left without a viewer.
  it.each([
    ['only viewerOrigin', { viewerOrigin: 'https://arender.example' }],
    ['a blank nuxeoInternalUrl', { viewerOrigin: 'https://arender.example', nuxeoInternalUrl: '' }],
  ])('configures the integration from %s alone', (_label, arender) => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: { arender },
    });

    expect(merged.integrations.arender?.viewerOrigin).toBe('https://arender.example');
  });

  it('lets an explicit null turn a configured integration off', () => {
    // `isRecord(null)` is false, so this used to fall through to the base and preserve the old
    // configuration — a higher-priority manifest could reconfigure ARender but never disable it,
    // which contradicts `null` meaning "no annotation viewer".
    const complete = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: {
        arender: { viewerOrigin: 'https://a.example', nuxeoInternalUrl: 'http://nuxeo/nuxeo' },
      },
    });

    const disabled = mergeBootstrapConfig(complete, { integrations: { arender: null } });

    expect(complete.integrations.arender).not.toBeNull();
    expect(disabled.integrations.arender).toBeNull();
  });

  it('leaves a configured integration alone when the key is absent', () => {
    // The counterpart: absent must not mean disabled, or every partial manifest would wipe it.
    const complete = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: {
        arender: { viewerOrigin: 'https://a.example', nuxeoInternalUrl: 'http://nuxeo/nuxeo' },
      },
    });

    const untouched = mergeBootstrapConfig(complete, { integrations: {} });

    expect(untouched.integrations.arender).toEqual(complete.integrations.arender);
  });

  it('lets a partial override merge over an already-complete configuration', () => {
    // It is the *result* that must be complete, not the patch. A deployment overriding only the
    // viewer origin on top of a complete base is a legitimate manifest, not a half configuration.
    const complete = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: {
        arender: { viewerOrigin: 'https://a.example', nuxeoInternalUrl: 'http://nuxeo/nuxeo' },
      },
    });

    const patched = mergeBootstrapConfig(complete, {
      integrations: { arender: { viewerOrigin: 'https://b.example' } },
    });

    expect(patched.integrations.arender).toEqual({
      viewerOrigin: 'https://b.example',
      nuxeoInternalUrl: 'http://nuxeo/nuxeo',
    });
  });

  it('reads session timings and rejects nonsensical ones', () => {
    expect(
      mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
        session: { idleTimeoutMs: 60_000, warningBeforeMs: 5_000 },
      }).session,
    ).toEqual({ idleTimeoutMs: 60_000, warningBeforeMs: 5_000 });

    expect(
      mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
        session: { idleTimeoutMs: -1, warningBeforeMs: 'soon' },
      }).session,
    ).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG.session);
  });

  it('keeps only SSO endpoints that can actually be navigated to', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      sso: {
        endpoints: [
          { id: 'azure', label: 'Azure AD', path: '/nuxeo/oauth2/authorization/azure' },
          { id: 'no-path' },
          { path: '/nuxeo/no-id' },
          { id: 'relative', path: 'nuxeo/relative' },
          { id: 'unlabelled', path: '/nuxeo/unlabelled' },
        ],
        postLoginPath: '/browse',
      },
    });

    expect(merged.sso.endpoints).toEqual([
      { id: 'azure', label: 'Azure AD', path: '/nuxeo/oauth2/authorization/azure' },
      { id: 'unlabelled', label: 'unlabelled', path: '/nuxeo/unlabelled' },
    ]);
    expect(merged.sso.postLoginPath).toBe('/browse');
    expect(merged.sso.returnQueryParam).toBe(DEFAULT_APP_BOOTSTRAP_CONFIG.sso.returnQueryParam);
  });

  it('lets a customer turn every SSO button off', () => {
    expect(
      mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, { sso: { endpoints: [] } }).sso.endpoints,
    ).toEqual([]);
  });

  it('ignores integration, session and SSO sections of the wrong shape', () => {
    const merged = mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, {
      integrations: 'arender',
      session: 30,
      sso: ['azure'],
    });

    expect(merged.integrations).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG.integrations);
    expect(merged.session).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG.session);
    expect(merged.sso).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG.sso);
  });

  it('falls back to the packaged languages when the configured list is empty', () => {
    expect(
      mergeBootstrapConfig(DEFAULT_APP_BOOTSTRAP_CONFIG, { availableLanguages: [] })
        .availableLanguages,
    ).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages);
  });
});

describe('resolveTheme', () => {
  it('returns the requested theme', () => {
    expect(resolveTheme(DEFAULT_APP_BOOTSTRAP_CONFIG, 'kawaii').id).toBe('kawaii');
  });

  it('falls back to the configured default for an unknown or absent id', () => {
    expect(resolveTheme(DEFAULT_APP_BOOTSTRAP_CONFIG, 'no-such-theme').id).toBe('nuxeo');
    expect(resolveTheme(DEFAULT_APP_BOOTSTRAP_CONFIG, null).id).toBe('nuxeo');
  });

  it('falls back to the first theme when the configured default does not exist', () => {
    const config = { ...DEFAULT_APP_BOOTSTRAP_CONFIG, defaultThemeId: 'missing' };
    expect(resolveTheme(config, null).id).toBe('nuxeo');
  });

  it('never returns undefined, even for an empty theme list', () => {
    const config = { ...DEFAULT_APP_BOOTSTRAP_CONFIG, themes: [] };
    expect(resolveTheme(config, 'anything').id).toBe('nuxeo');
  });
});
