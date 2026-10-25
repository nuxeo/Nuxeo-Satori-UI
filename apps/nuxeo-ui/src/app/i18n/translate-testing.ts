import { NgModule } from '@angular/core';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { of, type Observable } from 'rxjs';

import { EN_FALLBACK_TRANSLATIONS } from './en-fallback';

/**
 * The translate module for this application's **Karma** specs.
 *
 * ## Why this is not the library helper
 *
 * `tools/i18n/test-translate-setup.ts` reads `en.json` with `node:fs`, which is fine under
 * Vitest and impossible here — `nuxeo-ui` runs its specs in a real browser through Karma, where
 * there is no filesystem.
 *
 * ## Why the fallback map rather than the catalogue
 *
 * `EN_FALLBACK_TRANSLATIONS` is compiled in, so it needs no loading of any kind, and it already
 * holds every key bound to an accessible name — which is what these specs query by. A spec
 * that needs a key outside it gets the key passed through, which is visible and easy to
 * diagnose, rather than a silent empty string.
 *
 * Importing the JSON catalogue instead would work, but it would put a `public/` asset into the
 * application's module graph purely for tests, and the asset is served at runtime rather than
 * bundled. Keeping the two apart is the point of `en-fallback.ts` existing at all.
 */
class FallbackCatalogueLoader implements TranslateLoader {
  constructor(private readonly extra: Record<string, string> = {}) {}

  getTranslation(): Observable<Record<string, string>> {
    return of({ ...EN_FALLBACK_TRANSLATIONS, ...this.extra });
  }
}

/**
 * Import this in any `nuxeo-ui` spec whose component template uses the translate pipe.
 *
 * `extra` is for keys the fallback map deliberately does not hold — VISIBLE text such as a
 * `mat-label` or a `mat-error`, as opposed to an accessible name. The map is partial on purpose
 * (see `checkAccessibleNameFallbacks`) and widening it to satisfy a spec would blur what it is
 * for, so a spec that asserts visible English declares that English here instead.
 *
 * Passing the expected string rather than reading the catalogue is the point: the spec then says
 * what a user should see, and a catalogue change that alters the wording shows up as a failing
 * assertion to be read rather than silently redefining what the test proves.
 *
 * ngx-translate 18 replaced `TranslateModule` with `provideTranslateService()`. For backward
 * compatibility with specs that call `imports: [testTranslateModule()]`, this wraps the provider
 * in a module.
 */
export function testTranslateModule(extra: Record<string, string> = {}) {
  @NgModule({
    providers: provideTranslateService({
      loader: { provide: TranslateLoader, useFactory: () => new FallbackCatalogueLoader(extra) },
      lang: 'en',
      fallbackLang: 'en',
    }),
  })
  class TestTranslateModule {}
  return TestTranslateModule;
}
