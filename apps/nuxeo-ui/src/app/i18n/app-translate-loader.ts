import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { TranslateLoader } from '@ngx-translate/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import { EN_FALLBACK_TRANSLATIONS } from './en-fallback';

/** Catalogues are shipped inside the bundle; customer overrides come from the manifest instead. */
export const TRANSLATION_DIRECTORY = 'i18n';

export function translationUrl(lang: string, baseUri: string): string {
  const url = new URL(`${TRANSLATION_DIRECTORY}/${encodeURIComponent(lang)}.json`, baseUri);
  return `${url.pathname}${url.search}`;
}

/** Keeps only string values: ngx-translate would otherwise render `[object Object]`. */
export function flattenCatalogue(
  source: unknown,
  prefix = '',
  target: Record<string, string> = {},
): Record<string, string> {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      target[path] = value;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenCatalogue(value, path, target);
    }
  }
  return target;
}

/**
 * Upstream catalogue folders, fetched as `<folder>/i18n/<lang>.json` beneath this app's own.
 *
 * `@hylandsoftware/satori-ui` — the `sat.*` keys, copied in by an asset glob in `angular.json`.
 * Added 2026-08-24, and this one was not a cosmetic omission: it was **the most widespread
 * accessibility violation in the product**.
 *
 * `sat-platform-nav` binds `[attr.aria-label]="'sat.platform-nav.expand' | translate"`. With
 * the catalogue absent the pipe yields an empty string, so the button rendered
 * `aria-label=""` — an empty accessible name, which axe reports as `button-name`
 * (**critical**) on *every* surface in the application, seven of seven. Its `matTooltip`
 * resolved to empty too, so the attribute was not even present in the DOM.
 *
 * Upstream ships `provideAndConfigureSatoriTranslations`, and we deliberately do not use it:
 * it calls `provideTranslateService` with its own `MultiTranslateHttpLoader`, which would
 * replace this loader and take the manifest `labels` layering — a shipped Layer 0 capability —
 * with it. Fetching the folder here gets the strings with no such trade.
 */
const UPSTREAM_FOLDERS: readonly string[] = ['assets/satori-ui'];

/**
 * Loads the shipped translation catalogue and layers the manifest's `labels` over it.
 *
 * That second step is the Layer 0 point of this class: relabelling the product for a
 * customer is a manifest edit, not a rebuild. The English catalogue is also compiled in
 * as a fallback, so a failed fetch degrades to English rather than to raw keys.
 *
 * Precedence, lowest to highest: upstream folders, this app's catalogue, the manifest's
 * `labels`. A customer's relabelling wins over both, which is the point of Layer 0.
 */
@Injectable({ providedIn: 'root' })
export class AppTranslateLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AppConfigService);

  getTranslation(lang: string): Observable<Record<string, string>> {
    const folders$ = UPSTREAM_FOLDERS.map((folder) =>
      this.http
        .get<unknown>(`${folder}/${TRANSLATION_DIRECTORY}/${encodeURIComponent(lang)}.json`)
        .pipe(catchError(() => of({}))),
    );
    const app$ = this.http
      .get<unknown>(translationUrl(lang, document.baseURI))
      .pipe(catchError(() => of(EN_FALLBACK_TRANSLATIONS)));

    return forkJoin([...folders$, app$]).pipe(
      map((catalogues) => {
        const app = catalogues.pop();
        const folders = catalogues.reduce<Record<string, string>>(
          (acc, catalogue) => ({ ...acc, ...flattenCatalogue(catalogue) }),
          {},
        );
        return { ...folders, ...flattenCatalogue(app), ...this.config.manifest().labels };
      }),
    );
  }
}
