import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  EnvironmentProviders,
  Injector,
  LOCALE_ID,
  Provider,
  effect,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { TranslateService } from '@ngx-translate/core';

import { canFormatDatesIn } from '@nuxeo/satori-platform/ui';

import { REGISTERED_LOCALES } from '../i18n/register-locale-data';
import { firstValueFrom } from 'rxjs';
import { AI_BACKEND_URL } from '@agentic-ui/shared/ai-client';
import { DEFAULT_KD_CIC_OPERATIONS, KD_CIC_OPERATIONS } from '@agentic-ui/shared/kd-client';
import {
  ARENDER_CONFIG,
  NUXEO_API_ORIGIN,
  NUXEO_SAML_LOGIN_ENDPOINTS,
  NUXEO_SERVER_URL,
  NUXEO_SSO_POST_LOGIN_PATH,
  NUXEO_SSO_RETURN_QUERY_PARAM,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  DEFAULT_SESSION_TIMEOUT_CONFIG,
  SESSION_TIMEOUT_CONFIG,
  resolveSessionTimeoutConfig,
} from '../auth/session-timeout.config';

/**
 * Nuxeo Drive and ARender connect to the server directly, bypassing the Angular
 * dev proxy, so they need the real origin rather than a relative path. In
 * production the SPA is served from the Nuxeo server itself.
 */
function derivedNuxeoServerUrl(): string {
  const isDevProxy = window.location.port === '4200';
  return isDevProxy ? 'http://localhost:8080/nuxeo' : `${window.location.origin}/nuxeo`;
}

/**
 * Point every configuration `InjectionToken` at the loaded Layer 0 configuration.
 *
 * The token pattern was already the documented override idiom — `kd.config.ts`
 * says in as many words to "override the token in `app.config.ts` rather than
 * editing this file" — so this converts the whole set in one move without
 * changing a single consumer. Each factory falls back to the value that was
 * previously compiled in, which is what makes an unconfigured deployment
 * byte-for-byte equivalent to the current release.
 *
 * Ordering note: `AppConfigService.load()` runs as an `APP_INITIALIZER`, while
 * these factories are evaluated on first injection and Angular keeps that first
 * value. So nothing may inject one of these tokens — or a service that does,
 * such as `AuthService` — before the load completes: not in an
 * `APP_INITIALIZER` factory, and not in an initializer that does not first
 * `await config.load()`. The loader's own requests skip the interceptors for the
 * same reason.
 */
/**
 * Loads Layer 0 configuration, then applies the language it names.
 *
 * Exported and named rather than inline in the provider so it can be tested. The behaviour
 * worth asserting is invisible from outside: the language comes from the configuration that
 * has just loaded, on EVERY boot, and nothing a previous boot stored can override it.
 */
export function initialiseAppConfigAndLanguage(
  // Narrowed to the members actually used, rather than the whole service. A test double then
  // needs no cast, and the signature states the real dependency surface — widening it later
  // is a visible change instead of an invisible one.
  config: Pick<AppConfigService, 'load' | 'bootstrap'>,
  translate: Pick<TranslateService, 'setFallbackLang' | 'use'>,
): () => Promise<void> {
  return async () => {
    await config.load();
    // Sequenced inside one initializer on purpose: Angular runs
    // `APP_INITIALIZER` functions concurrently, and the catalogue to load
    // is named by the configuration that has just been fetched. The
    // manifest's `labels` are layered on by `AppTranslateLoader`, so this
    // also has to happen after the manifest has landed.
    const { defaultLanguage } = config.bootstrap();
    translate.setFallbackLang('en');
    // Must not prefer a language stored by an earlier boot: it would outlive a customer's
    // change to `defaultLanguage` on every browser that had already run the app.
    await firstValueFrom(translate.use(defaultLanguage));
  };
}

/**
 * The configured language, narrowed to one Angular can actually format in.
 *
 * `translate.use('xx')` is harmless — every string falls through to the English fallback.
 * Angular's date, number and currency pipes are not so forgiving: given a locale with no
 * registered data they throw `NG0701` rather than degrading, so a customer who sets
 * `defaultLanguage` to a locale we do not ship — a typo is enough — would get English text and
 * a broken date in every list. Measured: with `defaultLanguage: 'xx'`, eleven
 * `InvalidPipeArgument` errors on a single pass of the evidence capture, with the strings
 * looking fine, which is exactly what makes it easy to miss.
 *
 * So the string language and the formatting locale are allowed to differ, on purpose. Strings
 * follow the configuration; formatting follows it only where we have the data to honour it.
 *
 * ## Why registration alone is not enough to admit a locale
 *
 * This checked `REGISTERED_LOCALES` alone, which was correct only while every registered locale
 * also shipped a catalogue. It stopped being true when `ar`, `es`, `he`, `it` and `sv` were
 * registered ahead of their translations (`D8e-webui`): registration made them admissible as
 * `LOCALE_ID`, and `DATE_FNS_LOCALES` does not carry them, so `defaultLanguage: 'es'` gave
 * Angular's pipes Spanish dates — `3/4/2026`, day-first — while `provideSatoriDateAdapter()`
 * fell through to `enUS` and read `03/04/2026` back as **4 March**.
 *
 * That is NXSAT-629 exactly: display honouring the locale while parsing does not, which has no
 * symptom on screen because the calendar overlay looks right. Caught in review on #522 rather
 * than by a test, which is why there is one now.
 *
 * ## Why `availableLanguages` is not sufficient either
 *
 * The first fix for the above checked `availableLanguages`, which closed the hole for the
 * **packaged** config — `checkAdvertisedLocalesShip` fails a packaged language with no catalogue
 * — and left it open for every customer override, as the #522 review then pointed out. Layer 0
 * is customer-editable: `{ "defaultLanguage": "es", "availableLanguages": ["en", "es"] }` is
 * valid, parses cleanly, and still names a locale the bundled date-fns map has no entry for. The
 * config cannot be the authority on a capability that is decided at build time.
 *
 * So admission is the intersection of three things, each answering a different question:
 *
 * | Check | Question | Authority |
 * | --- | --- | --- |
 * | `REGISTERED_LOCALES` | can Angular format it without `NG0701`? | this build |
 * | `canFormatDatesIn` | can the date adapter parse it back? | this build |
 * | `availableLanguages` | does this deployment offer it? | the customer |
 *
 * The two build-time checks are what a customer cannot edit their way past; the third is intent,
 * and keeps a language registered ahead of its catalogue out until it ships. English is the
 * fallback and needs none of them: Angular bundles its data and the date map names it.
 */
export function resolveFormattingLocale(
  defaultLanguage: string,
  availableLanguages: readonly string[],
): string {
  const angularCanFormat = REGISTERED_LOCALES.includes(defaultLanguage);
  const adapterCanParse = canFormatDatesIn(defaultLanguage);
  const deploymentOffers = availableLanguages.includes(defaultLanguage);
  return angularCanFormat && adapterCanParse && deploymentOffers ? defaultLanguage : 'en';
}

/**
 * Keeps `<html lang>` equal to the language the text is rendered in.
 *
 * `index.html` ships `lang="en"`, and nothing changed it, so a French page announced itself as
 * English: screen readers picked an English voice for French text, and browser translation offered
 * to translate from English. Follows `onLangChange` rather than the configured default, so any
 * later `translate.use()` is announced in the language it renders.
 */
export function syncDocumentLanguage(
  translate: Pick<TranslateService, 'onLangChange' | 'getCurrentLang'>,
  document: Document,
  destroyRef: DestroyRef,
): void {
  const apply = (lang: string | undefined): void => {
    if (lang) document.documentElement.lang = lang;
  };
  apply(translate.getCurrentLang() ?? undefined);
  translate.onLangChange
    .pipe(takeUntilDestroyed(destroyRef))
    .subscribe((event) => apply(event.lang));
}

/**
 * Keeps the browser tab title equal to Layer 0 `branding.documentTitle`, on every route.
 *
 * This used to be an `effect` in `AppShellComponent`'s constructor. The effect itself was right —
 * the configuration load is asynchronous, so a reactive reader is what re-runs when it lands — but
 * the shell only mounts on authenticated routes. The sign-in page, the first page a customer sees
 * and the one that ends up in their history and bookmarks, therefore kept the packaged
 * `<title>` from `index.html` for the whole of the session before sign-in (NXSAT-722).
 *
 * At application scope instead, so there is no route where it does not apply. `nuxeo-satori-template`
 * writes the title in its initializer after `await config.load()`; an effect is the form its own
 * comment prefers, and it needs no sequencing because it re-runs when the signal changes.
 *
 * `branding.documentTitle` can no longer be blank — `mergeBootstrapConfig` keeps the packaged
 * value for a blank or whitespace-only one — so this does not need to guard against writing an
 * empty title.
 *
 * The `injector` is passed in for the same reason `syncDocumentLanguage` takes a `DestroyRef`:
 * the initializer's closure runs after provider resolution, outside an injection context, so
 * `effect()` cannot find one for itself.
 */
export function syncDocumentTitle(
  config: Pick<AppConfigService, 'bootstrap'>,
  document: Document,
  injector: Injector,
): void {
  effect(
    () => {
      document.title = config.bootstrap().branding.documentTitle;
    },
    { injector },
  );
}

// `EnvironmentProviders` in the union because `provideAppInitializer` returns that rather than a
// `Provider`. `ApplicationConfig.providers` accepts both, and the spec that picks out the
// `LOCALE_ID` provider keys on a `provide` property, which an `EnvironmentProviders` does not have.
export function provideAppConfig(): (Provider | EnvironmentProviders)[] {
  return [
    // `provideAppInitializer` rather than the `APP_INITIALIZER` token, which Angular has
    // deprecated. Its callback runs in an injection context, so these inject directly instead of
    // resolving in a factory and returning a closure. Same ordering and the same concurrency —
    // Angular still runs initializers concurrently, which is why
    // `initialiseAppConfigAndLanguage` sequences the language load inside itself rather than
    // relying on a second initializer. `nuxeo-satori-template` already uses this form.
    provideAppInitializer(() =>
      initialiseAppConfigAndLanguage(inject(AppConfigService), inject(TranslateService))(),
    ),
    provideAppInitializer(() =>
      syncDocumentLanguage(inject(TranslateService), inject(DOCUMENT), inject(DestroyRef)),
    ),
    // Application scope rather than the shell, so the sign-in page gets the configured title
    // too (NXSAT-722). An effect, so it re-runs when the asynchronous load lands and does not
    // need sequencing against the other initializers.
    provideAppInitializer(() =>
      syncDocumentTitle(inject(AppConfigService), inject(DOCUMENT), inject(Injector)),
    ),
    /*
     * Angular's OWN formatting locale, which is a different mechanism from the string language.
     *
     * `translate.use()` sets the string language and does not touch `LOCALE_ID`, so without this
     * Angular keeps its built-in default of `en-US` and every `DatePipe`, `DecimalPipe`,
     * `CurrencyPipe`, `MAT_DATE_LOCALE` and `inject(LOCALE_ID)` call site formats in English no
     * matter what Layer 0 configures.
     *
     * That was the live state of this application: `docs/i18n-status.md` recorded it as gap 10,
     * "what is still missing is providing `LOCALE_ID` itself from configuration", and a change
     * that threaded `locale` through a dozen date helpers was merged against that default —
     * correct plumbing feeding a constant. Threading the parameter is necessary and not
     * sufficient; this provider is the other half.
     *
     * Resolved on first injection rather than in the initializer, which is what makes it safe:
     * `APP_INITIALIZER` completes before the root component is created, so `bootstrap()` has the
     * loaded configuration by the time anything injects this. Same idiom as `NUXEO_API_ORIGIN`
     * below. Nothing in the initializer chain injects `LOCALE_ID`, which is the one thing that
     * would resolve — and permanently cache — a pre-configuration value.
     */
    {
      provide: LOCALE_ID,
      useFactory: () => {
        const bootstrap = inject(AppConfigService).bootstrap();
        return resolveFormattingLocale(bootstrap.defaultLanguage, bootstrap.availableLanguages);
      },
    },
    {
      provide: NUXEO_API_ORIGIN,
      useFactory: () => inject(AppConfigService).bootstrap().nuxeoApiOrigin,
    },
    {
      provide: NUXEO_SERVER_URL,
      useFactory: () =>
        inject(AppConfigService).bootstrap().nuxeoServerUrl ?? derivedNuxeoServerUrl(),
    },
    {
      // AI operations are served by the Java marketplace package over Automation.
      provide: AI_BACKEND_URL,
      useFactory: () => inject(AppConfigService).bootstrap().aiBackendUrl,
    },
    {
      provide: ARENDER_CONFIG,
      // Straight through, including `null`. `integrations.arender` is already typed
      // `AppARenderConfig | null` and defaults to `null`, and `ARENDER_CONFIG` is nullable, so
      // there is nothing to substitute.
      //
      // This used to fall back to compiled-in `http://localhost:8180` and
      // `http://nuxeo-auth-proxy/nuxeo` when unconfigured — which is what a shipped build with no
      // manifest actually used, pointing the annotation viewer at the user's own machine over
      // plaintext (Sonar S5332, and a hardcoded config default of the kind
      // `.cursor/rules/security.mdc` prohibits). `ARenderService` now degrades to
      // "Annotations are not available" instead.
      useFactory: () => inject(AppConfigService).bootstrap().integrations.arender,
    },
    {
      provide: KD_CIC_OPERATIONS,
      useFactory: () => ({
        ...DEFAULT_KD_CIC_OPERATIONS,
        ...inject(AppConfigService).bootstrap().integrations.knowledgeDiscoveryOperations,
      }),
    },
    {
      provide: NUXEO_SAML_LOGIN_ENDPOINTS,
      useFactory: () =>
        inject(AppConfigService)
          .bootstrap()
          .sso.endpoints.map((endpoint) => ({ ...endpoint })),
    },
    {
      provide: NUXEO_SSO_POST_LOGIN_PATH,
      useFactory: () => inject(AppConfigService).bootstrap().sso.postLoginPath ?? '/dashboard',
    },
    {
      provide: NUXEO_SSO_RETURN_QUERY_PARAM,
      useFactory: () => inject(AppConfigService).bootstrap().sso.returnQueryParam,
    },
    {
      provide: SESSION_TIMEOUT_CONFIG,
      useFactory: () => {
        // `resolveSessionTimeoutConfig` returns the shared default object by
        // identity unless the dev-only debug key shortened the timeout. That
        // manual-QA override must keep winning over deployed configuration.
        const resolved = resolveSessionTimeoutConfig();
        if (resolved !== DEFAULT_SESSION_TIMEOUT_CONFIG) return resolved;
        const configured = inject(AppConfigService).bootstrap().session;
        return {
          idleTimeoutMs: configured.idleTimeoutMs ?? resolved.idleTimeoutMs,
          warningBeforeMs: configured.warningBeforeMs ?? resolved.warningBeforeMs,
        };
      },
    },
  ];
}
