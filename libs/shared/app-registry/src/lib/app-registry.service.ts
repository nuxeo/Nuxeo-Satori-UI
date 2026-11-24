import { DOCUMENT } from '@angular/common';
import {
  HttpBackend,
  HttpClient,
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { Injectable, InjectionToken, Injector, computed, inject, signal } from '@angular/core';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import {
  Observable,
  TimeoutError,
  catchError,
  firstValueFrom,
  from,
  map,
  of,
  switchMap,
  throwError,
  timeout,
} from 'rxjs';

import {
  type AppRegistryListing,
  type RegistryApp,
  labelLanguagesOf,
  readAppRegistry,
} from './app-registry-file';

/** The app registry's address on the Nuxeo server, after sign-in (`AgenticUiAppsServlet`). */
export const APP_REGISTRY_PATH = '/nuxeo/agentic-ui-apps/';

/** As for the configuration's reads: `HttpClient` has no timeout of its own. */
export const APP_REGISTRY_TIMEOUT_MS = 10_000;

/** Where the app a person last chose is remembered, by its id, in `localStorage`. */
export const APP_REGISTRY_CHOICE_KEY = 'agentic-ui.app-registry.app';

/**
 * Asked of the server's basic authenticator: a 401 without `WWW-Authenticate`, so that a session
 * that has expired is said by the app, not by the browser's own sign-in prompt.
 */
const NO_PROMPT = new HttpHeaders({ 'X-No-Basic-Header': 'true' });

/**
 * Marks a request to the app registry, for the app's interceptor: a 401 from the registry must not
 * sign the person out. The registry adds to what the app shows; it is not what decides whether a
 * session is alive, and a server whose registry authenticates differently from its REST API, one
 * that lets `Anonymous` use the REST API and not the registry, would otherwise end every anonymous
 * session at startup. A session that has really expired is said by the next REST call.
 */
export const APP_REGISTRY_REQUEST = new HttpContextToken<boolean>(() => false);

const REGISTRY_CONTEXT = (): HttpContext => new HttpContext().set(APP_REGISTRY_REQUEST, true);

/**
 * The files of an app definition, as the engines read them: the home, the menu, a queue, a labels
 * file, a task form. By its path below the app's root, the place that says what it is
 * (docs/business-apps/app-definition-v2.md, section 1).
 */
export interface AppDefinitionFiles {
  /**
   * One file, as the package wrote it: its JSON, or the error `HttpClient` would give, a 404 when
   * nothing serves it.
   *
   * @param path the file's path below the app's root, such as `home.json` or `queues/open.json`
   * @param developmentUrl where the development server serves it, beside `bootstrap.json`, or
   *   `null` for a file the development server is known not to serve
   */
  file(path: string, developmentUrl: string | null): Observable<unknown>;

  /** The languages the open app has labels in, beside those the development server lists. */
  labelLanguages(): Observable<readonly string[]>;
}

/** A 404, as `HttpClient` gives one, for a file nothing serves. */
function notFound(url: string): HttpErrorResponse {
  return new HttpErrorResponse({ status: 404, statusText: 'Not Found', url });
}

/**
 * Where the engines read an app definition's files: the development server's addresses only, as
 * before the registry. The default, so that a host that does not provide the registry, a library's
 * own specs among them, reads exactly what it read before; the app provides
 * {@link AppRegistryService} in its place.
 */
export const APP_DEFINITION_FILES = new InjectionToken<AppDefinitionFiles>('APP_DEFINITION_FILES', {
  providedIn: 'root',
  factory: () => {
    const http = new HttpClient(inject(HttpBackend));
    return {
      file: (path, developmentUrl) =>
        developmentUrl === null
          ? throwError(() => notFound(path))
          : http.get<unknown>(developmentUrl),
      labelLanguages: () => of([]),
    };
  },
});

/** Reloads the page, so that every file of a newly opened app is read as at startup. */
export const APP_REGISTRY_RELOAD = new InjectionToken<() => void>('APP_REGISTRY_RELOAD', {
  providedIn: 'root',
  factory: () => {
    const view = inject(DOCUMENT).defaultView;
    return () => view?.location.reload();
  },
});

/** Where the choice of app is remembered; `null` where the browser keeps nothing. */
export const APP_REGISTRY_STORAGE = new InjectionToken<Storage | null>('APP_REGISTRY_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return inject(DOCUMENT).defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  },
});

/** What reading the registry found. */
export type AppRegistryState =
  | { readonly kind: 'pending' }
  /** The registry did not answer: none on this server, no one signed in, or a failed read. */
  | { readonly kind: 'none'; readonly reason: string }
  | ({ readonly kind: 'listed' } & AppRegistryListing);

/**
 * The app open: the one the person last chose, when they may still see it, or else the first the
 * registry lists, in the order packages contribute them. `null` when they may see none.
 */
export function chooseApp(
  apps: readonly RegistryApp[],
  remembered: string | null,
): RegistryApp | null {
  return apps.find((app) => app.id === remembered) ?? apps[0] ?? null;
}

function describe(error: unknown): string {
  if (error instanceof TimeoutError)
    return `no response within ${APP_REGISTRY_TIMEOUT_MS / 1000} s`;
  if (error instanceof HttpErrorResponse && error.status !== 0) {
    // A body that is not JSON, such as a sign-in page, comes back with the status of a success.
    return error.status >= 200 && error.status < 300 ? 'it is not JSON' : `HTTP ${error.status}`;
  }
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : 'the request failed';
}

function warn(message: string): void {
  console.warn(`[agentic-ui-apps] ${message}`);
}

/**
 * The app registry, as the shell reads it: which apps the person signed in may see, which one is
 * open, and where each file of its definition comes from (docs/business-apps/app-definition-v2.md,
 * section 10; architecture.md, section 7).
 *
 * - **The listing** is read once per page, after the configuration, through the interceptors, so
 *   with the person's credentials: the registry serves an app only to its groups. A registry that
 *   does not answer, as on a server without one, or before anyone signs in, is a registry with no
 *   app, and the app reads its files where it read them before.
 * - **A file** is read first where the development server serves it, beside `bootstrap.json`, as
 *   before the registry, and from the registry when nothing is served there (404) and the app open
 *   has the file. So a file `npm run config:dev` writes wins, whether or not the server behind the
 *   development server has a registry, and on a server, where those addresses are always 404, every
 *   file comes from the registry. A file the app open does not have is a 404, as before. A file
 *   the development server serves does not wait for the listing.
 * - **The app open** is fixed for the page: changing it, by "Switch app" or by signing in as someone
 *   whose apps differ, reloads the page, so that the menu and the labels, read once at startup, are
 *   the new app's too.
 *
 * Seeing an app is not a security control: the registry decides which apps the shell offers, and
 * Nuxeo's permissions still decide which records anyone reads.
 */
@Injectable({ providedIn: 'root' })
export class AppRegistryService implements AppDefinitionFiles {
  private readonly http = inject(HttpClient);
  /** The development server's addresses are read past the interceptors, as the configuration is. */
  private readonly direct = new HttpClient(inject(HttpBackend));
  private readonly injector = inject(Injector);
  private readonly reload = inject(APP_REGISTRY_RELOAD);
  private readonly storage = inject(APP_REGISTRY_STORAGE);

  private readonly listing = signal<AppRegistryState>({ kind: 'pending' });
  private readonly remembered = signal<string | null>(this.readChoice());
  private loading: Promise<void> | null = null;

  /** What the registry answered, once {@link load} has read it. */
  readonly state = this.listing.asReadonly();

  /** The apps the person may see, in the order packages contribute them; none when it did not answer. */
  readonly apps = computed<readonly RegistryApp[]>(() => {
    const state = this.listing();
    return state.kind === 'listed' ? state.apps : [];
  });

  /** The app open, for this page. */
  readonly current = computed<RegistryApp | null>(() => chooseApp(this.apps(), this.remembered()));

  /** Reads the listing, once per page. Never rejects: a failed read is a registry with no app. */
  load(): Promise<void> {
    this.loading ??= this.read().then((state) => {
      this.listing.set(state);
      this.report(state);
    });
    return this.loading;
  }

  /**
   * Reads the listing again, as after a sign-in. Resolves `true` when the app open would change, for
   * the caller to reload the page, and keeps the listing as it was: the page stays with the app it
   * was started with, whole, until it reloads, rather than reading another app's files under the
   * first app's menu. When it would not change, the new listing replaces the old, so "Switch app"
   * offers what the person may now see, unless `stillCurrent` says the answer has come too late,
   * for someone who has since signed out or been replaced.
   */
  async refresh(stillCurrent: () => boolean = () => true): Promise<boolean> {
    await this.load();
    const before = this.current()?.id ?? null;
    const state = await this.read();
    const apps = state.kind === 'listed' ? state.apps : [];
    const after = chooseApp(apps, this.remembered())?.id ?? null;
    if (after === before) {
      if (stillCurrent()) this.listing.set(state);
      return false;
    }
    return true;
  }

  /** Opens another app: remembered, then the page reloads with it. */
  choose(id: string): void {
    try {
      this.storage?.setItem(APP_REGISTRY_CHOICE_KEY, id);
    } catch {
      // A browser that keeps nothing still opens the app, for this page.
    }
    if (id !== this.current()?.id) this.reload();
  }

  /** Where the registry serves one of an app's files. */
  fileUrl(app: RegistryApp, path: string): string {
    return `${this.origin()}${APP_REGISTRY_PATH}${app.url}${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  file(path: string, developmentUrl: string | null): Observable<unknown> {
    // The registry's answer, for the app open, once the listing is read; a 404 when the app open
    // does not have the file, as when there is no registry.
    const fromRegistry = (missing: () => unknown): Observable<unknown> =>
      from(this.load()).pipe(
        switchMap(() => {
          const app = this.current();
          return app && app.files.includes(path)
            ? this.http
                .get<unknown>(this.fileUrl(app, path), {
                  headers: NO_PROMPT,
                  context: REGISTRY_CONTEXT(),
                })
                .pipe(timeout(APP_REGISTRY_TIMEOUT_MS))
            : throwError(missing);
        }),
      );
    if (developmentUrl === null) return fromRegistry(() => notFound(path));
    // The development server first, and without waiting for the listing: a file it serves does
    // not wait on the registry, however slow the registry is to answer.
    return this.direct
      .get<unknown>(developmentUrl)
      .pipe(
        catchError((error: unknown) =>
          error instanceof HttpErrorResponse && error.status === 404
            ? fromRegistry(() => error)
            : throwError(() => error),
        ),
      );
  }

  labelLanguages(): Observable<readonly string[]> {
    return from(this.load()).pipe(map(() => labelLanguagesOf(this.current())));
  }

  private origin(): string {
    return this.injector.get(NUXEO_API_ORIGIN).replace(/\/$/, '');
  }

  private async read(): Promise<AppRegistryState> {
    try {
      // First: `NUXEO_API_ORIGIN` is read from the configuration once and kept, so asking for it
      // before the configuration loads would pin the default for the session.
      await this.injector.get(AppConfigService).load();
      const raw = await firstValueFrom(
        this.http
          .get<unknown>(`${this.origin()}${APP_REGISTRY_PATH}apps.json`, {
            headers: NO_PROMPT,
            context: REGISTRY_CONTEXT(),
          })
          .pipe(
            timeout(APP_REGISTRY_TIMEOUT_MS),
            catchError((error: unknown) => throwError(() => new Error(describe(error)))),
          ),
      );
      const read = readAppRegistry(raw);
      return 'invalid' in read
        ? { kind: 'none', reason: read.invalid }
        : { kind: 'listed', ...read };
    } catch (error) {
      return { kind: 'none', reason: describe(error) };
    }
  }

  /** The console is where support finds what the registry said, as for the configuration. */
  private report(state: AppRegistryState): void {
    if (state.kind === 'none') {
      // No registry on this server (404), or no one signed in yet (401): the ordinary cases, said
      // nowhere. Anything else is a registry that answered and could not be read.
      if (!/^HTTP 40[14]$/.test(state.reason)) warn(`no app registry: ${state.reason}`);
      return;
    }
    if (state.kind !== 'listed') return;
    for (const refused of state.refused) warn(`${refused}; the app is not offered`);
    for (const diagnostic of state.diagnostics) {
      if (diagnostic.level === 'error' || diagnostic.level === 'warning') {
        warn(`${diagnostic.app ? `${diagnostic.app}: ` : ''}${diagnostic.message}`);
      }
    }
  }

  private readChoice(): string | null {
    try {
      return this.storage?.getItem(APP_REGISTRY_CHOICE_KEY) ?? null;
    } catch {
      return null;
    }
  }
}
