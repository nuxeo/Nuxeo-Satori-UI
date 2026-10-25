import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateLoader, type TranslationObject } from '@ngx-translate/core';
import { of, type Observable } from 'rxjs';

/**
 * Serves the **real** English catalogue to component tests.
 *
 * ## Why a loader rather than just a provider
 *
 * Once templates bind through `| translate`, every component test needs `TranslateService` or
 * it dies with `NG0201`. Providing an empty `TranslateModule.forRoot()` fixes the injector and
 * breaks the assertions: with no catalogue, ngx-translate passes the key through, so a test
 * asserting a button reads `Confirm` sees `shared-ui.confirm-dialog.confirm` instead.
 *
 * That would have meant rewriting roughly two hundred assertions to expect keys — turning tests
 * that check what a user sees into tests that check what a developer typed. Loading the real
 * catalogue keeps them asserting English, which is what they were always about, and has the
 * side effect of failing a test if a key is ever missing from the catalogue.
 *
 * ## Why `readFileSync` rather than an import
 *
 * The catalogue lives in `apps/nuxeo-ui/public/i18n/en.json`. A library importing from an
 * application would invert the dependency direction the whole architecture rests on, and
 * `@nx/enforce-module-boundaries` would be right to reject it. Reading the file at test
 * startup keeps the dependency out of the module graph — this is test scaffolding, not
 * production wiring.
 */
class RealCatalogueLoader implements TranslateLoader {
  private readonly catalogue = JSON.parse(
    readFileSync(join(process.cwd(), 'apps/nuxeo-ui/public/i18n/en.json'), 'utf8'),
  ) as TranslationObject;

  getTranslation(): Observable<TranslationObject> {
    return of(this.catalogue);
  }
}

/**
 * Registers the loader for every test in the project.
 *
 * `configureTestingModule` merges across calls as long as the module has not been instantiated,
 * so a spec's own `configureTestingModule` still works and does not have to know about this.
 */
/**
 * The translate providers a test needs, for specs that call `TestBed.resetTestingModule()`.
 *
 * A reset discards whatever the global `beforeEach` configured, so a spec that resets and then
 * reconfigures has to bring this back itself. `selection-topbar.component.spec.ts` does exactly
 * that in the middle of a test, which is how this export came to exist.
 *
 * ngx-translate 18 replaced `TranslateModule` with `provideTranslateService()`. For backward
 * compatibility with specs that call `imports: [testTranslateModule()]`, this wraps the provider
 * in an empty module; new code should call `providers: [testTranslateProviders()]` directly.
 */
export function testTranslateModule() {
  return {
    ngModule: class {},
    providers: testTranslateProviders(),
  };
}

export function testTranslateProviders() {
  return provideTranslateService({
    loader: { provide: TranslateLoader, useClass: RealCatalogueLoader },
    // Both of these are required, and the loader alone is not enough. With no active
    // language ngx-translate has nothing to look a key up in and falls through to its key
    // passthrough, so every assertion on visible text sees
    // `shared-ui.confirm-dialog.cancel` instead of `Cancel` — the loader is never even
    // consulted.
    //
    // Set here rather than by calling `TranslateService.use()` in a second `beforeEach`,
    // because injecting the service instantiates the TestBed and a spec's own
    // `configureTestingModule` would then throw.
    lang: 'en',
    fallbackLang: 'en',
  });
}

export function provideTestTranslations(): void {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [testTranslateProviders()] });
  });
}
