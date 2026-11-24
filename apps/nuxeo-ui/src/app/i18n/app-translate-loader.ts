import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { validateLabels } from '@agentic-ui/shared/app-definition';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import { APP_BOOTSTRAP_CONFIG_URL, AppConfigService } from '@nuxeo/satori-platform/app-config';
import { layoutsIndexUrl, readLayoutIndex } from '@agentic-ui/shared/document-layouts';
import { TranslateLoader } from '@ngx-translate/core';
import {
  Observable,
  TimeoutError,
  catchError,
  forkJoin,
  map,
  of,
  shareReplay,
  switchMap,
  timeout,
} from 'rxjs';

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
  /**
   * The catalogue to request for an application language the folder does not ship by that name.
   *
   * The application's languages are bare codes (`en`, `fr`, the names of its own catalogues in
   * `public/i18n/`). `@hylandsoftware/satori-ui` shipped bare-named copies of its catalogues up to
   * `1.0.0-alpha.201`; `1.0.0` ships regional names only (`en-US`, `fr-FR`, …). Without this
   * map every language would stop matching, and the `sat.*` keys would vanish in all of them,
   * including the accessible name of `sat-platform-nav`'s toggle.
   *
   * Each value must be one of `languages`. `app-translate-loader.spec.ts` asserts that, so a
   * vendor bump that drops a target fails a test instead of falling back to English with no
   * error.
   */
  readonly aliases?: Readonly<Record<string, string>>;
}

/**
 * The catalogue `folder` should be asked for when the application is in `lang`, or `null` when
 * it ships nothing for that language. A language shipped under its own name wins over an alias.
 */
export function upstreamCatalogueFor(folder: UpstreamCatalogueFolder, lang: string): string | null {
  if (folder.languages.includes(lang)) return lang;
  const alias = folder.aliases?.[lang];
  return alias !== undefined && folder.languages.includes(alias) ? alias : null;
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
 * A folder is asked only for a language it ships, directly or through `aliases`.
 * `@hylandsoftware/satori-ui@1.0.0` ships regional catalogues only, and `availableLanguages` advertises more
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
    languages: ['de-DE', 'en-AU', 'en-US', 'es-ES', 'fr-FR', 'it-IT', 'pl-PL', 'pt-PT'],
    // Each bare name maps to the region whose strings it carried: in 1.0.0-alpha.171 all 54 keys
    // of `en.json` equal `en-US.json` (`en-AU` differs in two), and each other bare file equals
    // its one regional sibling.
    aliases: {
      de: 'de-DE',
      en: 'en-US',
      es: 'es-ES',
      fr: 'fr-FR',
      it: 'it-IT',
      pl: 'pl-PL',
      pt: 'pt-PT',
    },
  },
];

/**
 * Where a package's labels for `lang` are read from: `labels/<lang>.json`, in the directory
 * `bootstrap.json` is served from (app-definition-v2.md, section 7).
 */
export function packageLabelsUrl(bootstrapUrl: string, lang: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return `${path.slice(0, path.lastIndexOf('/') + 1)}labels/${encodeURIComponent(lang)}.json`;
}

/**
 * How long the index and the labels file may take between them, as long as a layout gets: the
 * translations, and so the app's start, wait on both.
 */
const LABELS_TIMEOUT_MS = 10_000;

/** Why a read failed, as the console says it: a body that did not parse answers 200. */
function readFailure(error: unknown): string {
  if (error instanceof TimeoutError) return `no response within ${LABELS_TIMEOUT_MS / 1000} s`;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 200 && status < 300) return 'it is not JSON';
  if (typeof status === 'number' && status !== 0) return `HTTP ${status}`;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'the request failed';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The labels a package's file gives, read as the layouts are read: tolerantly. A file that is not
 * a version 2 labels file gives none; a key or a text the validator refuses is left out on its own.
 * The console says why, as it does for a layout.
 */
export function readPackageLabels(raw: unknown, source: string): Record<string, string> {
  if (!isRecord(raw) || raw['version'] !== 2 || !isRecord(raw['labels'])) {
    console.warn(`[agentic-ui-config] ${source} ignored: it is not a version 2 labels file`);
    return {};
  }
  const findings = validateLabels(raw);
  const refused = new Set(findings.map((finding) => finding.path));
  for (const finding of findings) {
    console.warn(`[agentic-ui-config] ${source}: ${finding.path}: ${finding.message}; left out`);
  }
  const labels: Record<string, string> = {};
  for (const [key, text] of Object.entries(raw['labels'])) {
    if (typeof text === 'string' && !refused.has(`labels[${JSON.stringify(key)}]`)) {
      labels[key] = text;
    }
  }
  return labels;
}

/**
 * Loads the shipped translation catalogue and layers the manifest's `labels` over it.
 *
 * That second step is the Layer 0 point of this class: relabelling the product for a
 * customer is a manifest edit, not a rebuild. The English catalogue is also compiled in
 * as a fallback, so a failed fetch degrades to English rather than to raw keys.
 *
 * Precedence, lowest to highest: upstream folders, this app's catalogue, the business app's own
 * labels for the language, and the manifest's `labels`. A package's labels come before the
 * platform's catalogue, as app-definition-v2.md section 7 asks, and a customer's relabelling still
 * wins over all of them, which is the point of Layer 0.
 *
 * A package's labels file is asked for only in a language something lists, so that nothing is
 * asked for that cannot be there: the layouts index of the development server, which
 * `npm run config:dev -- --labels` writes, serving the file at `labels/<lang>.json` beside
 * `bootstrap.json`, or the app registry, for the app open, which lists the app's files after sign-in
 * (`APP_DEFINITION_FILES`). A language both list is read from the development server first, and
 * from the registry when nothing is served there. A listed file that cannot be read is said in the
 * console, and its labels are absent.
 *
 * The index is read here, once per session for every language, and only when the configuration
 * service answered for the bootstrap: where it did not, as under a bare `nx serve`, there is no
 * index to ask for. It and the labels file are read without the interceptors, as every read of the
 * configuration's address is: no `Authorization` header, and no activity for the idle timer. It is
 * not read through `DocumentLayoutService`, whose Nuxeo client would be built before the
 * configuration's Nuxeo origin is applied.
 */
@Injectable({ providedIn: 'root' })
export class AppTranslateLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AppConfigService);
  private readonly bootstrapUrl = inject(APP_BOOTSTRAP_CONFIG_URL);
  /** The configuration's own address is read without the interceptors, as the layouts are. */
  private readonly configHttp = new HttpClient(inject(HttpBackend));
  /** Where a labels file is read from: the development server's address, then the app registry's. */
  private readonly files = inject(APP_DEFINITION_FILES);
  private labelLanguages$: Observable<LabelLanguages> | null = null;

  getTranslation(lang: string): Observable<Record<string, string>> {
    // Only folders that ship this language. `catchError` stays on the ones that are asked: a
    // build without the asset glob, or a folder that answers 500, must still degrade rather
    // than leave the application with no strings at all.
    const folders$ = UPSTREAM_FOLDERS.flatMap((folder) => {
      const catalogue = upstreamCatalogueFor(folder, lang);
      return catalogue === null
        ? []
        : [
            this.http
              .get<unknown>(
                `${folder.path}/${TRANSLATION_DIRECTORY}/${encodeURIComponent(catalogue)}.json`,
              )
              .pipe(catchError(() => of({}))),
          ];
    });
    const app$ = this.http
      .get<unknown>(translationUrl(lang, document.baseURI))
      .pipe(catchError(() => of(EN_FALLBACK_TRANSLATIONS)));
    const labelsUrl = packageLabelsUrl(this.bootstrapUrl, lang);
    const labelsPath = `labels/${lang}.json`;
    const package$ = this.labelLanguages().pipe(
      switchMap(({ development, registry }) => {
        if (!development.includes(lang) && !registry.includes(lang)) return of({});
        // Named as the development server serves it where that is where it is asked first.
        const source = development.includes(lang) ? labelsUrl : `the app registry's ${labelsPath}`;
        return this.files.file(labelsPath, development.includes(lang) ? labelsUrl : null).pipe(
          map((raw) => readPackageLabels(raw, source)),
          catchError((error: unknown) => {
            console.warn(`[agentic-ui-config] ${source} not read: ${readFailure(error)}`);
            return of({});
          }),
        );
      }),
      // One limit for the index and the file together, so the start waits on one at most.
      timeout(LABELS_TIMEOUT_MS),
      catchError((error: unknown) => {
        console.warn(`[agentic-ui-config] labels for ${lang} not read: ${readFailure(error)}`);
        return of({});
      }),
    );

    return forkJoin([...folders$, app$, package$]).pipe(
      map((catalogues) => {
        const labels = catalogues.pop() as Record<string, string>;
        const app = catalogues.pop();
        const folders = catalogues.reduce<Record<string, string>>(
          (acc, catalogue) => ({ ...acc, ...flattenCatalogue(catalogue) }),
          {},
        );
        return {
          ...folders,
          ...flattenCatalogue(app),
          ...labels,
          ...this.config.manifest().labels,
        };
      }),
    );
  }

  /**
   * The languages a business app has labels in, read once per session: those the layouts index of
   * the development server lists, and those the app registry lists for the app open.
   */
  private labelLanguages(): Observable<LabelLanguages> {
    this.labelLanguages$ ??= forkJoin({
      development: this.developmentLabelLanguages(),
      registry: this.files.labelLanguages().pipe(catchError(() => of<readonly string[]>([]))),
    }).pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.labelLanguages$;
  }

  /**
   * The languages the layouts index lists a business app's labels in. None where the configuration
   * service did not answer, or the index cannot be read, which the console is told. Only the
   * development server's index lists any: the configuration servlet's lists none.
   */
  private developmentLabelLanguages(): Observable<readonly string[]> {
    if (this.config.diagnostics().bootstrapSource !== 'configuration-service') return of([]);
    const url = layoutsIndexUrl(this.bootstrapUrl);
    return this.configHttp.get<unknown>(url).pipe(
      map((raw) => {
        const index = readLayoutIndex(raw);
        if ('invalid' in index) {
          console.warn(`[agentic-ui-config] labels not listed: ${url} ignored: ${index.invalid}`);
          return [];
        }
        return index.labelLanguages;
      }),
      catchError((error: unknown) => {
        console.warn(
          `[agentic-ui-config] labels not listed: ${url} not read: ${readFailure(error)}`,
        );
        return of([]);
      }),
    );
  }
}

/** Where each language's labels file is listed: by the development server, or by the registry. */
interface LabelLanguages {
  readonly development: readonly string[];
  readonly registry: readonly string[];
}
