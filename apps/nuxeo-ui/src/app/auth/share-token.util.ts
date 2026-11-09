/** Query param Nuxeo adds to Instant Share / external permission email links. */
export const SHARE_TOKEN_PARAM = 'token';

/** Header read by Nuxeo {@code TOKEN_AUTH} (see TokenAuthenticator). */
export const AUTH_TOKEN_HEADER = 'X-Authentication-Token';

/** Reads a share token from the browser URL (search or hash query). */
export function readShareTokenFromBrowserUrl(
  href = typeof window !== 'undefined' ? window.location.href : '',
): string | null {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href);
    const fromSearch = url.searchParams.get(SHARE_TOKEN_PARAM);
    if (fromSearch) {
      return fromSearch;
    }
    const hash = url.hash;
    const qIndex = hash.indexOf('?');
    if (qIndex >= 0) {
      return new URLSearchParams(hash.slice(qIndex + 1)).get(SHARE_TOKEN_PARAM);
    }
  } catch {
    return null;
  }
  return null;
}

/** Removes the share token from the address bar without reloading. */
export function stripShareTokenFromBrowserUrl(
  href = typeof window !== 'undefined' ? window.location.href : '',
): void {
  if (!href || typeof window === 'undefined') {
    return;
  }
  try {
    const url = new URL(href);
    url.searchParams.delete(SHARE_TOKEN_PARAM);
    const hash = url.hash;
    const qIndex = hash.indexOf('?');
    if (qIndex >= 0) {
      const hashPath = hash.slice(0, qIndex);
      const hashParams = new URLSearchParams(hash.slice(qIndex + 1));
      hashParams.delete(SHARE_TOKEN_PARAM);
      const rest = hashParams.toString();
      url.hash = rest ? `${hashPath}?${rest}` : hashPath;
    }
    const next = url.toString();
    if (next !== href) {
      window.history.replaceState(window.history.state, '', next);
    }
  } catch {
    // ignore malformed URLs
  }
}

/**
 * Session-storage key for the route a share link landed on, with the principal it was issued to:
 * `{"user":"transient/…","path":"/browse/…"}`. Read by the browse feature (a library, which cannot
 * import the app) under the same literal; keep the two in step.
 */
export const SHARED_DOCUMENT_STORAGE_KEY = 'nxs.sharedDocumentPath';

/**
 * The in-app route the address bar points at, as a hash route, with no query: what a share link
 * opened. Null for anything that is not a real route (the bare root is not one a recipient can use).
 */
export function readLandingPathFromBrowserUrl(
  href = typeof window !== 'undefined' ? window.location.href : '',
): string | null {
  if (!href || typeof window === 'undefined') {
    return null;
  }
  try {
    const hash = new URL(href).hash;
    if (!hash.startsWith('#/')) {
      return null;
    }
    const path = hash.slice(1).split('?')[0];
    return path.length > 1 ? path : null;
  } catch {
    return null;
  }
}

/** Forgets any remembered share landing. Called on every share exchange, sign-in and sign-out. */
export function clearSharedDocumentLanding(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(SHARED_DOCUMENT_STORAGE_KEY);
  } catch {
    // Storage can be blocked; there is then nothing to forget.
  }
}

/**
 * Remembers the landing route for the principal the share was exchanged for. Always clears first, so
 * a second share link, or one that did not sign anyone in, cannot leave the previous document behind.
 */
export function rememberSharedDocumentLanding(path: string | null, username: string | null): void {
  clearSharedDocumentLanding();
  if (!path || !username || typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(
      SHARED_DOCUMENT_STORAGE_KEY,
      JSON.stringify({ user: username, path }),
    );
  } catch {
    // Storage can be blocked; the back action is then not offered.
  }
}
