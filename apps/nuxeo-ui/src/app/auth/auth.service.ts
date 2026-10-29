import { HttpClient, HttpContext, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import {
  Observable,
  catchError,
  defer,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import {
  AUTH_TOKEN_HEADER,
  readShareTokenFromBrowserUrl,
  stripShareTokenFromBrowserUrl,
} from './share-token.util';
import { NUXEO_ESTABLISH_BROWSER_SESSION } from './nuxeo-auth.context';

import {
  BrowseContextService,
  ClipboardTargetService,
  NUXEO_API_ORIGIN,
  NUXEO_SAML_LOGIN_ENDPOINTS,
  NUXEO_SSO_POST_LOGIN_PATH,
  NUXEO_SSO_RETURN_QUERY_PARAM,
  SelectionService,
  isPowerUserFromGroups,
  readGroupsFromMe,
  type NuxeoSamlLoginEndpoint,
} from '@nuxeo/satori-platform/nuxeo-client';

const STORAGE_KEY = 'agentic_ui_nuxeo_session';
const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

interface BasicStoredSession {
  kind: 'basic';
  username: string;
  basic: string;
  isAdministrator: boolean;
  groups: string[];
}

interface CookieStoredSession {
  kind: 'cookie';
  username: string;
  isAdministrator: boolean;
  groups: string[];
}

type StoredSession = BasicStoredSession | CookieStoredSession;

/** Legacy payload before `kind` was introduced. */
interface LegacyStoredSession {
  username: string;
  basic: string;
  isAdministrator: boolean;
  groups?: string[];
}

/** Nuxeo may return boolean, string, or numeric 1 depending on marshaller/version. */
function isTruthyAdministratorFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

/** Reads admin flag from Nuxeo `GET /me` (shape varies slightly by version). */
function readIsAdministratorFromMe(me: unknown): boolean {
  if (!me || typeof me !== 'object') return false;
  const o = me as Record<string, unknown>;
  if (isTruthyAdministratorFlag(o['isAdministrator'])) return true;
  const props = o['properties'];
  if (props && typeof props === 'object') {
    const p = (props as Record<string, unknown>)['isAdministrator'];
    if (isTruthyAdministratorFlag(p)) return true;
  }
  return false;
}

function readUsernameFromMe(me: unknown): string | null {
  if (!me || typeof me !== 'object') return null;
  const id = (me as Record<string, unknown>)['id'];
  if (typeof id === 'string' && id.length > 0) return id;
  const props = (me as Record<string, unknown>)['properties'];
  if (props && typeof props === 'object') {
    const u = (props as Record<string, unknown>)['username'];
    if (typeof u === 'string' && u.length > 0) return u;
  }
  return null;
}

/** Default Nuxeo built-in admin user id — used if `/me` omits `isAdministrator`. */
function isBuiltInAdministratorUsername(username: string): boolean {
  return username.trim().toLowerCase() === 'administrator';
}

function readSessionFlagsFromMe(me: unknown): { isAdministrator: boolean; groups: string[] } {
  return {
    isAdministrator: readIsAdministratorFromMe(me),
    groups: readGroupsFromMe(me),
  };
}

/** A sign-in failure the login page shows to the user, by catalogue key. */
export class SignInError extends Error {
  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = 'SignInError';
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private readonly apiOrigin = inject(NUXEO_API_ORIGIN);
  private readonly samlEndpoints = inject(NUXEO_SAML_LOGIN_ENDPOINTS);
  private readonly ssoPostLoginPath = inject(NUXEO_SSO_POST_LOGIN_PATH);
  private readonly ssoReturnQueryParam = inject(NUXEO_SSO_RETURN_QUERY_PARAM);

  /**
   * Set once `/nuxeo/logout` has answered 404, so the probe is not repeated.
   *
   * Static because the absence is a property of the Nuxeo being talked to, not of an injector —
   * and `AuthService` is a root singleton anyway, so this only matters for tests, which reset it
   * through {@link resetNuxeoLogoutProbe}.
   */
  private static nuxeoLogoutEndpointAbsent = false;

  /** Test seam: forget that `/nuxeo/logout` was missing. */
  static resetNuxeoLogoutProbe(): void {
    AuthService.nuxeoLogoutEndpointAbsent = false;
  }

  private readonly state = signal<StoredSession | null>(null);
  private hydration$: Observable<void> | null = null;
  /** In-memory token for Instant Share / external permission links (Nuxeo TOKEN_AUTH). */
  private shareAuthTokenValue: string | null = null;

  readonly samlLoginOptions = computed(() => this.samlEndpoints);

  readonly username = computed(() => this.state()?.username ?? null);
  readonly isAuthenticated = computed(() => this.state() !== null);
  /**
   * True when Nuxeo reports administrator on `/me`, or when using the built-in
   * `Administrator` account and the API omitted the flag (common with older sessions).
   */
  readonly isAdministrator = computed(() => {
    const s = this.state();
    if (!s) return false;
    if (s.isAdministrator) return true;
    return isBuiltInAdministratorUsername(s.username);
  });
  readonly isPowerUser = computed(() => {
    const s = this.state();
    if (!s) return false;
    return isPowerUserFromGroups(s.groups);
  });
  readonly hasAdministrationAccess = computed(() => this.isAdministrator() || this.isPowerUser());

  constructor() {
    this.restoreSession();
    if (this.state()) {
      // Validation deferred to ensureHydrated() on first navigation
    }
  }

  private apiUrl(path: string): string {
    const base = this.apiOrigin.replace(/\/$/, '');
    return `${base}${path}`;
  }

  /**
   * Clears a stale Nuxeo browser session (JSESSIONID) before password login or hydration.
   * Same-origin `/nuxeo/**` requests always send cookies; an old cookie can override Basic auth.
   *
   * **Not every Nuxeo serves this endpoint.** A headless instance with no JSF web module answers
   * `/nuxeo/logout` with 404 — measured against the local Docker stack, where `/nuxeo/logout`,
   * `/nuxeo/logout.faces` and `/nuxeo/nxstartup.faces?nxo=logout` all 404. The call is therefore
   * best-effort, as the `catchError` always implied, and a 404 is remembered so the request is
   * attempted once per page load instead of on every login and every hydration. Each failed
   * attempt put a console error in front of whoever was debugging something else.
   *
   * Remembering it does not weaken the guard: where the endpoint is absent it never cleared
   * anything to begin with. What keeps a stale cookie from overriding Basic auth on this path is
   * that the login probe and `fetchMe()` both run without `withCredentials`, so no cookie is sent;
   * `establishBasicAuthBrowserSession()` is the one call that deliberately opts in.
   */
  private clearStaleNuxeoCookieSession(): Observable<void> {
    if (AuthService.nuxeoLogoutEndpointAbsent) {
      return of(undefined);
    }
    return this.http
      .get(this.apiUrl('/nuxeo/logout'), {
        withCredentials: true,
        responseType: 'text',
      })
      .pipe(
        map(() => undefined),
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) {
            AuthService.nuxeoLogoutEndpointAbsent = true;
          }
          return of(undefined);
        }),
      );
  }

  private applyBasicSessionFromMe(existing: BasicStoredSession, me: unknown): void {
    const flags = readSessionFlagsFromMe(me);
    this.state.set({
      kind: 'basic',
      username: existing.username,
      basic: existing.basic,
      isAdministrator: flags.isAdministrator,
      groups: flags.groups,
    });
    const remember = localStorage.getItem(STORAGE_KEY) !== null;
    this.persist(this.state()!, remember);
  }

  private fetchMe(): Observable<unknown> {
    return this.http.get<unknown>(this.apiUrl('/nuxeo/api/v1/me'), {
      headers: { Accept: 'application/json' },
    });
  }

  /**
   * After password login or hydration, establish a same-origin Nuxeo browser session
   * (JSESSIONID) so embedded note `<img src="/nuxeo/nxfile/...">` loads without headers.
   */
  private establishBasicAuthBrowserSession(): Observable<void> {
    if (this.state()?.kind !== 'basic') {
      return of(undefined);
    }
    return this.http
      .get(this.apiUrl('/nuxeo/api/v1/me'), {
        headers: { Accept: 'application/json' },
        withCredentials: true,
        context: new HttpContext().set(NUXEO_ESTABLISH_BROWSER_SESSION, true),
      })
      .pipe(
        map(() => undefined),
        catchError(() => of(undefined)),
      );
  }

  private isInvalidBasicAuthResponse(err: unknown): boolean {
    return err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403);
  }

  private isExplicitlySignedOut(): boolean {
    return sessionStorage.getItem(SIGNED_OUT_KEY) === '1';
  }

  private markSignedOut(): void {
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');
  }

  private clearSignedOut(): void {
    sessionStorage.removeItem(SIGNED_OUT_KEY);
  }

  /** Public Nuxeo origin for full-page SAML redirects (matches API proxy in dev when origin is ''). */
  private nuxeoBrowserOrigin(): string {
    const o = this.apiOrigin.replace(/\/$/, '');
    if (o) return o;
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
  }

  private restoreSession(): void {
    const raw = sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as StoredSession | LegacyStoredSession;
      if (parsed && typeof parsed === 'object' && 'username' in parsed) {
        if ('kind' in parsed && parsed.kind === 'cookie') {
          const c = parsed as CookieStoredSession;
          if (c.username) {
            this.state.set({
              kind: 'cookie',
              username: c.username,
              isAdministrator: c.isAdministrator ?? false,
              groups: c.groups ?? [],
            });
          }
          return;
        }
        if ('kind' in parsed && parsed.kind === 'basic') {
          const b = parsed as BasicStoredSession;
          if (b.username && b.basic) {
            this.state.set({
              kind: 'basic',
              username: b.username,
              basic: b.basic,
              isAdministrator: b.isAdministrator ?? false,
              groups: b.groups ?? [],
            });
          }
          return;
        }
        const legacy = parsed as LegacyStoredSession;
        if (legacy.username && legacy.basic) {
          this.state.set({
            kind: 'basic',
            username: legacy.username,
            basic: legacy.basic,
            isAdministrator: legacy.isAdministrator ?? false,
            groups: legacy.groups ?? [],
          });
        }
      }
    } catch {
      this.clearStorage();
    }
  }

  private persist(session: StoredSession, remember: boolean): void {
    this.clearStorage();
    const payload = JSON.stringify(session);
    if (remember) {
      localStorage.setItem(STORAGE_KEY, payload);
    } else {
      sessionStorage.setItem(STORAGE_KEY, payload);
    }
  }

  private clearStorage(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Run once per app load: validate stored session or detect Nuxeo SSO cookie via `/me`.
   */
  ensureHydrated(): Observable<void> {
    if (this.hydration$) return this.hydration$;
    this.hydration$ = defer(() => this.runHydration()).pipe(shareReplay(1));
    return this.hydration$;
  }

  /** Token from an external share email link, used only during TOKEN_AUTH bootstrap. */
  shareAuthToken(): string | null {
    return this.shareAuthTokenValue;
  }

  private runHydration(): Observable<void> {
    const shareToken = readShareTokenFromBrowserUrl();
    if (shareToken) {
      stripShareTokenFromBrowserUrl();
      return this.authenticateWithShareToken(shareToken).pipe(
        switchMap(() => (this.isAuthenticated() ? of(undefined) : this.runHydration())),
      );
    }

    if (this.isExplicitlySignedOut()) {
      this.state.set(null);
      this.clearStorage();
      return of(undefined);
    }

    const existing = this.state();
    if (existing) {
      if (existing.kind === 'basic') {
        return this.clearStaleNuxeoCookieSession().pipe(
          switchMap(() => this.fetchMe()),
          tap((me) => this.applyBasicSessionFromMe(existing, me)),
          switchMap(() => this.establishBasicAuthBrowserSession()),
          map(() => undefined),
          catchError((err) => {
            if (this.isInvalidBasicAuthResponse(err)) {
              this.logout();
            }
            return of(undefined);
          }),
        );
      }

      return this.fetchMe().pipe(
        tap((me) => {
          const user = readUsernameFromMe(me);
          if (!user) {
            this.state.set(null);
            this.clearStorage();
            return;
          }
          const flags = readSessionFlagsFromMe(me);
          const cookieSession: CookieStoredSession = {
            kind: 'cookie',
            username: user,
            isAdministrator: flags.isAdministrator,
            groups: flags.groups,
          };
          this.state.set(cookieSession);
          this.persistCookie(cookieSession);
        }),
        map(() => undefined),
        catchError(() => {
          this.state.set(null);
          this.clearStorage();
          return this.tryEstablishCookieSessionOnly();
        }),
      );
    }
    return this.tryEstablishCookieSessionOnly();
  }

  private tryEstablishCookieSessionOnly(): Observable<void> {
    return this.http
      .get<unknown>(this.apiUrl('/nuxeo/api/v1/me'), { headers: { Accept: 'application/json' } })
      .pipe(
        tap((me) => {
          const user = readUsernameFromMe(me);
          if (!user) return;
          const flags = readSessionFlagsFromMe(me);
          const session: CookieStoredSession = {
            kind: 'cookie',
            username: user,
            isAdministrator: flags.isAdministrator,
            groups: flags.groups,
          };
          this.state.set(session);
          this.persistCookie(session);
        }),
        map(() => undefined),
        catchError(() => of(undefined)),
      );
  }

  private persistCookie(session: CookieStoredSession): void {
    this.clearStorage();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  /**
   * Start SAML / browser SSO: full window navigation to Nuxeo.
   */
  startSamlLogin(endpoint: NuxeoSamlLoginEndpoint): void {
    if (typeof window === 'undefined') return;
    this.clearSignedOut();
    const base = this.nuxeoBrowserOrigin();
    let path = endpoint.path.trim();
    if (!path.startsWith('/')) path = `/${path}`;
    const url = new URL(path, `${base}/`);
    if (this.ssoReturnQueryParam) {
      const path = this.ssoPostLoginPath.startsWith('/')
        ? this.ssoPostLoginPath
        : `/${this.ssoPostLoginPath}`;
      const returnTo = `${window.location.origin}${path}`;
      url.searchParams.set(this.ssoReturnQueryParam, returnTo);
    }
    window.location.assign(url.toString());
  }

  /**
   * Authenticates a transient external user via the Instant Share token from an email link.
   * Sends the token in {@link AUTH_TOKEN_HEADER} only (not the URL) to avoid log/proxy leakage.
   */
  authenticateWithShareToken(token: string): Observable<void> {
    const trimmed = token.trim();
    if (!trimmed) {
      return of(undefined);
    }

    this.clearSignedOut();
    this.state.set(null);
    this.clearStorage();
    this.shareAuthTokenValue = trimmed;

    const headers = new HttpHeaders({
      Accept: 'application/json',
      [AUTH_TOKEN_HEADER]: trimmed,
    });

    return this.http
      .get<unknown>(this.apiUrl('/nuxeo/api/v1/me'), {
        headers,
        withCredentials: true,
      })
      .pipe(
        tap((me) => {
          const user = readUsernameFromMe(me);
          if (!user) {
            this.clearShareAuth();
            return;
          }
          const flags = readSessionFlagsFromMe(me);
          const session: CookieStoredSession = {
            kind: 'cookie',
            username: user,
            isAdministrator: flags.isAdministrator,
            groups: flags.groups,
          };
          this.state.set(session);
          this.persistCookie(session);
          this.clearShareAuth();
        }),
        map(() => undefined),
        catchError(() => {
          this.clearShareAuth();
          return of(undefined);
        }),
      );
  }

  /**
   * Validates credentials against Nuxeo (`GET /nuxeo/api/v1/me`).
   */
  login(username: string, password: string, remember: boolean): Observable<void> {
    // Drop any prior session so Nuxeo requests use only the new credentials.
    this.clearShareAuth();
    this.state.set(null);
    this.clearStorage();
    this.hydration$ = null;

    const trimmed = username.trim();
    const basic = btoa(`${trimmed}:${password}`);
    const headers = new HttpHeaders({
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    });

    return this.clearStaleNuxeoCookieSession().pipe(
      switchMap(() =>
        this.http
          .get<unknown>(this.apiUrl('/nuxeo/api/v1/me'), { headers, withCredentials: false })
          .pipe(
            tap((me) => {
              const flags = readSessionFlagsFromMe(me);
              const session: BasicStoredSession = {
                kind: 'basic',
                username: trimmed,
                basic,
                isAdministrator: flags.isAdministrator,
                groups: flags.groups,
              };
              this.state.set(session);
              this.persist(session, remember);
              this.clearSignedOut();
              this.hydration$ = of(undefined).pipe(shareReplay(1));
            }),
            switchMap(() => this.establishBasicAuthBrowserSession()),
            map(() => undefined),
            catchError((err) =>
              throwError(
                () =>
                  new SignInError(
                    err?.status === 401 || err?.status === 403
                      ? 'login.message.invalid-credentials'
                      : 'login.message.server-unreachable',
                  ),
              ),
            ),
          ),
      ),
    );
  }

  /**
   * Clears local session state and marks the browser session as explicitly signed out.
   */
  logout(): void {
    this.clearUserScopedUiState();
    this.clearShareAuth();
    this.state.set(null);
    this.clearStorage();
    this.markSignedOut();
    this.hydration$ = null;
  }

  private clearShareAuth(): void {
    this.shareAuthTokenValue = null;
  }

  private clearUserScopedUiState(): void {
    // Resolve lazily — eager inject() here would create a DI cycle via CURRENT_USERNAME.
    this.injector.get(SelectionService).resetUiState();
    this.injector.get(BrowseContextService).resetContext();
    this.injector.get(ClipboardTargetService).clear();
  }

  /**
   * Refreshes `/me` so `isAdministrator` stays accurate (e.g. after restoring an older session).
   * No-op when not authenticated.
   */
  refreshCurrentUser(): Observable<void> {
    const session = this.state();
    if (!session) {
      return of(undefined);
    }
    if (session.kind === 'basic') {
      return this.clearStaleNuxeoCookieSession().pipe(
        switchMap(() => this.fetchMe()),
        tap((me) => this.applyBasicSessionFromMe(session, me)),
        map(() => undefined),
        catchError((err) => {
          if (this.isInvalidBasicAuthResponse(err)) {
            this.logout();
          }
          return of(undefined);
        }),
      );
    }

    return this.fetchMe().pipe(
      tap((me) => {
        const user = readUsernameFromMe(me);
        if (!user) {
          this.logout();
          return;
        }
        const flags = readSessionFlagsFromMe(me);
        const next: CookieStoredSession = {
          kind: 'cookie',
          username: user,
          isAdministrator: flags.isAdministrator,
          groups: flags.groups,
        };
        this.state.set(next);
        this.persistCookie(next);
      }),
      map(() => undefined),
    );
  }

  /** Value for `Authorization: Basic …` (without the prefix). */
  basicCredentials(): string | null {
    const s = this.state();
    return s?.kind === 'basic' ? s.basic : null;
  }
}
