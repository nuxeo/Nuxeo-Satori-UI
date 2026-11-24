import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom, inject } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { MAT_FAB_DEFAULT_OPTIONS } from '@angular/material/button';
import { TranslateLoader, provideTranslateService } from '@ngx-translate/core';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';

import { CURRENT_USERNAME, ADMIN_ACCESS_CHECKS } from '@nuxeo/satori-platform/nuxeo-client';
import { provideNxsComponents, provideNxsTagWrites } from '@nuxeo/satori-platform/components';
import { provideNxsSatoriComponents } from '@nuxeo/satori-platform/components-satori';
import { nuxeoAuthInterceptor } from './auth/nuxeo-auth.interceptor';
import { AuthService } from './auth/auth.service';
import { provideAppConfig } from './config/provide-app-config';
import { provideAppExtensions } from './extensions/provide-app-extensions';
import { routes } from './app.routes';
import { AppTranslateLoader } from './i18n/app-translate-loader';
import { registerShippedLocaleData } from './i18n/register-locale-data';
import { AppThemeService } from './theme/app-theme.service';

// At module load rather than in an `APP_INITIALIZER`, because `registerLocaleData` populates a
// global registry that `DatePipe` reads on its first evaluation — which can happen in a
// component that renders before, or concurrently with, the initializers. Registration is a
// synchronous map write with no dependencies, so there is nothing to sequence.
registerShippedLocaleData();

/** `APP_INITIALIZER` values are invoked as `fn()` at startup; the factory must return that `fn`. */
export function initializeAppTheme(theme: AppThemeService) {
  return () => theme.applyStoredOrDefault();
}

export const appConfig: ApplicationConfig = {
  providers: [
    // Must come before anything that reads configuration: this registers the
    // Layer 0 loader and repoints every configuration token at its result.
    ...provideAppConfig(),
    // The `nxs.primitives.*` IDs on Material, then re-registered on Satori. Later wins, so this
    // order is the Satori-if-available mechanism (`checkSatoriPrimitivesRegisteredInOrder`); a
    // build without GitHub Packages access lists only the first.
    provideNxsComponents(),
    provideNxsSatoriComponents(),
    // At the root, so a tag change outlives the Browse panel or document page that made it.
    provideNxsTagWrites(),
    // Layer 1: registers the application's slot, rule and component IDs. Must
    // follow `provideAppConfig()`, which loads the manifest they are merged with.
    ...provideAppExtensions(),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAppTheme,
      deps: [AppThemeService],
      multi: true,
    },
    provideAnimations(),
    provideHttpClient(withXhr(), withInterceptors([nuxeoAuthInterceptor])),
    provideRouter(routes, withComponentInputBinding(), withHashLocation()),
    provideSatori(),
    {
      provide: MAT_FAB_DEFAULT_OPTIONS,
      useValue: { color: 'primary' },
    },
    provideTranslateService({
      // No `fallbackLang` here on purpose, and `initialiseAppConfigAndLanguage` calls
      // `setFallbackLang('en')` instead. `TranslateService` applies a configured `fallbackLang`
      // in its constructor — before `AppConfigService.load()` has been awaited — and
      // ngx-translate never re-fetches a language already in its store, so the English
      // catalogue would be cached without the manifest's `labels` and a customer's relabelling
      // would be lost for the session. Measured on NXSAT-732; guarded by
      // `shared-strings-at-startup.spec.ts`.
      loader: { provide: TranslateLoader, useClass: AppTranslateLoader },
    }),
    {
      provide: CURRENT_USERNAME,
      useFactory: () => {
        const auth = inject(AuthService);
        return () => auth.username();
      },
    },
    {
      provide: ADMIN_ACCESS_CHECKS,
      useFactory: () => {
        const auth = inject(AuthService);
        return {
          isAdministrator: () => auth.isAdministrator(),
          isPowerUser: () => auth.isPowerUser(),
          hasAdministrationAccess: () => auth.hasAdministrationAccess(),
        };
      },
    },
  ],
};
