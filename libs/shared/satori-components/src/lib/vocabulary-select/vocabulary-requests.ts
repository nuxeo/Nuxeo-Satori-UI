import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, shareReplay, throwError, type Observable } from 'rxjs';

import {
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';

/**
 * One request per directory for every `nxs-vocabulary-select` under the host that provides it —
 * the metadata editor, whose repeatable complex fields render a select per row — for as long as
 * that host lives. It is not a session cache: the next editor asks the server again, as Web UI
 * does. A request that fails is forgotten, so the next field to open retries it.
 *
 * A request outlives the fields that asked for it, so a row removed or a tab left does not cancel
 * what the next row needs; it ends with the host. An `l10n…` directory is read page by page, and a
 * closed editor no longer reads the rest.
 */
@Injectable()
export class NxsVocabularyRequests {
  private readonly directories = inject(DirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly flat = new Map<string, Observable<DirectoryEntry[]>>();
  private readonly l10n = new Map<string, Observable<L10nDirectoryEntry[]>>();

  getEntries(directory: string): Observable<DirectoryEntry[]> {
    return this.shared(this.flat, directory, () => this.directories.getEntries(directory));
  }

  getAllL10nEntries(directory: string): Observable<L10nDirectoryEntry[]> {
    return this.shared(this.l10n, directory, () => this.directories.getAllL10nEntries(directory));
  }

  private shared<T>(
    requests: Map<string, Observable<T>>,
    directory: string,
    request: () => Observable<T>,
  ): Observable<T> {
    let found = requests.get(directory);
    if (!found) {
      found = request().pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((error: unknown) => {
          requests.delete(directory);
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      requests.set(directory, found);
    }
    return found;
  }
}
