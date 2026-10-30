import { DOCUMENT } from '@angular/common';
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

/**
 * `new URL` without the throw, so a misconfigured origin or path fails closed rather than
 * throwing out of a click handler. `URL.parse` would do, but only browsers from 2024 have it.
 */
function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** Everything {@link resolveSsoLoginUrl} reads, so the rule itself touches no DOM. */
export interface SsoLoginRequest {
  /** `sso.endpoints[].path` exactly as configured. */
  readonly path: string;
  /** Where SSO is served from: `NUXEO_API_ORIGIN`, or this application's origin when it is blank. */
  readonly nuxeoOrigin: string;
  /** This application's origin, which the post-login return URL must stay on. */
  readonly appOrigin: string;
  /** `sso.returnQueryParam`; `null` or blank sends no return URL at all. */
  readonly returnQueryParam: string | null;
  /** `sso.postLoginPath` — a path on this application, not on Nuxeo. */
  readonly postLoginPath: string;
}

/**
 * Where an SSO button may send the browser, or why it may not. `warning` reports a second value
 * that was dropped without the navigation itself being refused.
 */
export type SsoLoginTarget =
  { readonly url: string; readonly warning?: string } | { readonly refused: string };

/**
 * The URL an SSO button may send the browser to, or why the configured endpoint may not be opened.
 *
 * **This is the security boundary for `sso.endpoints[].path`**, by the same argument that makes
 * `resolveBrandingLogoUrl` the boundary for a configured logo: it is the last point before the
 * browser is sent somewhere, so it judges the URL that will actually be loaded rather than the
 * string someone wrote. `bootstrap-config.ts` refuses the plainly wrong forms earlier, so no
 * button is rendered for them, but that cannot be the boundary — `NUXEO_SAML_LOGIN_ENDPOINTS` is
 * a token any host application can fill with endpoints that never went through the merge.
 *
 * The condition is `url.origin !== base.origin`, not a list of refused prefixes, because the
 * parser reaches an authority from more shapes than a string check can enumerate:
 * `//evil.example/sso` and `/\evil.example/sso` both resolve to `evil.example`, and so does
 * `/<TAB>/evil.example` once the parser has dropped the tab — which is why the prefix pair
 * NXSAT-731 suggested would not have closed this. One comparison closes the class, and it stays
 * closed whatever normalisation a future browser adds (NXSAT-731).
 *
 * `postLoginPath` is resolved and checked the same way. It reaches the browser the long way round,
 * as the `requestedUrl` Nuxeo redirects to after sign-in. A bad one drops the parameter rather
 * than refusing the sign-in: the return path is a convenience, and blocking SSO altogether over it
 * would be a worse outcome than landing on Nuxeo's own default page.
 *
 * Pure and exported for one reason: it is where the rule lives, and a rule that cannot be
 * exercised without a browser navigation is a rule nothing asserts.
 */
export function resolveSsoLoginUrl(request: SsoLoginRequest): SsoLoginTarget {
  // The trailing slash keeps a bare origin a usable base; parsed rather than interpolated so a
  // malformed `nuxeoApiOrigin` fails closed here instead of throwing out of a click handler.
  const base = parseUrl(`${request.nuxeoOrigin.replace(/\/+$/, '')}/`);
  if (base === null || !isHttpUrl(base)) {
    return {
      refused: `cannot be resolved: "${request.nuxeoOrigin}" is not an http(s) Nuxeo origin`,
    };
  }
  const trimmed = request.path.trim();
  // Refused before the leniency below rather than left to the origin comparison. A value with a
  // scheme is an absolute address, and prepending a slash to one turns `https://evil.example/sso`
  // into the path `/https://evil.example/sso` — on the Nuxeo origin, so the comparison allows it,
  // and a 404 is all the administrator ever sees. The scheme is named for the same reason as in
  // `describeLogoSrcForm`: `javascript:` and `https:` are very different mistakes.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1];
  if (scheme !== undefined) {
    return {
      refused: `is an absolute "${scheme.toLowerCase()}:" address rather than a path on the Nuxeo origin`,
    };
  }
  // A path written without its leading slash is a typo worth tolerating, and after the check
  // above it cannot carry an authority of its own.
  const url = parseUrl(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, base.href);
  if (url === null) return { refused: 'does not resolve to a valid URL' };
  if (url.origin !== base.origin) {
    return {
      refused: `resolves to ${url.origin}, which is not the Nuxeo origin ${base.origin}`,
    };
  }
  if (!request.returnQueryParam) return { url: url.href };

  const warnings: string[] = [];
  // **The return parameter is ours, so it is cleared before anything else is decided.** A
  // configured path may carry its own — `"/nuxeo/login/azure?requestedUrl=https://evil.example/"`
  // — and Nuxeo redirects there *after* sign-in. Overwriting it with `set()` below covers only
  // the branch that has a return URL to write; the branch that refuses `postLoginPath` returned
  // the URL untouched, so the smuggled value survived while the warning said none was sent. That
  // is a post-authentication open redirect, strictly worse than the pre-authentication one
  // NXSAT-731 reported, because by then the session exists (review of PR 519).
  //
  // Only this one name, and only when the deployment uses it: with `returnQueryParam: null` the
  // deployment has said Nuxeo takes its relay state from its own configuration and not from this
  // URL, so there is nothing here for it to honour.
  if (url.searchParams.has(request.returnQueryParam)) {
    url.searchParams.delete(request.returnQueryParam);
    warnings.push(
      `the configured path carried its own ${request.returnQueryParam}, which was dropped: ` +
        `this application sets that parameter, from sso.postLoginPath`,
    );
  }

  const returnTo = resolveSsoReturnUrl(request.postLoginPath, request.appOrigin);
  if (returnTo === null) {
    warnings.push(
      `sso.postLoginPath "${request.postLoginPath}" is not a path on this application, ` +
        `so no ${request.returnQueryParam} was sent`,
    );
  } else {
    url.searchParams.set(request.returnQueryParam, returnTo);
  }
  return warnings.length > 0 ? { url: url.href, warning: warnings.join('; ') } : { url: url.href };
}

/**
 * The absolute return URL for `postLoginPath`, or `null` when it does not stay on `appOrigin`.
 *
 * Held to the same two rules as {@link resolveSsoLoginUrl}, including the scheme refusal, for the
 * same reason and not for a security one: `https://evil.example/` prepended with a slash becomes
 * the path `/https://evil.example/`, which really is on this application's origin, so the
 * comparison would allow it and the only symptom would be a 404 landing page after a sign-in that
 * otherwise worked. Refusing it drops the parameter and says why.
 */
function resolveSsoReturnUrl(postLoginPath: string, appOrigin: string): string | null {
  const base = parseUrl(`${appOrigin.replace(/\/+$/, '')}/`);
  if (base === null || !isHttpUrl(base)) return null;
  const trimmed = postLoginPath.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const url = parseUrl(trimmed.startsWith('/') ? trimmed : `/${trimmed}`, base.href);
  return url !== null && url.origin === base.origin ? url.href : null;
}

/**
 * Whether a base is one whose origin means anything, which is what lets the comparisons above be
 * comparisons.
 *
 * `URL.origin` is the **string** `"null"` for every opaque origin — `file:`, `blob:`, `about:`,
 * `data:` — so two unrelated ones compare equal to each other and a base on any of them would
 * accept a path resolved onto it. Measured: `new URL('/x', 'file:///')` has origin `"null"`, and so
 * does its base. That is the collision `AGENTS/08-bug-patterns.md` §26 records — a key drawn from
 * the value space it is meant to distinguish — so the scheme is checked rather than assumed, and
 * only here, where a base is built: a relative path cannot change the scheme once this has passed.
 *
 * Reachable only from a misconfigured `nuxeoApiOrigin` or a document with no origin of its own, so
 * this is defence in depth rather than the reported defect. Failing closed costs nothing: SSO is
 * served over HTTP(S) or it is not served.
 */
function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
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
  private readonly document = inject(DOCUMENT);
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
  private nuxeoBrowserOrigin(view: Window): string {
    const o = this.apiOrigin.replace(/\/$/, '');
    return o || view.location.origin;
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
   *
   * Nothing is navigated to, and nothing about the session is touched, unless the configured path
   * resolves onto the Nuxeo origin — see {@link resolveSsoLoginUrl}, which is the boundary.
   *
   * The window comes from `DOCUMENT` rather than the global, so the navigation has a seam a test
   * can hold: Chrome refuses to let a spy replace `window.location.assign`, and without a seam
   * this method could only ever be asserted on in the direction where it does nothing.
   */
  startSamlLogin(endpoint: NuxeoSamlLoginEndpoint): void {
    const view = this.document.defaultView;
    if (!view) return;
    const target = resolveSsoLoginUrl({
      path: endpoint.path,
      nuxeoOrigin: this.nuxeoBrowserOrigin(view),
      appOrigin: view.location.origin,
      returnQueryParam: this.ssoReturnQueryParam,
      postLoginPath: this.ssoPostLoginPath,
    });
    if ('refused' in target) {
      console.warn(
        `[agentic-ui] SSO endpoint "${endpoint.id}" was not opened: its path ` +
          `"${endpoint.path}" ${target.refused}`,
      );
      // Deliberately before `clearSignedOut()`: a refused action changes nothing at all, so an
      // explicitly signed-out user stays signed out rather than being quietly re-enrolled.
      return;
    }
    if (target.warning) console.warn(`[agentic-ui] ${target.warning}`);
    this.clearSignedOut();
    view.location.assign(target.url);
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
