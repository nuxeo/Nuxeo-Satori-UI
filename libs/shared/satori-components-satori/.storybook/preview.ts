import { provideHttpClient, withXhr } from '@angular/common/http';
import { ENVIRONMENT_INITIALIZER, inject, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withDisabledInitialNavigation, withHashLocation } from '@angular/router';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import {
  provideAndConfigureSatoriTranslations,
  provideSatoriTranslationPaths,
} from '@hylandsoftware/satori-ui/translations';
import { TranslateService } from '@ngx-translate/core';
import { applicationConfig, type Preview } from '@storybook/angular';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';

import { provideNxsSatoriComponents } from '../src/lib/provide-nxs-satori-components';

const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withXhr()),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
        // `en-US`, not `en`: satori-ui 1.0.0 ships regional catalogues only, so `en` found no
        // `sat.*` strings and the stories rendered raw keys. Satori's loader asks for the exact
        // code and falls back to the base language, so the app catalogue path ('') still
        // resolves: `/i18n/en-US.json` 404s (expected, once per load) and `/i18n/en.json` loads.
        // The application does not take this route; `AppTranslateLoader` maps bare codes to
        // regional files itself, without the doomed request.
        provideAndConfigureSatoriTranslations({ fallbackLang: 'en-US' }),
        provideSatoriTranslationPaths(['']),
        {
          provide: ENVIRONMENT_INITIALIZER,
          multi: true,
          useValue: () => inject(TranslateService).use('en-US'),
        },
        provideRouter(
          [{ path: 'browse', children: [] }],
          withHashLocation(),
          withDisabledInitialNavigation(),
        ),
      ],
    }),
  ],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    a11y: { test: 'todo' },
  },
};

export default preview;
