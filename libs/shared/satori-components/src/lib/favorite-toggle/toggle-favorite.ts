import { map, tap, type Observable } from 'rxjs';

import type { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

/** The window event the shell's Favorites views listen for, to re-read the list. */
export const NXS_FAVORITES_CHANGED_EVENT = 'favorites-changed';

/**
 * Adds a document to the user's favorites, or removes it, and emits the state the server now holds.
 *
 * The one implementation of the operation: `nxs-favorite-toggle` runs it, and so does a host that
 * offers the same operation as a menu entry rather than a button — document detail's
 * `app.toolbar.addToFavorites` and `removeFromFavorites`. On success it tells the shell, through
 * `NXS_FAVORITES_CHANGED_EVENT`, so the Favorites drawer and page re-read the list; on failure it
 * errors and tells nobody.
 */
export function nxsToggleFavorite(
  documents: Pick<DocumentDetailService, 'addToFavorites' | 'removeFromFavorites'>,
  documentId: string,
  favorite: boolean,
): Observable<boolean> {
  const request: Observable<unknown> = favorite
    ? documents.removeFromFavorites(documentId)
    : documents.addToFavorites(documentId);
  return request.pipe(
    map(() => !favorite),
    tap(() => window.dispatchEvent(new Event(NXS_FAVORITES_CHANGED_EVENT))),
  );
}
