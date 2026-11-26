import { LocationStrategy } from '@angular/common';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import {
  type EnvironmentProviders,
  type Provider,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { TranslateLoader, provideTranslateService } from '@ngx-translate/core';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { provideNxsSatoriComponents } from '@nuxeo/satori-platform/components-satori';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import { providePanelIcons } from './panel-icons';
import { PANEL_ROUTES, PanelLocationStrategy } from './panel-location';
import { PanelMessages } from './panel-messages.service';
import { PANEL_SERVER, type PanelServer } from './panel-server';
import { PanelToken, panelTokenInterceptor } from './panel-token';
import { PanelTranslateLoader } from './panel-translations';

/**
 * One panel's application: its own injector, so that its token, its messages and its reads are its
 * own, beside any other panel on the page.
 *
 * - **No zone.js:** change detection is zoneless, so nothing of the page's is patched.
 * - **The server is the script's** ({@link PanelServer}): the REST API, the configuration the
 *   layout engine reads its files from (`/nuxeo/agentic-ui-config/`), and the panel's own files.
 * - **Requests** go through {@link panelTokenInterceptor}: the token on the REST API only, and no
 *   credentials of the browser's, ever.
 * - **A router that never reads or changes the page's address** ({@link PanelLocationStrategy}),
 *   and opens a link in the application instead.
 * - **The design system's components** as the application has them, on Material and then Satori
 *   (`provideNxsComponents`, `provideNxsSatoriComponents`), with Satori's icon set from beside the
 *   script ({@link providePanelIcons}), which leaves the page's root element alone, and Satori's
 *   theme on the panel's own shadow root (`record-panel.component.scss`).
 */
export function panelProviders(
  server: PanelServer,
  lang: string,
): (Provider | EnvironmentProviders)[] {
  return [
    provideZonelessChangeDetection(),
    { provide: PANEL_SERVER, useValue: server },
    { provide: NUXEO_API_ORIGIN, useValue: server.origin },
    {
      provide: APP_BOOTSTRAP_CONFIG_URL,
      useValue: `${server.origin}/nuxeo/agentic-ui-config/bootstrap.json`,
    },
    PanelToken,
    PanelMessages,
    provideHttpClient(withXhr(), withInterceptors([panelTokenInterceptor])),
    provideRouter(PANEL_ROUTES, withDisabledInitialNavigation()),
    { provide: LocationStrategy, useClass: PanelLocationStrategy },
    provideTranslateService({
      loader: { provide: TranslateLoader, useClass: PanelTranslateLoader },
      fallbackLang: 'en',
      lang,
    }),
    // As the application lists them: Material first, then Satori over it, by ID.
    provideNxsComponents(),
    provideNxsSatoriComponents(),
    providePanelIcons(`${server.base}satori-icons`),
  ];
}
