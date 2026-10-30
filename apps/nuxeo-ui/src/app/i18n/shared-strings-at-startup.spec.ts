import { ChangeDetectionStrategy, Component, ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import {
  APP_BOOTSTRAP_CONFIG_URL,
  APP_CONFIG_FORMAT,
  type AppConfigLayer,
} from '@nuxeo/satori-platform/app-config';

import { appConfig } from '../app.config';

/**
 * What a `sat.*` accessible name renders as, through the **production** translate configuration.
 *
 * ## Why this is not with `testTranslateModule()`, and what it does NOT claim
 *
 * Every other spec configures translation through `translate-testing.ts`, which passes
 * `fallbackLang: 'en'` to `provideTranslateService`. Production sets the same fallback a
 * different way — `translate.setFallbackLang('en')` in the initializer, after the manifest has
 * loaded. **For resolving a missing key the two are equivalent, so the helper is representative
 * on that point and this spec claims no gap there.** An earlier version of this comment implied
 * one, which does not survive its own next sentence.
 *
 * What the helper cannot speak for is the **ordering**, and that is what this spec guards. The
 * fallback catalogue is loaded by whoever sets it; `AppTranslateLoader` stamps the manifest's
 * `labels` on at response time; and ngx-translate never re-fetches a language already in its
 * store. So a catalogue loaded before the configuration has landed is cached *without* a
 * customer's relabelling, permanently for that session — and nothing in a helper-configured spec
 * can see that, because the helper's loader has no manifest to layer.
 *
 * Measured on NXSAT-732 rather than argued: passing `fallbackLang` to `provideTranslateService`
 * applies it in the `TranslateService` constructor, which runs before `await config.load()`, and
 * with the configuration response delayed 400ms a manifest relabelling was silently dropped. The
 * ordering assertion below goes red on that change; so does one spec in
 * `configuration-at-startup.spec.ts`. Everything else in the suite stays green.
 *
 * So this boots `appConfig.providers` — the real initializers, the real `TranslateService`, the
 * real `AppTranslateLoader` — and reads the attribute off the vendor's own `sat-platform-nav`,
 * rather than asserting that a key resolves. A nav rail looks identical whatever its
 * `aria-label` says, and the attribute is the only thing a screen reader announces.
 */
@Component({
  standalone: true,
  imports: [SatPlatformNavModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './shared-strings-at-startup.host.html',
})
class SharedStringsHostComponent {}

/** The key `sat-platform-nav` binds to its rail toggle's `[attr.aria-label]`. */
const EXPAND_KEY = 'sat.platform-nav.expand';

/**
 * The vendor catalogues, as `@hylandsoftware/satori-ui` actually ships them.
 *
 * Spelled out rather than imported: the catalogue is copied into the asset output by a glob in
 * `angular.json` and served over HTTP, so there is nothing to import, and a spec that read the
 * package would assert the vendor's wording rather than our resolution of it.
 */
const VENDOR_EN = { sat: { 'platform-nav': { expand: 'Expand navigation' } } };
const VENDOR_FR = { sat: { 'platform-nav': { expand: 'Développer la navigation' } } };

/** An application catalogue for a language the vendor does not ship: no `sat.*` keys at all. */
const APP_JA = { app: { title: 'タイトル' } };
const APP_FR = { app: { title: 'Titre' } };
const APP_EN = { app: { title: 'Hyland Nuxeo' } };

function envelope(layer: AppConfigLayer, content: Record<string, unknown>) {
  return {
    format: APP_CONFIG_FORMAT,
    layer,
    fragments: [{ name: 'acme', component: 'com.acme', bundle: 'acme-ui', source: 'x', content }],
    diagnostics: [],
  };
}

describe('shared-component accessible names at startup, per language', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** Requests for a translation catalogue, in either the app's directory or an upstream folder. */
  function catalogueRequests() {
    return http.match((request) => /i18n\/[A-Za-z-]+\.json$/.test(request.url));
  }

  /**
   * Boot the application the way a deployment does, answering each catalogue request with the
   * body the server would actually send — including the 404 the upstream folder answers for a
   * language it does not contain, which is the behaviour under test.
   */
  async function start(
    bootstrap: Record<string, unknown>,
    manifest: Record<string, unknown> = {},
  ): Promise<string[]> {
    const status = TestBed.inject(ApplicationInitStatus);
    const requested: string[] = [];

    for (const layer of ['bootstrap', 'manifest'] as const) {
      for (const request of http.match((r) => r.url.endsWith(`/agentic-ui-config/${layer}.json`))) {
        request.flush(envelope(layer, layer === 'bootstrap' ? bootstrap : manifest));
      }
    }

    // Catalogue loads are chained — the fallback language is requested from inside the
    // initializer — so one pass is not enough, and the loop also lets the initializers settle.
    for (let turn = 0; turn < 50 && !status.done; turn++) {
      await new Promise((resolve) => setTimeout(resolve));
      for (const request of http.match(() => true)) {
        const url = request.request.url;
        if (!/i18n\/[A-Za-z-]+\.json$/.test(url)) {
          request.flush({});
          continue;
        }
        requested.push(url);
        const upstream = url.includes('assets/satori-ui/');
        if (upstream && url.endsWith('/en.json')) request.flush(VENDOR_EN);
        else if (upstream && url.endsWith('/fr.json')) request.flush(VENDOR_FR);
        // Exactly what the server does today for ja, nl, th and zh: the file is not there.
        else if (upstream) request.flush('', { status: 404, statusText: 'Not Found' });
        else if (url.endsWith('/ja.json')) request.flush(APP_JA);
        else if (url.endsWith('/fr.json')) request.flush(APP_FR);
        else request.flush(APP_EN);
      }
    }
    expect(status.done).withContext('application initializers settled').toBeTrue();
    return requested;
  }

  /** Every `aria-label` the vendor's rail renders, which is what a screen reader reads. */
  function railLabels(): string[] {
    const fixture = TestBed.createComponent(SharedStringsHostComponent);
    fixture.detectChanges();
    const rail = fixture.nativeElement.querySelector('sat-platform-nav');
    expect(rail).withContext('sat-platform-nav rendered').not.toBeNull();
    return [...rail.querySelectorAll('[aria-label]')].map((el) =>
      ((el as HTMLElement).getAttribute('aria-label') ?? '').trim(),
    );
  }

  /**
   * The defect NXSAT-732 reports, at the only place it is observable: the rendered attribute.
   *
   * English is the correct outcome for a language the vendor ships no catalogue for — the
   * alternative is the raw key, which would be an empty-accessible-name-class defect rather than
   * an untranslated one. What is NOT acceptable is the request that produces it being a 404, and
   * that is asserted separately below.
   */
  it('renders the English shared string for a language the vendor ships no catalogue for', async () => {
    await start({ defaultLanguage: 'ja' });

    expect(railLabels()).toContain('Expand navigation');
    expect(railLabels()).not.toContain(EXPAND_KEY);
    expect(railLabels()).not.toContain('');
  });

  /** The control: a language the vendor DOES ship must still render the vendor's own wording. */
  it('renders the vendor French string for a language the vendor does ship', async () => {
    await start({ defaultLanguage: 'fr' });

    expect(railLabels()).toContain('Développer la navigation');
    expect(railLabels()).not.toContain('Expand navigation');
  });

  /**
   * Layer 0 precedence, which must survive whatever is done about the 404: upstream folders,
   * then the app catalogue, then the manifest's `labels`, highest wins. Relabelling the product
   * for a customer is a manifest edit rather than a rebuild, and that is the point of Layer 0.
   */
  it('lets a manifest label override the vendor string, in a language the vendor ships', async () => {
    await start({ defaultLanguage: 'fr' }, { labels: { [EXPAND_KEY]: 'Ouvrir le menu Acme' } });

    expect(railLabels()).toContain('Ouvrir le menu Acme');
    expect(railLabels()).not.toContain('Développer la navigation');
  });

  /** And in a language the vendor does not ship, where the string comes through the fallback. */
  it('lets a manifest label override the fallback string too', async () => {
    await start({ defaultLanguage: 'ja' }, { labels: { [EXPAND_KEY]: 'アクメ メニュー' } });

    expect(railLabels()).toContain('アクメ メニュー');
    expect(railLabels()).not.toContain('Expand navigation');
  });

  /**
   * The ordering the manifest layering depends on, asserted directly.
   *
   * `AppTranslateLoader` reads `this.config.manifest().labels` when the catalogue response
   * arrives, and ngx-translate's `loadOrExtendLanguage` does not re-fetch a language already in
   * its store. So a catalogue loaded before the configuration has landed is cached **without** a
   * customer's labels, permanently for that session.
   *
   * Passing `fallbackLang` to `provideTranslateService` does exactly that: `TranslateService`
   * applies it in its constructor, which runs when the initializer injects it — before
   * `await config.load()`. Measured on NXSAT-732 against a dev server with the configuration
   * response delayed 400ms: the manifest's relabelling was silently dropped. This is the cheap,
   * deterministic guard against reintroducing it.
   */
  it('requests no translation catalogue before the configuration has been answered', () => {
    TestBed.inject(ApplicationInitStatus);

    expect(catalogueRequests().map((request) => request.request.url)).toEqual([]);

    // Leave the configuration requests for `http.verify()`'s sake rather than asserting on them;
    // `configuration-at-startup.spec.ts` owns what they are.
    http.match(() => true).forEach((request) => request.flush({}));
  });

  /**
   * The request itself, which is what the ticket is about: four of the seven advertised
   * languages asked for a file the vendor does not ship, so every page load 404'd and logged a
   * console error. Asserted as the absence of the request, because `catchError` had already made
   * the failure harmless — the defect is that it was issued.
   */
  it('asks the upstream folder only for languages it ships', async () => {
    const requested = await start({ defaultLanguage: 'ja' });

    expect(requested).not.toContain('assets/satori-ui/i18n/ja.json');
    // The fallback language is one it does ship, so that request must still be made — otherwise
    // this would pass by fetching no upstream catalogue at all.
    expect(requested).toContain('assets/satori-ui/i18n/en.json');
  });
});
