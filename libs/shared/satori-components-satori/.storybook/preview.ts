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
        provideAndConfigureSatoriTranslations({ fallbackLang: 'en' }),
        provideSatoriTranslationPaths(['']),
        {
          provide: ENVIRONMENT_INITIALIZER,
          multi: true,
          useValue: () => inject(TranslateService).use('en'),
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
