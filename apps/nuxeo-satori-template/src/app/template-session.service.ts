import { HttpClient } from '@angular/common/http';
import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

/** What the template keeps about a signed-in user. */
interface TemplateSession {
  readonly username: string;
  /** Base64 `user:password` for `Authorization: Basic …`. */
  readonly basic: string;
  readonly isAdministrator: boolean;
}

/**
 * `sessionStorage`, not `localStorage`, and not a field.
 *
 * Not a field, so that reloading the page does not sign the user out. The
 * configuration itself never needs it: `AppConfigService` fetches both halves
 * without the interceptor, so without this session's `Authorization` header.
 *
 * `sessionStorage` rather than `localStorage` because the value is a reversible
 * encoding of a password: scoping it to the tab means closing the tab ends the
 * session. The product's `AuthService` makes the same trade with the same shape
 * (`agentic_ui_nuxeo_session`); a fork on SSO should replace this whole service
 * with one that holds a cookie session or a token and store nothing.
 */
const STORAGE_KEY = 'satori_template_session';

function readStoredSession(): TemplateSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { username, basic, isAdministrator } = parsed as Record<string, unknown>;
    if (typeof username !== 'string' || typeof basic !== 'string') return null;
    return { username, basic, isAdministrator: isAdministrator === true };
  } catch {
    // A quota-denied or disabled storage must not stop the application booting.
    return null;
  }
}

/**
 * The template's session — a **real** Nuxeo sign-in.
 *
 * It verifies the credential against `GET /nuxeo/api/v1/me`, which is the
 * cheapest request that both authenticates and tells us who we are, and holds
 * the result in a signal so `template.rules.isSignedIn` and the shell re-render
 * without anything having to push an event.
 *
 * ## Why the header is set here rather than by the interceptor
 *
 * `templateNuxeoAuthInterceptor` attaches the credential of the session that
 * already exists. The sign-in request is the one that does not have one yet, so
 * it carries its own header. That is the only place in the application allowed
 * to do so — everywhere else, the interceptor.
 *
 * ## What a fork replaces
 *
 * All of it. A customer on SAML/OIDC keeps the signals and the
 * `isSignedIn()`/`username()` surface, and swaps the body for their identity
 * provider. Nothing in `@nuxeo/satori-platform` depends on this class.
 */
@Injectable({ providedIn: 'root' })
export class TemplateSessionService {
  private readonly http = inject(HttpClient);
  // `NUXEO_API_ORIGIN` is read at sign-in, not here: the rule-context initializer constructs this
  // service before the configuration loads, and the token keeps the first value it resolves to.
  private readonly injector = inject(Injector);

  private readonly session = signal<TemplateSession | null>(readStoredSession());

  /** `null` when signed out. Read by the extension rule context. */
  readonly username = computed<string | null>(() => this.session()?.username ?? null);

  /** A `computed`, so it is both a signal and callable as `isSignedIn()`. */
  readonly isSignedIn = computed<boolean>(() => this.session() !== null);

  readonly isAdministrator = computed<boolean>(() => this.session()?.isAdministrator === true);

  /** The value for `Authorization: Basic …`, without the prefix. */
  basicCredentials(): string | null {
    return this.session()?.basic ?? null;
  }

  /**
   * Verify a credential against Nuxeo and start a session.
   *
   * Rejects with the `HttpErrorResponse` on a bad password, so the sign-in form
   * can distinguish "wrong credential" (401) from "server unreachable" (0).
   */
  signIn(username: string, password: string): Observable<string> {
    const basic = btoa(`${username}:${password}`);
    return this.http
      .get<unknown>(`${this.injector.get(NUXEO_API_ORIGIN).replace(/\/$/, '')}/nuxeo/api/v1/me`, {
        headers: { Authorization: `Basic ${basic}` },
      })
      .pipe(
        map((me) => ({
          username: readUsername(me) ?? username,
          basic,
          isAdministrator: readIsAdministrator(me),
        })),
        tap((session) => this.store(session)),
        map((session) => session.username),
      );
  }

  signOut(): void {
    this.session.set(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clean up if storage is unavailable */
    }
  }

  private store(session: TemplateSession): void {
    this.session.set(session);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // The session still works for this page; only the reload-survival is lost.
    }
  }
}

/** Nuxeo's `/me` payload puts the name at the top level and in `properties`. */
function readUsername(me: unknown): string | null {
  if (typeof me !== 'object' || me === null) return null;
  const record = me as Record<string, unknown>;
  const id = record['id'];
  if (typeof id === 'string' && id) return id;
  const properties = record['properties'];
  if (typeof properties === 'object' && properties !== null) {
    const name = (properties as Record<string, unknown>)['username'];
    if (typeof name === 'string' && name) return name;
  }
  return null;
}

/** The flag is a boolean, a string or a 1 depending on the Nuxeo version. */
function readIsAdministrator(me: unknown): boolean {
  if (typeof me !== 'object' || me === null) return false;
  const record = me as Record<string, unknown>;
  const candidates = [record['isAdministrator']];
  const properties = record['properties'];
  if (typeof properties === 'object' && properties !== null) {
    candidates.push((properties as Record<string, unknown>)['isAdministrator']);
  }
  return candidates.some((value) => value === true || value === 'true' || value === 1);
}
