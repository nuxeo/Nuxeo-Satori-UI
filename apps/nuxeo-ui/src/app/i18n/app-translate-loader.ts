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

/** An upstream catalogue folder, and the languages it actually contains. */
interface UpstreamCatalogueFolder {
  /** Asset path the folder is copied to, as the `assets` glob in `angular.json` writes it. */
  readonly path: string;
  /**
   * Every language the folder ships, by catalogue filename.
   *
   * Declared rather than discovered because the folder is served over HTTP and a directory
   * listing is not: the only way to find out at runtime is to ask for a file and see whether it
   * 404s, which is the defect this list exists to remove. `checkUpstreamCatalogueLanguages` in
   * `scripts/review-guardrails.mjs` compares it to the installed package on every pull request,
   * so a dependency bump that adds or drops a language fails the `guardrails` gate with the
   * difference rather than rotting here unnoticed.
   */
  readonly languages: readonly string[];
}

/**
 * Upstream catalogue folders, fetched as `<path>/i18n/<lang>.json` beneath this app's own.
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
 *
 * ## Why each folder names its languages (NXSAT-732)
 *
 * A folder is asked only for a language it ships. `@hylandsoftware/satori-ui@1.0.0-alpha.171`
 * ships `de en es fr it pl pt` with regional variants, and `availableLanguages` advertises more
 * than that — so every language outside the intersection requested a file that does not exist,
 * answering 404 and logging a console error on every page load. The failure was already caught
 * into `{}`, so nothing broke; the request was simply doomed.
 *
 * **The two sets are deliberately not restated here, and this list is not derived from
 * `availableLanguages`.** Which languages a deployment advertises is Layer 0 configuration that
 * changes without this file, so a comment enumerating it goes stale silently and a filter keyed
 * on it would couple the loader to configuration it must not read. The only question this list
 * answers is what the *folder* contains, which changes only when the dependency is bumped — and
 * `checkUpstreamCatalogueLanguages` fails the `guardrails` gate on exactly that. The consequence
 * is that adding a language to `availableLanguages` needs no change here: it is requested if the
 * vendor ships it and skipped if not, which `app-translate-loader.spec.ts` asserts by iterating
 * the configured list rather than by naming it.
 *
 * A language the vendor does not ship still renders the shared strings in **English**, through
 * the fallback language `initialiseAppConfigAndLanguage` sets. That is not fixed here and cannot
 * be: those catalogues do not exist upstream, which is DS-2803.
 */
export const UPSTREAM_FOLDERS: readonly UpstreamCatalogueFolder[] = [
  {
    path: 'assets/satori-ui',
    languages: [
      'de',
      'de-DE',
      'en',
      'en-AU',
      'en-US',
      'es',
      'es-ES',
      'fr',
      'fr-FR',
      'it',
      'it-IT',
      'pl',
      'pl-PL',
      'pt',
      'pt-PT',
    ],
  },
];

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
    // Only folders that ship this language. `catchError` stays on the ones that are asked: a
    // build without the asset glob, or a folder that answers 500, must still degrade rather
    // than leave the application with no strings at all.
    const folders$ = UPSTREAM_FOLDERS.filter((folder) => folder.languages.includes(lang)).map(
      (folder) =>
        this.http
          .get<unknown>(`${folder.path}/${TRANSLATION_DIRECTORY}/${encodeURIComponent(lang)}.json`)
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
