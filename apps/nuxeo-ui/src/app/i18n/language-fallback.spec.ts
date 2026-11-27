import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import {
  APP_BOOTSTRAP_CONFIG_URL,
  APP_CONFIG_FORMAT,
  AppConfigService,
  type AppConfigLayer,
} from '@nuxeo/satori-platform/app-config';
import { TranslateLoader, TranslateService, provideTranslateService } from '@ngx-translate/core';
import { firstValueFrom, of, throwError } from 'rxjs';

import { appConfig } from '../app.config';
import { AppTranslateLoader } from './app-translate-loader';

/**
 * Every language falls back to English **key by key**: a key a language's catalogue, or a business
 * app's labels in that language, does not give renders in English, and a key neither gives in
 * English either renders as itself. Never the whole language at once, and never a raw key where
 * English has a text.
 *
 * That is what lets a language ship while it is partly translated — the four shipped catalogues
 * hold 2,013 of English's 3,355 keys — and it is what a kit's language file, which the pipeline
 * accepts as a subset of the kit's English, relies on too.
 *
 * Asserted through `TranslateService.instant`, which is what the translate pipe calls, over
 * `AppTranslateLoader` and the registry's labels, rather than on the loader's merged map: the
 * fallback is ngx-translate's, set by the application, and a map cannot show it.
 */

/** English: the app's catalogue, nested as it ships, and a business app's labels. */
const APP_EN = { app: { title: 'Hyland Nuxeo', subtitle: 'Content services' } };
const KIT_EN = {
  version: 2,
  labels: { 'payers.app.claims': 'Claims', 'payers.queue.mine': 'My claims' },
};

/** Each language: one app key and one kit key of its own, the other of each left to English. */
const TRANSLATED = (title: string, claims: string) => ({
  app: { app: { title } },
  kit: { version: 2, labels: { 'payers.app.claims': claims } },
});

/** The registry, giving the kit's labels in English and in `language`. */
function registry(language: string, kit: unknown) {
  return {
    provide: APP_DEFINITION_FILES,
    useValue: {
      file: (path: string) =>
        path === 'labels/en.json'
          ? of(KIT_EN)
          : path === `labels/${language}.json`
            ? of(kit)
            : throwError(() => new Error(`${path} is not listed`)),
      labelLanguages: () => of(['en', language]),
    },
  };
}

function expectKeyByKeyFallback(
  translate: TranslateService,
  language: string,
  title: string,
  claims: string,
): void {
  expect(translate.getCurrentLang()).withContext('the language in use').toBe(language);
  // The language's own texts, in the app and in the kit.
  expect(translate.instant('app.title')).toBe(title);
  expect(translate.instant('payers.app.claims')).toBe(claims);
  // The keys it leaves out, each in English, the rest of the language untouched.
  expect(translate.instant('app.subtitle')).toBe('Content services');
  expect(translate.instant('payers.queue.mine')).toBe('My claims');
  // And a key with no text in either is itself, which is ngx-translate's passthrough.
  expect(translate.instant('app.nowhere')).toBe('app.nowhere');
}

describe('a language falls back to English, key by key', () => {
  /**
   * The production configuration: `appConfig`'s providers, whose initializer sets the fallback
   * language after the configuration has loaded. French, because a language must ship a catalogue
   * before the application will boot into it (`resolveStringLanguage`), and French ships one.
   */
  describe('as the application starts', () => {
    let http: HttpTestingController;
    const FR = TRANSLATED('Hyland Nuxeo, en français', 'Sinistres');

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          ...appConfig.providers,
          provideHttpClientTesting(),
          {
            provide: APP_BOOTSTRAP_CONFIG_URL,
            useValue: '/nuxeo/agentic-ui-config/bootstrap.json',
          },
          registry('fr', FR.kit),
        ],
      });
      http = TestBed.inject(HttpTestingController);
    });

    function envelope(layer: AppConfigLayer, content: Record<string, unknown>) {
      return {
        format: APP_CONFIG_FORMAT,
        layer,
        fragments: [
          { name: 'acme', component: 'com.acme', bundle: 'acme-ui', source: 'x', content },
        ],
        diagnostics: [],
      };
    }

    it('in French', async () => {
      const status = TestBed.inject(ApplicationInitStatus);
      for (const layer of ['bootstrap', 'manifest'] as const) {
        for (const request of http.match((r) =>
          r.url.endsWith(`/agentic-ui-config/${layer}.json`),
        )) {
          request.flush(envelope(layer, layer === 'bootstrap' ? { defaultLanguage: 'fr' } : {}));
        }
      }
      // The fallback language is asked for from inside the initializer, so one pass is not enough.
      for (let turn = 0; turn < 50 && !status.done; turn++) {
        await new Promise((resolve) => setTimeout(resolve));
        for (const request of http.match(() => true)) {
          const url = request.request.url;
          if (url.includes('assets/satori-ui/')) request.flush({});
          else if (url.endsWith('i18n/fr.json')) request.flush(FR.app);
          else if (url.endsWith('i18n/en.json')) request.flush(APP_EN);
          else request.flush({});
        }
      }
      expect(status.done).withContext('application initializers settled').toBeTrue();

      expectKeyByKeyFallback(
        TestBed.inject(TranslateService),
        'fr',
        'Hyland Nuxeo, en français',
        'Sinistres',
      );
    });
  });

  /**
   * Spanish and the Nordic languages, which ship no catalogue yet, so the application does not boot
   * into them and the production initializer cannot be used: `resolveStringLanguage` refuses each.
   * So these give `TranslateService` the fallback language themselves, as the initializer does for
   * French above, and hold the rest to the production `AppTranslateLoader` and the registry's
   * labels under each language's own code: that the loader reads a language's catalogue, and a
   * kit's labels in that language, by the names Crowdin writes them, and that each key they leave
   * out resolves in English. The French case is what holds the application's own fallback setting.
   */
  const PHASE_7: ReadonlyArray<readonly [language: string, title: string, claims: string]> = [
    ['es', 'Hyland Nuxeo, en español', 'Reclamaciones'],
    ['sv', 'Hyland Nuxeo, på svenska', 'Ärenden'],
    ['da', 'Hyland Nuxeo, på dansk', 'Krav'],
    ['nb', 'Hyland Nuxeo, på norsk', 'Krav'],
    ['fi', 'Hyland Nuxeo, suomeksi', 'Korvausvaatimukset'],
  ];
  for (const [language, title, claims] of PHASE_7) {
    it(`in ${language}`, async () => {
      const translated = TRANSLATED(title, claims);
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withXhr()),
          provideHttpClientTesting(),
          {
            provide: AppConfigService,
            useValue: {
              manifest: signal({ labels: {} }),
              diagnostics: signal({ bootstrapSource: 'packaged-default' }),
            },
          },
          registry(language, translated.kit),
          provideTranslateService({
            loader: { provide: TranslateLoader, useClass: AppTranslateLoader },
            fallbackLang: 'en',
          }),
        ],
      });
      const http = TestBed.inject(HttpTestingController);
      const translate = TestBed.inject(TranslateService);
      const used = firstValueFrom(translate.use(language));
      for (let turn = 0; turn < 10; turn++) {
        await new Promise((resolve) => setTimeout(resolve));
        for (const request of http.match(() => true)) {
          const url = request.request.url;
          if (url.includes('assets/satori-ui/')) request.flush({});
          else if (url.endsWith(`i18n/${language}.json`)) request.flush(translated.app);
          else if (url.endsWith('i18n/en.json')) request.flush(APP_EN);
          else request.flush({});
        }
      }
      await used;

      expectKeyByKeyFallback(translate, language, title, claims);
      http.verify();
    });
  }
});
