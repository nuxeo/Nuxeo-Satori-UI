import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AppConfigService, CONFIG_LOAD_TIMEOUT_MS } from './app-config.service';
import { APP_BOOTSTRAP_CONFIG_URL } from './app-config.tokens';
import { DEFAULT_APP_BOOTSTRAP_CONFIG } from './bootstrap-config';
import { APP_CONFIG_FORMAT } from './config-response';
import { PRESET_STORAGE_KEY } from './presales-presets';
import { DEFAULT_APP_RUNTIME_MANIFEST } from './runtime-manifest';

const BOOTSTRAP_URL = '/agentic-ui-config/bootstrap.json';
const MANIFEST_URL = '/agentic-ui-config/manifest.json';

type Fragment = { name: string; component?: string; content: unknown };

function envelope(
  layer: 'bootstrap' | 'manifest',
  fragments: Fragment[],
  diagnostics: unknown[] = [],
) {
  return {
    format: APP_CONFIG_FORMAT,
    layer,
    fragments: fragments.map(({ name, component = 'com.acme.config', content }) => ({
      name,
      component,
      bundle: component,
      source: `agentic-ui-config/${name}.json`,
      content,
    })),
    diagnostics,
  };
}

const OURS = { name: 'defaults', component: 'org.nuxeo.agentic.ui.config.defaults' };

/** The presales package of the preset tests: two presets, switching as given. */
function presales(presetSwitching: boolean) {
  return {
    ...OURS,
    content: {
      branding: { applicationTitle: 'Demo' },
      presales: {
        presetSwitching,
        presets: {
          acme: {
            label: 'Acme Insurance',
            bootstrap: { branding: { applicationTitle: 'Acme Insurance' } },
            manifest: { labels: { 'app.navbar.browse': 'Claims' } },
          },
          globex: { bootstrap: { branding: { applicationTitle: 'Globex' } } },
        },
      },
    },
  };
}

describe('AppConfigService and the host application’s interceptors', () => {
  it('sends the configuration requests without them', async () => {
    const seen: string[] = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withXhr(),
          withInterceptors([
            (request, next) => {
              seen.push(request.url);
              return next(request.clone({ setHeaders: { 'X-Added-By-Interceptor': 'yes' } }));
            },
          ]),
        ),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: BOOTSTRAP_URL },
      ],
    });
    const service = TestBed.inject(AppConfigService);
    const http = TestBed.inject(HttpTestingController);

    const loaded = service.load();
    const requests = [http.expectOne(BOOTSTRAP_URL), http.expectOne(MANIFEST_URL)];
    expect(seen).toEqual([]);
    expect(requests.some((request) => request.request.headers.has('X-Added-By-Interceptor'))).toBe(
      false,
    );
    requests[0].flush(envelope('bootstrap', []));
    requests[1].flush(envelope('manifest', []));
    await loaded;
    http.verify();
  });
});

describe('AppConfigService', () => {
  let service: AppConfigService;
  let http: HttpTestingController;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.history.replaceState({}, '', '/');
    localStorage.removeItem(PRESET_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: BOOTSTRAP_URL },
      ],
    });
    service = TestBed.inject(AppConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    warn.mockRestore();
    window.history.replaceState({}, '', '/');
    localStorage.removeItem(PRESET_STORAGE_KEY);
  });

  /** Run `load()` against the two responses given; `null` answers 404. */
  async function load(
    bootstrap: object | null,
    manifest: object | null = envelope('manifest', []),
  ) {
    const loaded = service.load();
    for (const [url, body] of [
      [BOOTSTRAP_URL, bootstrap],
      [MANIFEST_URL, manifest],
    ] as const) {
      const request = http.expectOne(url);
      if (body === null) request.flush('', { status: 404, statusText: 'Not Found' });
      else request.flush(body);
    }
    await loaded;
  }

  it('starts on the packaged defaults before anything is loaded', () => {
    expect(service.bootstrap()).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG);
    expect(service.manifest()).toEqual(DEFAULT_APP_RUNTIME_MANIFEST);
    expect(service.diagnostics().bootstrapSource).toBe('packaged-default');
    expect(service.activePreset()).toBeNull();
  });

  describe('load', () => {
    it('fetches both halves from the configuration service, and nothing else', async () => {
      const loaded = service.load();
      const requests = [http.expectOne(BOOTSTRAP_URL), http.expectOne(MANIFEST_URL)];
      expect(requests.map((request) => request.request.method)).toEqual(['GET', 'GET']);
      expect(requests.every((request) => !request.request.headers.has('Authorization'))).toBe(true);
      requests[0].flush(envelope('bootstrap', []));
      requests[1].flush(envelope('manifest', []));
      await loaded;
      http.expectNone(() => true);
    });

    it('loads once: a second call shares the first load rather than fetching again', async () => {
      const first = service.load();
      const second = service.load();
      expect(second).toBe(first);
      http
        .expectOne(BOOTSTRAP_URL)
        .flush(
          envelope('bootstrap', [
            { name: 'acme', content: { branding: { applicationTitle: 'Acme' } } },
          ]),
        );
      http.expectOne(MANIFEST_URL).flush(envelope('manifest', []));
      await second;

      expect(service.bootstrap().branding.applicationTitle).toBe('Acme');
      await service.load();
      http.expectNone(() => true);
    });

    it('applies bootstrap fragments in order, a later package winning key by key', async () => {
      await load(
        envelope('bootstrap', [
          {
            ...OURS,
            content: { branding: { applicationTitle: 'Hyland Nuxeo' }, defaultLanguage: 'en' },
          },
          { name: 'acme', content: { branding: { applicationTitle: 'Acme Insurance' } } },
          { name: 'regional', component: 'com.acme.regional', content: { defaultLanguage: 'fr' } },
        ]),
      );

      expect(service.bootstrap().branding.applicationTitle).toBe('Acme Insurance');
      expect(service.bootstrap().branding.documentTitle).toBe(
        DEFAULT_APP_BOOTSTRAP_CONFIG.branding.documentTitle,
      );
      expect(service.bootstrap().defaultLanguage).toBe('fr');
      expect(service.diagnostics().bootstrapSource).toBe('configuration-service');
      expect(
        service.diagnostics().bootstrapFragments.map((f) => `${f.component}/${f.name}`),
      ).toEqual([
        'org.nuxeo.agentic.ui.config.defaults/defaults',
        'com.acme.config/acme',
        'com.acme.regional/regional',
      ]);
    });

    it('applies manifest fragments in order and keeps each extension layer', async () => {
      await load(
        envelope('bootstrap', []),
        envelope('manifest', [
          { ...OURS, content: { version: 1, labels: { a: 'ours', b: 'ours' } } },
          { name: 'acme', content: { labels: { a: 'acme' }, extensions: { $name: 'acme' } } },
          {
            name: 'regional',
            content: { featureToggles: { x: true }, extensions: { $name: 'regional' } },
          },
        ]),
      );

      expect(service.manifest().labels).toEqual({ a: 'acme', b: 'ours' });
      expect(service.manifest().featureToggles).toEqual({ x: true });
      expect(service.manifest().extensionLayers).toEqual([
        { $name: 'acme' },
        { $name: 'regional' },
      ]);
      expect(service.diagnostics().manifestSource).toBe('configuration-service');
    });

    it('passes the server diagnostics through', async () => {
      const kept = {
        level: 'warning',
        code: 'kept',
        message: 'acme stays',
        component: 'com.acme.config',
      };
      await load(envelope('bootstrap', [], [kept]));

      expect(service.diagnostics().serverDiagnostics).toEqual([kept]);
      expect(warn).toHaveBeenCalledWith(
        '[agentic-ui-config] server warning kept (com.acme.config): acme stays',
      );
    });

    it('falls back to the packaged defaults when the service is absent, and says so', async () => {
      await load(null, null);

      expect(service.bootstrap()).toEqual(DEFAULT_APP_BOOTSTRAP_CONFIG);
      expect(service.manifest()).toEqual(DEFAULT_APP_RUNTIME_MANIFEST);
      expect(service.diagnostics().bootstrapSource).toBe('packaged-default');
      expect(service.diagnostics().messages).toEqual([
        `bootstrap configuration not loaded from ${BOOTSTRAP_URL}: HTTP 404`,
        `manifest configuration not loaded from ${MANIFEST_URL}: HTTP 404`,
      ]);
      expect(warn.mock.calls.map(([line]) => line)).toEqual(
        service.diagnostics().messages.map((message) => `[agentic-ui-config] ${message}`),
      );
    });

    it('refuses a bare configuration object, which nothing on the server serves', async () => {
      await load({ branding: { applicationTitle: 'Edited on the server' } });

      expect(service.bootstrap().branding.applicationTitle).toBe(
        DEFAULT_APP_BOOTSTRAP_CONFIG.branding.applicationTitle,
      );
      expect(service.diagnostics().messages[0]).toContain(`not a ${APP_CONFIG_FORMAT} response`);
    });

    it('refuses a response for the other layer', async () => {
      await load(envelope('manifest', [{ name: 'x', content: { labels: { a: 'b' } } }]));

      expect(service.diagnostics().bootstrapSource).toBe('packaged-default');
      expect(service.diagnostics().messages[0]).toContain('expected layer "bootstrap"');
    });

    it('refuses an envelope whose fragments or diagnostics are not lists, and says so', async () => {
      await load(
        { ...envelope('bootstrap', []), fragments: { acme: {} } },
        { ...envelope('manifest', []), diagnostics: undefined },
      );

      expect(service.diagnostics().bootstrapSource).toBe('packaged-default');
      expect(service.diagnostics().manifestSource).toBe('packaged-default');
      expect(service.diagnostics().messages).toEqual([
        `bootstrap configuration from ${BOOTSTRAP_URL} ignored: fragments and diagnostics must both be lists`,
        `manifest configuration from ${MANIFEST_URL} ignored: fragments and diagnostics must both be lists`,
      ]);
    });

    it('reports why a 200 response did not parse, not its status', async () => {
      const loaded = service.load();
      http
        .expectOne(BOOTSTRAP_URL)
        .error(new ProgressEvent('error'), { status: 200, statusText: 'OK' });
      http.expectOne(MANIFEST_URL).flush(envelope('manifest', []));
      await loaded;

      expect(service.diagnostics().messages).toEqual([
        `bootstrap configuration not loaded from ${BOOTSTRAP_URL}: Http failure during parsing for ${BOOTSTRAP_URL}`,
      ]);
    });

    it('starts on the packaged defaults when a request never answers, and says so', async () => {
      vi.useFakeTimers();
      try {
        let settled = false;
        const loaded = service.load().then(() => (settled = true));
        const bootstrap = http.expectOne(BOOTSTRAP_URL);
        http.expectOne(MANIFEST_URL).flush(envelope('manifest', []));

        await vi.advanceTimersByTimeAsync(CONFIG_LOAD_TIMEOUT_MS);

        expect(settled).toBe(true);
        await loaded;
        expect(bootstrap.cancelled).toBe(true);
        expect(service.diagnostics().bootstrapSource).toBe('packaged-default');
        expect(service.diagnostics().manifestSource).toBe('configuration-service');
        expect(service.diagnostics().messages).toEqual([
          `bootstrap configuration not loaded from ${BOOTSTRAP_URL}: no response within 10 s`,
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('never rejects, so it is safe as an APP_INITIALIZER', async () => {
      const loaded = service.load();
      http.expectOne(BOOTSTRAP_URL).error(new ProgressEvent('error'));
      http.expectOne(MANIFEST_URL).flush('boom', { status: 500, statusText: 'Server Error' });

      await expect(loaded).resolves.toBeUndefined();
      expect(service.diagnostics().messages).toHaveLength(2);
    });
  });

  describe('presets', () => {
    it('applies the preset named in the URL over every package, and remembers it', async () => {
      window.history.replaceState({}, '', '/?preset=acme');
      await load(envelope('bootstrap', [presales(true)]));

      expect(service.bootstrap().branding.applicationTitle).toBe('Acme Insurance');
      expect(service.manifest().labels['app.navbar.browse']).toBe('Claims');
      expect(service.activePreset()).toEqual({ name: 'acme', label: 'Acme Insurance' });
      expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBe('acme');
    });

    it('reads the parameter from the hash query too, as hash routing puts it there', async () => {
      window.history.replaceState({}, '', '/#/browse?preset=globex');
      await load(envelope('bootstrap', [presales(true)]));

      expect(service.activePreset()).toEqual({ name: 'globex', label: 'globex' });
      expect(service.bootstrap().branding.applicationTitle).toBe('Globex');
    });

    it('uses the remembered preset when the URL names none', async () => {
      localStorage.setItem(PRESET_STORAGE_KEY, 'acme');
      await load(envelope('bootstrap', [presales(true)]));

      expect(service.activePreset()?.name).toBe('acme');
    });

    it('clears the remembered preset with an empty parameter', async () => {
      localStorage.setItem(PRESET_STORAGE_KEY, 'acme');
      window.history.replaceState({}, '', '/?preset=');
      await load(envelope('bootstrap', [presales(true)]));

      expect(service.activePreset()).toBeNull();
      expect(service.bootstrap().branding.applicationTitle).toBe('Demo');
      expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBeNull();
    });

    it('does nothing unless a package enables switching, whatever the URL or storage say', async () => {
      localStorage.setItem(PRESET_STORAGE_KEY, 'globex');
      window.history.replaceState({}, '', '/?preset=acme');
      await load(envelope('bootstrap', [presales(false)]));

      expect(service.activePreset()).toBeNull();
      expect(service.bootstrap().branding.applicationTitle).toBe('Demo');
      expect(service.manifest().labels).toEqual({});
      expect(service.diagnostics().messages).toEqual([
        'preset "acme" ignored: preset switching is not enabled',
      ]);
    });

    it('says so when switching is off and only the stored choice names a preset', async () => {
      localStorage.setItem(PRESET_STORAGE_KEY, 'globex');
      await load(envelope('bootstrap', [presales(false)]));

      expect(service.activePreset()).toBeNull();
      expect(service.diagnostics().messages).toEqual([
        'preset "globex" ignored: preset switching is not enabled',
      ]);
      expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBe('globex');
    });

    it('lets a later package turn switching off', async () => {
      window.history.replaceState({}, '', '/?preset=acme');
      await load(
        envelope('bootstrap', [
          presales(true),
          { name: 'customer', content: { presales: { presetSwitching: false } } },
        ]),
      );

      expect(service.activePreset()).toBeNull();
    });

    it('reports and forgets a preset no package defines', async () => {
      window.history.replaceState({}, '', '/?preset=initech');
      await load(envelope('bootstrap', [presales(true)]));

      expect(service.activePreset()).toBeNull();
      expect(service.diagnostics().messages).toEqual([
        'preset "initech" is not defined by any package',
      ]);
      expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBeNull();
    });

    it.each(['toString', 'constructor', '__proto__'])(
      'treats %s as an unknown preset, not a property every object has',
      async (name) => {
        window.history.replaceState({}, '', `/?preset=${name}`);
        await load(envelope('bootstrap', [presales(true)]));

        expect(service.activePreset()).toBeNull();
        expect(service.diagnostics().messages).toEqual([
          `preset "${name}" is not defined by any package`,
        ]);
        expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBeNull();
      },
    );
  });

  describe('brandingLogo', () => {
    it('is null until a logo is configured, so the Satori marks render', () => {
      expect(service.brandingLogo()).toBeNull();
    });

    it('resolves a relative src against the configuration directory, where assets are served', async () => {
      await load(
        envelope('bootstrap', [
          {
            name: 'acme',
            content: { branding: { logo: { src: 'assets/acme-logo.svg', alt: 'Acme' } } },
          },
        ]),
      );

      const expected = new URL('/agentic-ui-config/assets/acme-logo.svg', document.baseURI).href;
      expect(service.brandingLogo()).toEqual({ url: expected, alt: 'Acme' });
    });
  });

  /**
   * NXSAT-721. Every check before this one runs before the image is requested, so only the element
   * that loaded it can say whether the browser could show it.
   */
  describe('reportBrandingLogoUnavailable', () => {
    const logoUrl = () => new URL('/agentic-ui-config/assets/acme-logo.svg', document.baseURI).href;

    async function loadWithLogo() {
      await load(
        envelope('bootstrap', [
          {
            name: 'acme',
            content: { branding: { logo: { src: 'assets/acme-logo.svg', alt: 'Acme' } } },
          },
        ]),
      );
    }

    it('clears the logo, so both brand surfaces fall back to the Satori marks', async () => {
      await loadWithLogo();
      expect(service.brandingLogo()).not.toBeNull();

      service.reportBrandingLogoUnavailable(logoUrl(), 'the image could not be loaded');

      expect(service.brandingLogo()).toBeNull();
    });

    it('records one diagnostic naming the failing address, and logs it', async () => {
      await loadWithLogo();
      const before = service.diagnostics().messages.length;

      service.reportBrandingLogoUnavailable(logoUrl(), 'the image could not be loaded');

      const added = service.diagnostics().messages.slice(before);
      expect(added).toHaveLength(1);
      expect(added[0]).toContain(logoUrl());
      expect(added[0]).toContain('the image could not be loaded');
      expect(warn).toHaveBeenCalledWith(`[agentic-ui-config] ${added[0]}`);
    });

    it('reports a given URL once, however many surfaces show it', async () => {
      await loadWithLogo();
      const before = service.diagnostics().messages.length;

      service.reportBrandingLogoUnavailable(logoUrl(), 'the image could not be loaded');
      service.reportBrandingLogoUnavailable(logoUrl(), 'the image could not be loaded');

      expect(service.diagnostics().messages.slice(before)).toHaveLength(1);
    });

    it('ignores an empty URL rather than disabling a logo it cannot name', async () => {
      await loadWithLogo();
      const before = service.diagnostics().messages.length;

      service.reportBrandingLogoUnavailable('', 'the image could not be loaded');

      expect(service.brandingLogo()).not.toBeNull();
      expect(service.diagnostics().messages.slice(before)).toHaveLength(0);
    });

    it('leaves a logo configured at a different address alone, so a later one gets its chance', () => {
      service.reportBrandingLogoUnavailable(
        new URL('/agentic-ui-config/assets/old-logo.svg', document.baseURI).href,
        'the image could not be loaded',
      );

      return loadWithLogo().then(() => {
        expect(service.brandingLogo()).toEqual({ url: logoUrl(), alt: 'Acme' });
      });
    });
  });

  /**
   * NXSAT-724. A refused `logo.src` kept the packaged mark, which is correct, and said nothing at
   * all — so a typo was indistinguishable from configuring no logo. Each case here is one the
   * ticket reports.
   */
  describe('a refused branding.logo is reported', () => {
    async function loadWithSrc(src: string, component = 'com.acme.branding') {
      await load(
        envelope('bootstrap', [
          { name: 'acme', component, content: { branding: { logo: { src, alt: 'Acme' } } } },
        ]),
      );
    }

    /** The messages this load recorded that are about `branding.logo`. */
    const logoMessages = () =>
      service.diagnostics().messages.filter((message) => message.includes('branding.logo'));

    it.each([
      ['a parent-directory segment', '../x.svg', 'parent-directory segment'],
      ['a javascript: URL', 'javascript:alert(1)', 'must use https:'],
      ['an http: URL', 'http://example.com/l.svg', 'must use https:'],
      ['an absolute path', '/nuxeo/api/v1/me', 'absolute path is not allowed'],
      ['a backslash', 'a\\b.svg', 'backslash or a control character'],
      ['a query with no path', '?v=2', 'no path'],
      ['a data: URI that is not an image', 'data:text/html,<b>x', 'not an image'],
    ])('reports %s, naming the value and the reason', async (_label, src, expected) => {
      await loadWithSrc(src);

      const messages = logoMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(src);
      expect(messages[0]).toContain('com.acme.branding');
      expect(messages[0]).toContain(expected);
      expect(warn).toHaveBeenCalledWith(`[agentic-ui-config] ${messages[0]}`);
      expect(service.brandingLogo()).toBeNull();
    });

    it('reports a logo on a Nuxeo host, including the trailing-dot and loopback spellings', async () => {
      // BOOTSTRAP_URL is served from this document's origin, so the configuration host is the
      // one the test page runs on — the same situation as the dev server in the ticket.
      const host = new URL(document.baseURI).hostname;
      await loadWithSrc(`https://${host}./nuxeo/icons/x.png`);

      const messages = logoMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('serves Nuxeo');
      expect(service.brandingLogo()).toBeNull();
    });

    it('says nothing when the logo is accepted', async () => {
      await loadWithSrc('assets/acme-logo.svg');

      expect(logoMessages()).toEqual([]);
      expect(service.brandingLogo()).not.toBeNull();
    });

    it('names each contributing package when more than one logo is refused', async () => {
      await load(
        envelope('bootstrap', [
          {
            name: 'one',
            component: 'com.one',
            content: { branding: { logo: { src: '../a.svg', alt: 'A' } } },
          },
          {
            name: 'two',
            component: 'com.two',
            content: { branding: { logo: { src: 'http://two.example/b.svg', alt: 'B' } } },
          },
        ]),
      );

      const messages = logoMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('com.one');
      expect(messages[1]).toContain('com.two');
    });

    it('reports once per load, not once per read of the logo', async () => {
      await loadWithSrc('../x.svg');
      service.brandingLogo();
      service.brandingLogo();

      expect(logoMessages()).toHaveLength(1);
    });
  });

  describe('featureToggle', () => {
    it('returns the caller fallback when no package has configured the toggle', () => {
      expect(service.featureToggle('ai', true)).toBe(true);
      expect(service.featureToggle('ai', false)).toBe(false);
    });
  });

  describe('resolveTheme', () => {
    it('resolves against the configured theme list', async () => {
      await load(
        envelope('bootstrap', [
          {
            name: 'acme',
            content: { themes: [{ id: 'acme', tokens: { '--mat-sys-primary': 'teal' } }] },
          },
        ]),
      );

      expect(service.resolveTheme('acme').tokens['--mat-sys-primary']).toBe('teal');
      expect(service.resolveTheme('unknown').id).toBe('nuxeo');
      expect(service.themes()).toHaveLength(5);
    });
  });
});
