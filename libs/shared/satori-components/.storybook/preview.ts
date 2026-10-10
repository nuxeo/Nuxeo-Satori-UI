import { HttpClient, provideHttpClient } from '@angular/common/http';
import { inject, provideZonelessChangeDetection } from '@angular/core';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { applicationConfig, type Preview } from '@storybook/angular';
import type { Observable } from 'rxjs';

/**
 * The application's catalogue, served at `i18n/` by `main.ts`. Composite components translate their
 * own chrome under `satori-components.*` keys the application owns; text inputs still arrive
 * already translated, so a story passes them as plain strings.
 */
class ApplicationCatalogueLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string): Observable<TranslationObject> {
    return this.http.get<TranslationObject>(`i18n/${lang}.json`);
  }
}

/** Zoneless, like the library's specs and `build-storybook`'s `experimentalZoneless`. */
const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideTranslateService({
          loader: provideTranslateLoader(ApplicationCatalogueLoader),
          lang: 'en',
          fallbackLang: 'en',
        }),
      ],
    }),
  ],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
  },
};

export default preview;
