import type { MatDialog } from '@angular/material/dialog';
import type { TranslateService } from '@ngx-translate/core';
import { type Observable, filter, map } from 'rxjs';

import { SavedSearchDialogComponent } from '@nuxeo/satori-platform/ui';

/**
 * Asks for a saved search's name — for Save as, or with `initial` for Rename — and emits it trimmed,
 * or nothing when the dialog is dismissed or left blank.
 */
export function askSavedSearchName(
  dialog: MatDialog,
  translate: TranslateService,
  options: { heading: string; initial?: string },
): Observable<string> {
  return dialog
    .open(SavedSearchDialogComponent, {
      data: {
        title: options.heading,
        placeholder: translate.instant('saved-search.dialog.name-placeholder'),
        initialValue: options.initial,
      },
    })
    .afterClosed()
    .pipe(
      map((name: unknown) => (typeof name === 'string' ? name.trim() : '')),
      filter((name) => name.length > 0),
    );
}
