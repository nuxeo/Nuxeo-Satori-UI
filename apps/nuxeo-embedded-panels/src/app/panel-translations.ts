import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type TranslateLoader, type TranslationObject } from '@ngx-translate/core';
import { type Observable, catchError, map, of } from 'rxjs';

import { PANEL_SERVER } from './panel-server';
import PANEL_EN from '../i18n/en.json';

/** The panel's own strings, by language: English, which every other falls back to. */
const PANEL_STRINGS: Readonly<Record<string, TranslationObject>> = { en: PANEL_EN };

/** A language tag a catalogue may be named by: `en`, `fr`, `pt-BR`. */
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Two catalogues as one, the second's strings over the first's. */
export function mergeCatalogues(base: unknown, over: unknown): TranslationObject {
  const merged: Record<string, unknown> = isRecord(base) ? { ...base } : {};
  if (!isRecord(over)) return merged as TranslationObject;
  for (const [key, value] of Object.entries(over)) {
    merged[key] =
      isRecord(value) && isRecord(merged[key]) ? mergeCatalogues(merged[key], value) : value;
  }
  return merged as TranslationObject;
}

/**
 * The panel's translations: the application's own catalogue for the language, which the panel's
 * build copies beside its script (`i18n/<lang>.json`), so that the layout engine's cards say what
 * they say in the application; with the panel's own strings over it. Read with no credentials, as
 * the script is. A catalogue that cannot be read gives the panel's own strings only, in English for
 * a language the panel has none in.
 */
@Injectable()
export class PanelTranslateLoader implements TranslateLoader {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly server = inject(PANEL_SERVER);

  getTranslation(lang: string): Observable<TranslationObject> {
    const own = PANEL_STRINGS[lang] ?? PANEL_STRINGS['en'];
    if (!LANGUAGE.test(lang)) return of(own);
    return this.http
      .get<unknown>(`${this.server.base}i18n/${encodeURIComponent(lang)}.json`, {
        withCredentials: false,
      })
      .pipe(
        catchError(() => of({})),
        map((shipped) => mergeCatalogues(shipped, own)),
      );
  }
}
