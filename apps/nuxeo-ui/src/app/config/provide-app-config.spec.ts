import { LangChangeEvent, TranslateService } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';

import {
  initialiseAppConfigAndLanguage,
  provideAppConfig,
  syncDocumentLanguage,
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
  LOCALE_ID,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { appConfig } from '../app.config';

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
  function injectLocaleFor(defaultLanguage: string): string {
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
          useValue: { bootstrap: signal({ ...DEFAULT_APP_BOOTSTRAP_CONFIG, defaultLanguage }) },
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
