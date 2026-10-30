import { formatDate } from '@angular/common';
import { LangChangeEvent, TranslateService } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';

import {
  initialiseAppConfigAndLanguage,
  provideAppConfig,
  syncDocumentLanguage,
  syncDocumentTitle,
} from './provide-app-config';
import {
  APP_BOOTSTRAP_CONFIG_URL,
  APP_CONFIG_FORMAT,
  AppConfigService,
  DEFAULT_APP_BOOTSTRAP_CONFIG,
  type AppConfigLayer,
} from '@nuxeo/satori-platform/app-config';
import {
  ApplicationInitStatus,
  DestroyRef,
  FactoryProvider,
  Injector,
  LOCALE_ID,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import { provideSatoriDateAdapter } from '@nuxeo/satori-platform/ui';

import { appConfig } from '../app.config';
import { REGISTERED_LOCALES } from '../i18n/register-locale-data';

/**
 * The language comes from the configuration that has just loaded, on every boot.
 *
 * And the formatting guard: `translate.use('xx')` is harmless because strings fall through to
 * English, but Angular's date pipes throw `NG0701` for a locale with no registered data. A
 * customer's typo produced eleven `InvalidPipeArgument` errors in one capture with the strings
 * looking fine, which is what makes it easy to miss. `LOCALE_ID` below is where that guard
 * applies.
 */
describe('initialiseAppConfigAndLanguage', () => {
  function harness(defaultLanguage: string) {
    const order: string[] = [];
    const config = {
      load: jasmine.createSpy('load').and.callFake(async () => {
        order.push('load');
      }),
      // A real signal, not an arrow. `AppConfigService.bootstrap` is a `Signal`, which
      // carries a brand a bare function does not have — and the real config shape, because a
      // partial literal was rejected too. Both caught by narrowing the signature rather than
      // casting past it.
      bootstrap: signal({ ...DEFAULT_APP_BOOTSTRAP_CONFIG, defaultLanguage }),
    };
    const translate = {
      setFallbackLang: jasmine.createSpy('setFallbackLang'),
      use: jasmine.createSpy('use').and.callFake((lang: string) => {
        order.push(`use:${lang}`);
        return of({});
      }),
    };
    return { config, translate, order };
  }

  // No casts: the function takes only the members it uses, so these doubles satisfy it
  // structurally and a signature change becomes a compile error here.
  const run = async (language: string) => {
    const h = harness(language);
    await initialiseAppConfigAndLanguage(h.config, h.translate)();
    return h;
  };

  it('loads the configuration before reading the language out of it', async () => {
    const h = await run('fr');
    // Sequencing is the reason this lives in one initializer: Angular runs them concurrently
    // and the catalogue to load is named by configuration that has only just arrived.
    expect(h.order[0]).toBe('load');
    expect(h.order).toContain('use:fr');
  });

  it('falls back to English for strings it cannot find', async () => {
    const h = await run('fr');
    expect(h.translate.setFallbackLang).toHaveBeenCalledWith('en');
  });

  it('applies the language each boot is configured with, not only the first', async () => {
    const first = await run('fr');
    const second = await run('de');
    expect(first.translate.use).toHaveBeenCalledOnceWith('fr');
    expect(second.translate.use).toHaveBeenCalledOnceWith('de');
  });

  it('still uses an unshipped locale for strings, because the fallback handles them', async () => {
    const h = await run('xx');
    expect(h.translate.use).toHaveBeenCalledWith('xx');
  });
});

/**
 * The same guarantee through the real startup — `appConfig.providers`, every initializer, the
 * real `TranslateService` and `AppTranslateLoader` — rather than the initializer by its function.
 *
 * What only this can show: that the provider wires the initializer with the dependencies it
 * needs, and that no other initializer, or anything constructed during startup, moves the
 * language off the configured one. A stored locale is seeded first because browsers that ran an
 * earlier build still hold `GUEST__locale`, and a stored language that won over configuration
 * would strand them on it.
 */
describe('the configured language at startup', () => {
  const STALE_LOCALE_KEY = 'GUEST__locale';
  let htmlLang: string;

  function envelope(layer: AppConfigLayer, content: Record<string, unknown>) {
    return {
      format: APP_CONFIG_FORMAT,
      layer,
      fragments: [{ name: 'acme', component: 'com.acme', bundle: 'acme-ui', source: 'x', content }],
      diagnostics: [],
    };
  }

  /** One application start, configured with `defaultLanguage`; resolves to the language in force. */
  async function boot(defaultLanguage: string): Promise<string> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const status = TestBed.inject(ApplicationInitStatus);
    for (const layer of ['bootstrap', 'manifest'] as const) {
      for (const request of http.match((r) => r.url.endsWith(`/agentic-ui-config/${layer}.json`))) {
        request.flush(envelope(layer, layer === 'bootstrap' ? { defaultLanguage } : {}));
      }
    }
    for (let turn = 0; turn < 50 && !status.done; turn++) {
      await new Promise((resolve) => setTimeout(resolve));
      http.match(() => true).forEach((request) => request.flush({}));
    }
    expect(status.done).withContext(`initializers settled for ${defaultLanguage}`).toBeTrue();
    return TestBed.inject(TranslateService).getCurrentLang() ?? 'en';
  }

  beforeEach(() => {
    htmlLang = document.documentElement.lang;
    localStorage.setItem(STALE_LOCALE_KEY, 'de');
  });

  afterEach(() => {
    localStorage.removeItem(STALE_LOCALE_KEY);
    document.documentElement.lang = htmlLang;
    TestBed.resetTestingModule();
  });

  it('applies the configured language on every boot, over a stored one', async () => {
    expect(await boot('fr')).toBe('fr');
    expect(await boot('de')).toBe('de');
    expect(await boot('en')).toBe('en');
  });

  it('announces that language on <html lang> once startup has settled', async () => {
    await boot('fr');
    expect(document.documentElement.lang).toBe('fr');
  });
});

/**
 * Angular's `LOCALE_ID`, which is a second mechanism alongside the string language.
 *
 * `translate.use()` sets the string language and does not touch `LOCALE_ID`, and without a
 * provider Angular keeps its built-in `en-US` — so every `DatePipe` and `inject(LOCALE_ID)` call
 * site formats in English whatever Layer 0 says. `docs/i18n-status.md` carried this as gap 10
 * while a change threading `locale` through a dozen date helpers was merged against that
 * constant default.
 *
 * These assert the provider is actually registered and actually reads configuration. Asserting
 * `resolveFormattingLocale` alone would not: it was already correct as an inline expression, and
 * the defect was that nothing connected it to DI.
 */
describe('LOCALE_ID provider', () => {
  function injectLocaleFor(
    defaultLanguage: string,
    availableLanguages: readonly string[] = DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages,
  ): string {
    const localeProvider = provideAppConfig().find(
      (provider): provider is FactoryProvider =>
        typeof provider === 'object' && 'provide' in provider && provider.provide === LOCALE_ID,
    );
    // An explicit failure rather than a confusing undefined deref: if the provider is ever
    // dropped, the symptom in production is silent English dates, so it must be loud here.
    expect(localeProvider).withContext('provideAppConfig() must register LOCALE_ID').toBeDefined();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AppConfigService,
          useValue: {
            bootstrap: signal({
              ...DEFAULT_APP_BOOTSTRAP_CONFIG,
              defaultLanguage,
              availableLanguages,
            }),
          },
        },
        localeProvider as FactoryProvider,
      ],
    });
    return TestBed.inject(LOCALE_ID);
  }

  it('resolves French from configuration rather than Angular default en-US', () => {
    // The load-bearing assertion of the whole locale change. Before the provider existed this
    // returned 'en-US' for every configuration, which is what made the threaded `locale`
    // parameters inert.
    expect(injectLocaleFor('fr')).toBe('fr');
  });

  it('resolves German too, so it is a real lookup and not a French special case', () => {
    expect(injectLocaleFor('de')).toBe('de');
  });

  it('falls back to en for a locale with no registered Angular data', () => {
    // The date pipes throw NG0701 rather than degrading, so a customer typo in
    // `defaultLanguage` must not reach them.
    expect(injectLocaleFor('xx')).toBe('en');
  });

  it('differs from Angular default when configured, proving the provider is consulted', () => {
    // A test that only checked 'en' would pass with no provider at all, because Angular's
    // default already starts with those two letters.
    expect(injectLocaleFor('fr')).not.toBe('en-US');
  });

  /**
   * The #522 regression, and the reason the clamp reads `availableLanguages` rather than
   * `REGISTERED_LOCALES` alone.
   *
   * `ar`, `es`, `he`, `it` and `sv` have Angular locale data registered ahead of their
   * catalogues (`D8e-webui`), which made them admissible as `LOCALE_ID` while `DATE_FNS_LOCALES`
   * carried no entry for them. The result was the NXSAT-629 split restored: Angular's pipes
   * showed `3/4/2026` day-first in Spanish while the Material adapter fell through to `enUS` and
   * read `03/04/2026` back as 4 March. Nothing on screen looked wrong.
   *
   * These assert from configuration, not from the constant: `injectLocaleFor` goes through the
   * real provider from `provideAppConfig()`.
   */
  const REGISTERED_BUT_NOT_SHIPPED = ['ar', 'es', 'he', 'it', 'sv'] as const;

  it('does not admit a locale registered ahead of its catalogue', () => {
    // Guards the premise: if these ever stop being registered-but-unadvertised the test below
    // would pass for the wrong reason, asserting nothing.
    for (const language of REGISTERED_BUT_NOT_SHIPPED) {
      expect(REGISTERED_LOCALES)
        .withContext(`${language} must still be registered for this test to mean anything`)
        .toContain(language);
      expect(DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages)
        .withContext(`${language} must still be unadvertised for this test to mean anything`)
        .not.toContain(language);
    }

    for (const language of REGISTERED_BUT_NOT_SHIPPED) {
      expect(injectLocaleFor(language))
        .withContext(`${language} has no date-fns locale, so it must not reach LOCALE_ID`)
        .toBe('en');
    }
  });

  it('admits every language it advertises, so the clamp is not simply refusing everything', () => {
    for (const language of DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages) {
      expect(injectLocaleFor(language)).toBe(language === 'en' ? 'en' : language);
    }
  });

  /**
   * The second half of the #522 review, and the case `availableLanguages` alone cannot catch.
   *
   * Layer 0 is customer-editable, so a deployment can advertise a language this build cannot
   * parse dates in. `{ defaultLanguage: 'es', availableLanguages: ['en', 'es'] }` is valid
   * configuration, passes `mergeBootstrapConfig`, and `checkAdvertisedLocalesShip` never sees it
   * — that gate reads the packaged config, not a customer's. Clamping to the config alone
   * therefore honoured the override and handed `es` straight to `LOCALE_ID`.
   *
   * Both keys are overridden here together, which is the shape the review asked for: overriding
   * `defaultLanguage` by itself cannot reach this path, because the packaged
   * `availableLanguages` would reject it for the right reason and the test would pass without
   * exercising the capability check at all.
   */
  it('refuses a customer override advertising a language this build cannot parse dates in', () => {
    expect(injectLocaleFor('es', ['en', 'es'])).toBe('en');
  });

  it('refuses such an override for every language registered ahead of its catalogue', () => {
    for (const language of REGISTERED_BUT_NOT_SHIPPED) {
      expect(injectLocaleFor(language, ['en', language]))
        .withContext(`a Layer 0 override must not admit "${language}" either`)
        .toBe('en');
    }
  });

  it('still honours a customer override for a language this build does ship', () => {
    // The mirror of the two above: the capability check must not refuse everything a customer
    // configures, only what this build cannot honour. `fr` narrows the list and must survive.
    expect(injectLocaleFor('fr', ['en', 'fr'])).toBe('fr');
  });

  /**
   * Configuration through to adapter resolution — the two mechanisms that disagreed.
   *
   * The first version of this test asked the adapter to parse what the adapter had just
   * formatted, and **passed with the defect in place**: `dateFnsLocaleFor('es')` falls through
   * to `enUS` for both halves, so the adapter is perfectly self-consistent while being wrong.
   * Round-tripping inside one mechanism cannot see a split between two.
   *
   * What a user actually hits is a date rendered by `DatePipe` in one order and read back by a
   * date field in another: copy the date out of a document list, type it into a filter, get a
   * different day. So this compares field order between Angular's formatting — which follows
   * `LOCALE_ID`'s registered locale data — and the adapter's, which follows `DATE_FNS_LOCALES`.
   *
   * 3 April 2026 is the probe because `3` and `4` identify day and month unambiguously and the
   * year contributes neither digit.
   */
  it('keeps Angular formatting and the date adapter on the same field order', () => {
    const dayBeforeMonth = (rendered: string): boolean =>
      rendered.indexOf('3') < rendered.indexOf('4');

    const configurations = [
      ...DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages,
      ...REGISTERED_BUT_NOT_SHIPPED,
      'xx',
    ];

    for (const configured of configurations) {
      const locale = injectLocaleFor(configured);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          { provide: LOCALE_ID, useValue: locale },
          provideSatoriDateAdapter(),
        ],
      });
      const adapter = TestBed.inject(DateAdapter) as DateAdapter<Date>;
      const formats = TestBed.inject(MAT_DATE_FORMATS);

      const byPipe = formatDate(new Date(2026, 3, 3), 'shortDate', locale);
      const byAdapter = adapter.format(adapter.createDate(2026, 3, 3), formats.display.dateInput);

      expect(dayBeforeMonth(byAdapter))
        .withContext(
          `configured "${configured}" resolved to "${locale}": DatePipe writes "${byPipe}" ` +
            `and the date field writes "${byAdapter}"`,
        )
        .toBe(dayBeforeMonth(byPipe));
    }
  });
});

describe('syncDocumentLanguage', () => {
  function harness(current: string) {
    const onLangChange = new Subject<LangChangeEvent>();
    const translate = {
      onLangChange,
      getCurrentLang: () => current,
    };
    const doc = document.implementation.createHTMLDocument('lang');
    doc.documentElement.lang = 'en';
    const destroyCallbacks: Array<() => void> = [];
    const destroyRef = {
      onDestroy: (callback: () => void) => {
        destroyCallbacks.push(callback);
        return () => undefined;
      },
    } as unknown as DestroyRef;
    syncDocumentLanguage(translate, doc, destroyRef);
    return { onLangChange, doc, destroy: () => destroyCallbacks.forEach((cb) => cb()) };
  }

  const change = (lang: string): LangChangeEvent => ({ lang, translations: {} });

  it('sets <html lang> to the language already active', () => {
    const { doc } = harness('fr');
    expect(doc.documentElement.lang).toBe('fr');
  });

  it('follows every later language change', () => {
    const { onLangChange, doc } = harness('en');
    onLangChange.next(change('de'));
    expect(doc.documentElement.lang).toBe('de');
    onLangChange.next(change('fr'));
    expect(doc.documentElement.lang).toBe('fr');
  });

  it('stops listening once the application is destroyed', () => {
    const { onLangChange, doc, destroy } = harness('en');
    destroy();
    onLangChange.next(change('de'));
    expect(doc.documentElement.lang).toBe('en');
  });
});

/**
 * NXSAT-722 — the tab title has to be written at application scope.
 *
 * It used to be an effect in `AppShellComponent`, which only mounts on authenticated routes, so
 * the sign-in page kept the packaged `<title>` from `index.html`. These assert the two properties
 * that failure had: the title follows the configuration, and it keeps following it after the
 * asynchronous load lands rather than being read once.
 */
describe('syncDocumentTitle', () => {
  function harness(documentTitle: string) {
    const bootstrap = signal({
      ...DEFAULT_APP_BOOTSTRAP_CONFIG,
      branding: { ...DEFAULT_APP_BOOTSTRAP_CONFIG.branding, documentTitle },
    });
    const doc = document.implementation.createHTMLDocument('title');
    TestBed.runInInjectionContext(() =>
      syncDocumentTitle({ bootstrap }, doc, TestBed.inject(Injector)),
    );
    return { bootstrap, doc };
  }

  it('writes the configured title, with no shell mounted', () => {
    const { doc } = harness('Acme Portal');
    TestBed.tick();
    expect(doc.title).toBe('Acme Portal');
  });

  it('follows a later change, so an asynchronous configuration load is not missed', () => {
    const { bootstrap, doc } = harness(DEFAULT_APP_BOOTSTRAP_CONFIG.branding.documentTitle);
    TestBed.tick();
    expect(doc.title).toBe('Nuxeo Platform');

    // What the real load does: the packaged default is in place, then the fetched configuration
    // replaces it. A one-shot read would leave the packaged value here.
    bootstrap.set({
      ...DEFAULT_APP_BOOTSTRAP_CONFIG,
      branding: { ...DEFAULT_APP_BOOTSTRAP_CONFIG.branding, documentTitle: 'Acme Portal' },
    });
    TestBed.tick();

    expect(doc.title).toBe('Acme Portal');
  });
});
