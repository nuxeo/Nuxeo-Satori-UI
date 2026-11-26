import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type TranslateLoader, type TranslationObject } from '@ngx-translate/core';
import { type Observable, catchError, map, of } from 'rxjs';

import { PANEL_SERVER } from './panel-server';

/** A language tag a catalogue may be named by: `en`, `fr`, `pt-BR`. */
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The panel's translations: the application's own catalogue for the language, which the panel's
 * build copies beside its script (`i18n/<lang>.json`, from `apps/nuxeo-ui/public/i18n/`), so that
 * the layout engine's cards, and the panel's own `embedded-panels.*` strings, say what they say in
 * the application. Read with no credentials, as the script is. A catalogue that cannot be read gives
 * none, and the fallback language, English, is asked for in its place.
 */
@Injectable()
export class PanelTranslateLoader implements TranslateLoader {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly server = inject(PANEL_SERVER);

  getTranslation(lang: string): Observable<TranslationObject> {
    if (!LANGUAGE.test(lang)) return of({});
    return this.http
      .get<unknown>(`${this.server.base}i18n/${encodeURIComponent(lang)}.json`, {
        withCredentials: false,
      })
      .pipe(
        map((catalogue) => (isRecord(catalogue) ? (catalogue as TranslationObject) : {})),
        catchError(() => of({})),
      );
  }
}
