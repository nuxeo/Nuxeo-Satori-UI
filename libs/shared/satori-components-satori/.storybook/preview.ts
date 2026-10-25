import { HttpClient, provideHttpClient, withXhr } from '@angular/common/http';
import { inject, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withDisabledInitialNavigation, withHashLocation } from '@angular/router';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideAndConfigureSatoriTranslations } from '@hylandsoftware/satori-ui/translations';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { applicationConfig, type Preview } from '@storybook/angular';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import { of, type Observable } from 'rxjs';

import { provideNxsSatoriComponents } from '../src/lib/provide-nxs-satori-components';

let english: TranslationObject | null = null;

async function loadCatalogue(): Promise<void> {
  if (english) return;
  const response = await fetch('i18n/en.json');
  if (response.ok) english = (await response.json()) as TranslationObject;
}

class ApplicationCatalogueLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string): Observable<TranslationObject> {
    return lang === 'en' && english
      ? of(english)
      : this.http.get<TranslationObject>(`i18n/${lang}.json`);
  }
}

const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withXhr()),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
        provideTranslateService({
          loader: provideTranslateLoader(ApplicationCatalogueLoader),
          lang: 'en',
          fallbackLang: 'en',
        }),
        provideAndConfigureSatoriTranslations({ fallbackLang: 'en' }),
        provideRouter(
          [{ path: 'browse', children: [] }],
          withHashLocation(),
          withDisabledInitialNavigation(),
        ),
      ],
    }),
  ],
  loaders: [loadCatalogue],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    a11y: { test: 'todo' },
  },
};

export default preview;
