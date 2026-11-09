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
 * Session-storage key for the route a share link landed on. Read by the browse feature (a library,
 * which cannot import the app) under the same literal; keep the two in step.
 */
export const SHARED_DOCUMENT_STORAGE_KEY = 'nxs.sharedDocumentPath';

/**
 * Remembers the in-app route the share link opened, so a recipient who later clicks outside the
 * document can be sent back to it. Must run before the token is stripped from the address. Only a
 * hash route with a real path is kept; anything else is ignored, and the action simply is not offered.
 */
export function rememberSharedDocumentLanding(
  href = typeof window !== 'undefined' ? window.location.href : '',
): void {
  if (!href || typeof window === 'undefined') {
    return;
  }
  try {
    const hash = new URL(href).hash;
    if (!hash.startsWith('#/')) {
      return;
    }
    const path = hash.slice(1).split('?')[0];
    if (path.length > 1) {
      window.sessionStorage.setItem(SHARED_DOCUMENT_STORAGE_KEY, path);
    }
  } catch {
    // Storage can be blocked or the URL malformed; the back action is then not offered.
  }
}
