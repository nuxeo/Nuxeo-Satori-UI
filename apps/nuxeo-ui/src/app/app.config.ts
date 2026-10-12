import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom, inject } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { MAT_FAB_DEFAULT_OPTIONS } from '@angular/material/button';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';

import { CURRENT_USERNAME, ADMIN_ACCESS_CHECKS } from '@nuxeo-satori/platform/nuxeo-client';
import { provideNxsComponents } from '@nuxeo-satori/platform/components';
import { provideNxsSatoriComponents } from '@nuxeo-satori/platform/components-satori';
import { nuxeoAuthInterceptor } from './auth/nuxeo-auth.interceptor';
import { AuthService } from './auth/auth.service';
import { provideAppConfig } from './config/provide-app-config';
import { provideAppExtensions } from './extensions/provide-app-extensions';
import { provideAdfHxNuxeoBridge } from '@agentic-ui/shared/adf-hx-bridge/providers';
import {
  ContextMenuActionsService,
  DocumentService,
} from '@alfresco/adf-hx-content-services/services';
import { CONTEXT_MENU_ACTIONS_PROVIDERS } from '@alfresco/adf-hx-content-services/ui';
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
    // Layer 1: registers the application's slot, rule and component IDs. Must
    // follow `provideAppConfig()`, which loads the manifest they are merged with.
    ...provideAppExtensions(),
    // The adf-hx API ports belong in the **root** injector, because that is what upstream
    // is built for: eleven of its services are `providedIn: 'root'` and resolve the port
    // tokens from the root injector — `SingleItemCopyService`, `SingleItemMoveService`,
    // `CreateDocumentVersionService`, `RestoreDocumentVersionService`,
    // `BlobDownloadService`, `SharedDocumentService`, `RenditionsService`,
    // `DocumentModelService`, `SearchService`, `UserService`, `RouterExtService`.
    //
    // Providing the ports on the POC component instead requires shadowing every one of
    // those root services locally, and the list grows with each component adopted. That
    // was tried; it fails one `NG0201` at a time.
    //
    // The cost is that adf-core becomes eager: initial bundle 1.71 MB -> 2.86 MB. See the
    // budget note in `angular.json`.
    provideAdfHxNuxeoBridge(),
    DocumentService,
    ContextMenuActionsService,
    // The nine action handlers `ContextMenuActionsService` takes. In root for the same
    // reason as everything above: a root-provided service resolves its own dependencies
    // from the root injector, so leaving these on the component left it failing NG0201 on
    // HXP_DOCUMENT_DELETE_ACTION_SERVICE.
    ...CONTEXT_MENU_ACTIONS_PROVIDERS,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAppTheme,
      deps: [AppThemeService],
      multi: true,
    },
    provideAnimations(),
    provideHttpClient(withInterceptors([nuxeoAuthInterceptor])),
    provideRouter(routes, withComponentInputBinding(), withHashLocation()),
    provideSatori(),
    {
      provide: MAT_FAB_DEFAULT_OPTIONS,
      useValue: { color: 'primary' },
    },
    importProvidersFrom(
      TranslateModule.forRoot({
        loader: { provide: TranslateLoader, useClass: AppTranslateLoader },
      }),
    ),
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
