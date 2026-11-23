import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marks a request the application sends on its own, on a timer, rather than because the user did
 * something: the notification centre's checks for new items are the first.
 *
 * The application's idle timer treats every successful Nuxeo response as activity, so a request
 * sent every minute would keep a session open for as long as the tab stays open, whether anyone is
 * there or not. The auth interceptor does not count a response to a request carrying this token.
 * It still attaches the user's credentials, and a 401 still ends the session: a background read is
 * not allowed to keep a session alive, and it is not allowed to hide one that has ended either.
 */
export const NUXEO_BACKGROUND_REQUEST = new HttpContextToken<boolean>(() => false);

/** A fresh context carrying {@link NUXEO_BACKGROUND_REQUEST}. */
export function backgroundRequestContext(): HttpContext {
  return new HttpContext().set(NUXEO_BACKGROUND_REQUEST, true);
}
