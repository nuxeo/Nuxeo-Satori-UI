import {
  HttpErrorResponse,
  HttpHeaders,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { NUXEO_API_ORIGIN, NUXEO_BACKGROUND_REQUEST } from '@nuxeo/satori-platform/nuxeo-client';

import { AuthService } from './auth.service';
import { NUXEO_ESTABLISH_BROWSER_SESSION } from './nuxeo-auth.context';
import { SessionTimeoutService } from './session-timeout.service';
import { AUTH_TOKEN_HEADER } from './share-token.util';

function parseHttpOrigin(value: string): string | null {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return null;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function allowedNuxeoOrigins(apiOrigin: string): Set<string> {
  const origins = new Set<string>();
  if (typeof window !== 'undefined') {
    origins.add(window.location.origin);
  }
  const configured = parseHttpOrigin(apiOrigin);
  if (configured) {
    origins.add(configured);
  }
  return origins;
}

/** True when the request targets the Nuxeo REST API (relative or trusted-origin absolute paths). */
function isNuxeoApiRequest(url: string, allowedOrigins: Set<string>): boolean {
  const pathname = nuxeoRequestPathname(url, allowedOrigins);
  return pathname !== null && pathname.startsWith('/nuxeo/');
}

function nuxeoRequestPathname(url: string, allowedOrigins: Set<string>): string | null {
  if (url.startsWith('/')) {
    return url.split('?')[0]?.split('#')[0] ?? url;
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const parsed = new URL(url);
      if (!allowedOrigins.has(parsed.origin)) {
        return null;
      }
      return parsed.pathname;
    } catch {
      return null;
    }
  }
  return null;
}

function isNuxeoLogoutRequest(url: string, allowedOrigins: Set<string>): boolean {
  return nuxeoRequestPathname(url, allowedOrigins) === '/nuxeo/logout';
}

function hasBasicAuthorizationHeader(headers: HttpHeaders): boolean {
  const authorization = headers.get('Authorization');
  return authorization?.startsWith('Basic ') ?? false;
}

/**
 * Sends cookies on `/nuxeo/**` requests (SSO after SAML) and attaches Basic when the user logged in with password.
 * Resets idle timeout on successful responses and logs out on HTTP 401 when the session is no longer valid.
 *
 * A request marked {@link NUXEO_BACKGROUND_REQUEST} — one the application sends on a timer, such as
 * the notification centre's checks — gets the same credentials and the same 401 handling, but its
 * response does not reset the idle timeout: a check every minute would otherwise keep a session
 * open for as long as the tab stays open, with nobody at it.
 */
export const nuxeoAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const sessionTimeout = inject(SessionTimeoutService);
  const allowedOrigins = allowedNuxeoOrigins(inject(NUXEO_API_ORIGIN));
  if (!isNuxeoApiRequest(req.url, allowedOrigins)) {
    return next(req);
  }
  const basic = auth.basicCredentials();
  const shareToken = auth.shareAuthToken();
  let headers = req.headers;
  if (basic) {
    headers = headers.set('Authorization', `Basic ${basic}`);
  } else if (shareToken && !auth.isAuthenticated()) {
    headers = headers.set(AUTH_TOKEN_HEADER, shareToken);
  }
  // Logout must send cookies to clear stale JSESSIONID. Basic-auth requests (stored or
  // in-flight during login) ask to omit them, so a session cookie cannot override the Basic
  // principal — but `withCredentials` only governs a CROSS-origin request. A same-origin XHR,
  // which is the usual deployment and the dev proxy, sends cookies whatever it says, and Nuxeo
  // answers as the session's user rather than the Basic one. On the same origin the guard is
  // AuthService, at sign-in and on each hydration: it ends the server session first and refuses a
  // `/me` that names anyone else (`meAnswersAs` in auth.service.ts). A foreign session that appears
  // between reloads is still sent here. This line only covers cross-origin.
  const isLogout = isNuxeoLogoutRequest(req.url, allowedOrigins);
  const establishBrowserSession = req.context.get(NUXEO_ESTABLISH_BROWSER_SESSION);
  const usesBasicAuth = Boolean(basic) || hasBasicAuthorizationHeader(req.headers);
  const withCredentials = isLogout || establishBrowserSession ? true : usesBasicAuth ? false : true;
  const background = req.context.get(NUXEO_BACKGROUND_REQUEST);
  return next(req.clone({ headers, withCredentials })).pipe(
    tap((event) => {
      if (event instanceof HttpResponse && !background && auth.isAuthenticated()) {
        sessionTimeout.recordActivity();
      }
    }),
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && auth.isAuthenticated()) {
        sessionTimeout.expireDueToServer();
      }
      return throwError(() => err);
    }),
  );
};
